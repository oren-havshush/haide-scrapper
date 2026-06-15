// Run: npx tsx worker/lib/publish-date.test.ts

import {
  parsePublishDateToUtc,
  isPublishDateBeforeCutoff,
  resolveMetaMinPublishDate,
} from "./normalizer";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

function iso(d: Date | null): string {
  if (!d) return "null";
  return d.toISOString().slice(0, 10);
}

// parsePublishDateToUtc
assert(iso(parsePublishDateToUtc("31.07.2026")) === "2026-07-31", "DD.MM.YYYY");
assert(iso(parsePublishDateToUtc("15/01/2026")) === "2026-01-15", "DD/MM/YYYY");
assert(iso(parsePublishDateToUtc("2026-01-01")) === "2026-01-01", "ISO");
assert(iso(parsePublishDateToUtc("Jan 15, 2026")) === "2026-01-15", "English month");
assert(parsePublishDateToUtc("") === null, "empty");
assert(parsePublishDateToUtc("3 days ago") === null, "relative");
assert(parsePublishDateToUtc("not a date") === null, "garbage");

// isPublishDateBeforeCutoff — keep/drop vs 2026-01-01
const min = "2026-01-01";
assert(
  !isPublishDateBeforeCutoff("31.07.2026", min),
  "31.07.2026 should be kept",
);
assert(
  isPublishDateBeforeCutoff("03.06.2021", min),
  "03.06.2021 should be dropped",
);
assert(
  !isPublishDateBeforeCutoff("2026-01-01", min),
  "2026-01-01 boundary should be kept",
);
assert(
  isPublishDateBeforeCutoff("2025-12-31", min),
  "2025-12-31 should be dropped",
);
assert(
  !isPublishDateBeforeCutoff("", min),
  "empty date should be kept",
);
assert(
  !isPublishDateBeforeCutoff("3 days ago", min),
  "unparseable should be kept",
);

// Filter integration shape (same logic as scrape.ts recordsToPersist)
type Rec = { publishDate: string };
function filterRecords(records: Rec[], minPublishDate: string): Rec[] {
  return records.filter(
    (r) => !isPublishDateBeforeCutoff(r.publishDate, minPublishDate),
  );
}

const sample: Rec[] = [
  { publishDate: "31.07.2026" },
  { publishDate: "03.06.2021" },
  { publishDate: "" },
];
const filtered = filterRecords(sample, min);
assert(filtered.length === 2, "integration: 3 in → 2 out");
assert(
  filtered.some((r) => r.publishDate === "31.07.2026"),
  "integration: recent kept",
);
assert(
  !filtered.some((r) => r.publishDate === "03.06.2021"),
  "integration: stale dropped",
);

// resolveMetaMinPublishDate — absolute / relative / precedence / date-less safety
const fixedNow = new Date(Date.UTC(2026, 5, 15)); // 2026-06-15

// 1. relative window: today − 90 days
assert(
  resolveMetaMinPublishDate({ minPublishDays: 90 }, fixedNow) === "2026-03-17",
  "minPublishDays:90 from 2026-06-15 → 2026-03-17",
);
// 30-day window
assert(
  resolveMetaMinPublishDate({ minPublishDays: 30 }, fixedNow) === "2026-05-16",
  "minPublishDays:30 from 2026-06-15 → 2026-05-16",
);
// 2. absolute date passes through unchanged
assert(
  resolveMetaMinPublishDate({ minPublishDate: "2026-01-01" }, fixedNow) ===
    "2026-01-01",
  "minPublishDate absolute passes through",
);
// 3. precedence: explicit absolute wins over relative
assert(
  resolveMetaMinPublishDate(
    { minPublishDate: "2026-01-01", minPublishDays: 90 },
    fixedNow,
  ) === "2026-01-01",
  "absolute minPublishDate overrides minPublishDays",
);
// 4. neither set → null (caller falls back to env)
assert(resolveMetaMinPublishDate({}, fixedNow) === null, "no cutoff → null");
assert(resolveMetaMinPublishDate(null, fixedNow) === null, "null meta → null");
// 5. invalid values ignored
assert(
  resolveMetaMinPublishDate({ minPublishDays: 0 }, fixedNow) === null,
  "minPublishDays:0 ignored",
);
assert(
  resolveMetaMinPublishDate({ minPublishDate: "garbage" }, fixedNow) === null,
  "garbage minPublishDate ignored",
);

// 6. rolling behavior: a job fresh today is dropped once the window moves past it.
// Job published 2026-04-01, window 90 days.
const jobDate = "2026-04-01";
const cutoffApril = resolveMetaMinPublishDate({ minPublishDays: 90 }, new Date(Date.UTC(2026, 3, 20))); // 2026-04-20 → cutoff 2026-01-20
assert(
  !isPublishDateBeforeCutoff(jobDate, cutoffApril!),
  "2026-04-01 kept on 2026-04-20 scrape (within 90d)",
);
const cutoffAugust = resolveMetaMinPublishDate({ minPublishDays: 90 }, new Date(Date.UTC(2026, 7, 1))); // 2026-08-01 → cutoff 2026-05-03
assert(
  isPublishDateBeforeCutoff(jobDate, cutoffAugust!),
  "2026-04-01 dropped on 2026-08-01 scrape (older than 90d)",
);
// 7. date-less job survives the rolling cutoff
assert(
  !isPublishDateBeforeCutoff("", cutoffAugust!),
  "date-less job kept under rolling cutoff",
);

console.log("publish-date.test.ts: all passed");
