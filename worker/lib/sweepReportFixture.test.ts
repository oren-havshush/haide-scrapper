// Run: npx tsx worker/lib/sweepReportFixture.test.ts
//
// The report, rendered from the step 9 catch-up run's REAL items
// (fixtures/sweep-2026-09-15.json), not from items written to fit the renderer.
//
// That night the stored report read "140 sites, 0 need attention". It was not a
// clean fleet: twelve sites had drifted and were only counted, never named, and
// maccabi4u had replaced 433 listings with 8 under a `success` outcome while its
// own ScrapeRun warned `job_count_drop … (-98%)`. The Needs attention list is
// the remediation queue, so it has to name all thirteen.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  needsAttention,
  renderSweepReport,
  sweepDate,
  verdictLine,
  type ReportItem,
  type ReportSweep,
  type SkippedSite,
} from "./sweepReport";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

type FixtureItem = Omit<ReportItem, "newestJobAt"> & { newestJobAt: string | null };
type Fixture = {
  sweep: Omit<ReportSweep, "startedAt" | "finishedAt"> & { startedAt: string; finishedAt: string };
  skipped: SkippedSite[];
  items: FixtureItem[];
};

const fixture: Fixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "sweep-2026-09-15.json"), "utf8"),
);

const sweep: ReportSweep = {
  ...fixture.sweep,
  startedAt: new Date(fixture.sweep.startedAt),
  finishedAt: new Date(fixture.sweep.finishedAt),
};
const items: ReportItem[] = fixture.items.map((i) => ({
  ...i,
  newestJobAt: i.newestJobAt ? new Date(i.newestJobAt) : null,
}));
const opts = { timeZone: "Asia/Jerusalem", skipped: fixture.skipped };

// The fixture is what it claims to be, or everything below checks air.
assert(items.length === 140, `the fixture holds the night's 140 items (got ${items.length})`);
assert(fixture.skipped.length === 5, `and its 5 selection exclusions (got ${fixture.skipped.length})`);

const text = renderSweepReport(sweep, items, opts);
const lines = text.split("\n");
const verdict = lines[0];

// ---------------------------------------------------------------------------
// The verdict, and the section it counts
// ---------------------------------------------------------------------------

assert(
  verdict === "Nightly sweep 2026-09-15: 140 sites, 13 need attention",
  `the verdict counts the twelve drifted sites and maccabi4u (got "${verdict}")`,
);
assert(verdict === verdictLine(sweep, items, opts), "and is the line verdictLine gives");

const attention = needsAttention(sweep, items, opts);
assert(attention.length === 13, `needsAttention lists 13 sites (got ${attention.length})`);

const start = text.indexOf("Needs attention (");
const end = text.indexOf("\n\n", start);
const block = start >= 0 && end > start ? text.slice(start, end) : "";
assert(block.startsWith("Needs attention (13)"), `the section header says 13\n${block.slice(0, 80)}`);

// Every site in the section is one line starting "  https://" — the count in the
// verdict must equal the sites actually printed, not a number computed apart.
const named = block.split("\n").filter((l) => /^ {2}https?:\/\//.test(l));
assert(
  named.length === 13,
  `the section prints exactly as many sites as the verdict counts (printed ${named.length})`,
);

// ---------------------------------------------------------------------------
// maccabi4u — a committed drop the run called success
// ---------------------------------------------------------------------------

const maccabi = attention.find((a) => a.siteUrl.includes("maccabi4u.co.il"));
assert(maccabi !== undefined, "maccabi4u is under Needs attention");
assert(
  maccabi !== undefined && /433 -> 8/.test(maccabi.why),
  `with both counts (got "${maccabi?.why}")`,
);

// ---------------------------------------------------------------------------
// Silent drift is named, with category, listing count and newest listing date
// ---------------------------------------------------------------------------

const drift = items.filter((i) => i.outcome === "soft_failure");
assert(drift.length === 12, `the fixture has 12 drifted sites (got ${drift.length})`);
for (const d of drift) {
  const a = attention.find((x) => x.siteUrl === d.siteUrl);
  assert(a !== undefined, `drifted site is named: ${d.siteUrl}`);
  if (!a) continue;
  assert(a.why.includes(d.failureCategory ?? "?"), `${d.siteUrl}: its category is on the line (${a.why})`);
  assert(a.why.includes(`${d.jobsAfter} listing`), `${d.siteUrl}: its listing count is on the line (${a.why})`);
  // The sweep's local date, like every other date in the report.
  const newest = d.newestJobAt ? sweepDate(d.newestJobAt, opts.timeZone) : "none";
  assert(a.why.includes(`newest ${newest}`), `${d.siteUrl}: its newest listing date is on the line (${a.why})`);
}

{
  const ashtrom = attention.find((a) => a.siteUrl.includes("ashtrom"));
  assert(
    ashtrom?.why === "silent drift (structure_changed): 62 listing(s) on the site, newest 2026-08-16",
    `the exact drift line for ashtrom (got "${ashtrom?.why}")`,
  );
}

// ---------------------------------------------------------------------------
// Skipped at selection, and warnings
// ---------------------------------------------------------------------------

for (const s of fixture.skipped) {
  assert(text.includes(`${s.siteUrl} — ${s.reason}`), `skipped site listed with its reason: ${s.siteUrl}`);
}
assert(
  text.includes("no usable fieldMappings (would fail immediately)"),
  "tikshoov's reason is in the report",
);
assert(
  !attention.some((a) => a.siteUrl.includes("tikshoov")),
  "and a skipped site is not counted as needing attention — it was never attempted",
);

assert(text.includes("\nWarnings ("), "the report has a Warnings section");
{
  const heading = text.indexOf("\n  job_count_drop (");
  const site = text.indexOf(
    "https://www.maccabi4u.co.il/careers/search-job-positions/? — 8 saved vs previous 433 (-98%)",
  );
  assert(heading >= 0 && site > heading, "maccabi4u's own run warning is in the report, under job_count_drop");
}
{
  const withWarnings = items.filter((i) => (i.warnings ?? []).length > 0).length;
  assert(
    text.includes(`Warnings (${withWarnings} sites)`),
    `the Warnings header counts every site whose run warned (${withWarnings})`,
  );
  for (const i of items) {
    for (const w of i.warnings ?? []) {
      const [type, ...rest] = w.split(":");
      if (!text.includes(`${i.siteUrl} — ${rest.join(":").trim()}`) || !text.includes(`  ${type} (`)) {
        assert(false, `warning surfaced: ${i.siteUrl} ${w.slice(0, 60)}`);
      }
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("sweepReportFixture: last night's items read 13 need attention, maccabi4u among them");
