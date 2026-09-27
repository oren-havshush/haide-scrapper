// Run: npx tsx worker/lib/incrementalWriteGuard.test.ts
//
// Incremental detail fetching (worker/lib/detailPlan.ts) is wired into
// scrape.ts, which needs a browser and a database to run. What must hold is
// structural, so it is checked as source text, the way scheduledWriteGuard.test
// checks the scheduled gate:
//
//   1. ORDER. A listing_* refusal is decided before any detail page is visited
//      or any carry is built, so a refused night fetches and carries nothing.
//      The page-flow extractor therefore returns card seeds, not records, and
//      the detail visits live in their own function called after the refusal.
//   2. ONE WRITE PATH. Carried rows are ordinary rows: they reach the database
//      only through the rows -> planScheduledPersist -> transaction path that
//      every row takes. No new job write exists.
//   3. THE GATE. The carry plan's mode comes from readDetailMode(payload),
//      which only a scheduled payload can make "incremental".
//   4. THE STAMPS. Fetched rows are stamped; stored rows are read for the plan.

import { readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const raw = readFileSync(join(__dirname, "..", "jobs", "scrape.ts"), "utf8");
// Comments stripped, so a sentence that names a call cannot satisfy a check.
const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

function functionBody(name: string): string {
  const lines = src.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^(async )?function ${name}\\(`).test(l));
  if (start === -1) return "";
  const end = lines.findIndex((l, i) => i > start && l === "}");
  if (end === -1) return "";
  return lines.slice(start, end + 1).join("\n");
}

const pageFlow = functionBody("extractRawFieldsWithPageFlow");
const visit = functionBody("visitDetailPages");
const execute = functionBody("executeScrape");
assert(pageFlow.length > 2000, `extractRawFieldsWithPageFlow was extracted (${pageFlow.length} chars)`);
assert(visit.length > 1000, `visitDetailPages exists and was extracted (${visit.length} chars)`);
assert(execute.length > 5000, `executeScrape was extracted (${execute.length} chars)`);

// ---------------------------------------------------------------------------
// 1. Order
// ---------------------------------------------------------------------------

assert(
  !/gotoForgiving\(\s*page,\s*detailUrl/.test(pageFlow),
  "the page-flow extractor no longer visits detail pages — it returns card seeds",
);
assert(/PENDING_DETAIL_KEY/.test(pageFlow), "its seeds are marked pending");
assert(/gotoForgiving\(\s*page,\s*detailUrl/.test(visit), "the detail visits live in visitDetailPages");

const refuse = execute.indexOf("refuseListingRun(");
const planAt = execute.indexOf("planDetailFetch(");
const visitAt = execute.indexOf("visitDetailPages(");
const carryAt = execute.indexOf("buildCarriedRawFields(");
assert(refuse > 0, "executeScrape reaches refuseListingRun");
assert(planAt > refuse, "the fetch-or-carry plan comes after the refusal");
assert(visitAt > refuse, "so do the detail visits");
assert(carryAt > refuse, "and the carried rows");
const decide = execute.indexOf("decideListingOutcome(");
assert(decide > 0 && decide < refuse, "the refusal is decided on what the listing walk returned");

// ---------------------------------------------------------------------------
// 2. One write path
// ---------------------------------------------------------------------------

const count = (needle: string) => src.split(needle).length - 1;
assert(count("job.createMany(") === 1, `still exactly one job.createMany — the scheduled transaction (${count("job.createMany(")})`);
assert(count("job.create(") === 1, `still exactly one job.create — the manual chunked insert (${count("job.create(")})`);
assert(!/buildCarriedRawFields\([^)]*\)[\s\S]{0,200}prisma\./.test(execute), "a carried row is not written where it is built");
assert(
  /planScheduledPersist\(rows\.length,/.test(execute),
  "the drop guard still counts every row, carried ones included",
);

// ---------------------------------------------------------------------------
// 3. The gate
// ---------------------------------------------------------------------------

assert(/detailMode:\s*readDetailMode\(/.test(src), "RunMode.detailMode is read from the payload by readDetailMode");
assert(/mode:\s*runMode\.detailMode/.test(execute), "and the plan's mode is that value, not a literal");
assert(!/mode:\s*"incremental"/.test(src), "nowhere is the mode hard-coded to incremental");

// ---------------------------------------------------------------------------
// 4. Stamps and the stored read
// ---------------------------------------------------------------------------

assert(/indexStoredRows\(/.test(execute), "stored rows are indexed for the plan");
assert(/select:\s*\{\s*rawData:\s*true/.test(src), "and read with their rawData");
assert(/stampFetched\(/.test(execute), "fetched rows are stamped so a later night can carry them");
assert(
  /detailsFetched:/.test(execute) && /detailsCarried:/.test(execute) && /detailMode:/.test(execute),
  "the run records its mode and both counts",
);

// ---------------------------------------------------------------------------
// 5. The report's anomaly reaches the report
// ---------------------------------------------------------------------------

assert(
  /detailChurnWarning = fingerprintChurnWarning\(detailPlan, \{ mode: runMode\.detailMode, eligible \}\)/.test(execute),
  "the run computes the churn warning from tonight's plan",
);
assert(
  /if \(detailChurnWarning\) scrapeWarnings\.push\(detailChurnWarning\)/.test(execute),
  "and writes it with the run's warnings, where the sweep item copies it from",
);

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("incrementalWriteGuard: refusal first, one write path, the mode from the payload");
