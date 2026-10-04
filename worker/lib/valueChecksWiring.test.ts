// Run: npx tsx worker/lib/valueChecksWiring.test.ts
//
// addsite2 phase two, step 2b: the value checks run ONCE per scrape, at the
// warnings assembly both persist paths reach (manual and scheduled), and their
// findings reach the fix queue. Source-level, in the style of
// jobLocation.test.ts: scrape.ts cannot be imported without a database.

import { readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}
const count = (s: string, needle: string) => s.split(needle).length - 1;

const src = readFileSync(join(__dirname, "../jobs/scrape.ts"), "utf8");

assert(count(src, "runValueChecks(") === 1, `scrape.ts calls runValueChecks exactly once (got ${count(src, "runValueChecks(")})`);
assert(!src.includes("NON_PLACE_LOCATIONS"), "NON_PLACE_LOCATIONS no longer exists in scrape.ts (worker/lib/cityHomographs.ts)");
assert(!src.includes("COARSE_LOCATIONS"), "nor COARSE_LOCATIONS");
assert(!src.includes("function buildLocationWarnings"), "buildLocationWarnings moved into valueChecks.ts");

const first = src.indexOf("await markFirstScraped(site.id");
const run = src.indexOf("runValueChecks(");
assert(first > 0 && run > first, "the checks run after both persist paths have written (manual and scheduled reach it)");

const plan = src.indexOf("planValueCheckItems(");
assert(count(src, "planValueCheckItems(") === 1 && plan > run, "the findings are planned against the open items once, after the checks");
assert(count(src, "prisma.fixItem.create(") === 1 && src.indexOf("prisma.fixItem.create(") > plan, "and the new items written after the plan");

// The two reads the plan widens: the previous rows before the delete, the saved rows after.
const prevFn = src.slice(src.indexOf("async function readPreviousLocations"), src.indexOf("async function refuseListingRun"));
assert(/select:\s*\{[^}]*title: true[^}]*department: true/.test(prevFn), "readPreviousLocations also reads title and department");
const saved = src.slice(src.indexOf("const savedJobs = await prisma.job.findMany"), run);
assert(saved.includes("publishDate: true") && saved.includes("ageBucket: true"), "the post-save select reads publishDate and ageBucket");
assert(saved.includes("externalJobId: true") && saved.includes("detailUrl: true"), "and the job keys");

// No check may block a write: everything sits in the best-effort warnings try.
const tryStart = src.lastIndexOf("try {", run);
const catchAt = src.indexOf('console.warn("[scrape] Failed to compute/persist completion warnings:"', run);
assert(tryStart > first && catchAt > src.indexOf("prisma.fixItem.create("), "the checks and the queue write sit inside the warnings try/catch");

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("valueChecksWiring: runValueChecks once, after both persist paths, findings to the fix queue, never blocking");
