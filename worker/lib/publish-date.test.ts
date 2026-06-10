// Run: npx tsx worker/lib/publish-date.test.ts

import {
  parsePublishDateToUtc,
  isPublishDateBeforeCutoff,
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

console.log("publish-date.test.ts: all passed");
