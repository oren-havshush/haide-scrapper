// Run: npx tsx worker/lib/considerBigLane.test.ts
//
// "Consider the big lane" (big-lane design, item 6(i)): the nightly's report
// marks a site whose run took over 10 minutes, or that hit the item cap, and
// the first time a fix-queue item opens for it (COVERAGE, "consider the big
// lane"). Never a second one while one is open; never for a big-lane site.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONSIDER_BIG_LANE_CODE, considerBigLane, shouldOpenConsiderItem } from "./bigLane";
import { needsAttention, type ReportItem, type ReportSweep } from "./sweepReport";
import { VALUE_CHECK_QUEUE_CODES } from "./valueChecks";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}
function check(name: string, body: () => void) {
  try {
    body();
  } catch (err) {
    console.error(`FAIL: ${name} threw: ${(err as Error).message}`);
    failures++;
  }
}

check("the flag", () => {
  assert(considerBigLane({ ranMinutes: 9 }) === null, "9 minutes: no flag");
  assert(considerBigLane({ ranMinutes: 10 }) === null, "10 minutes: no flag (over 10 is the rule)");
  assert(considerBigLane({ ranMinutes: 11 }) === "consider the big lane (ran 11 min)", `11 minutes flags (got ${considerBigLane({ ranMinutes: 11 })})`);
  assert(
    considerBigLane({ ranMinutes: 3, warnings: ["item_cap_reached: 2,000 of 2,524 cards"] }) === "consider the big lane (item cap)",
    "the item cap flags",
  );
  assert(considerBigLane({ ranMinutes: null }) === null, "unknown duration, no cap: no flag");
});

const item = (over: Partial<ReportItem>): ReportItem => ({
  siteId: "s",
  siteUrl: "https://slow.example/",
  phase: "scrape",
  outcome: "success",
  failureCategory: null,
  jobsBefore: 300,
  jobsAfter: 300,
  newestJobAt: null,
  siteStatus: "ACTIVE",
  wouldDemoteTo: null,
  wouldPromoteTo: null,
  ...over,
});
const sweep = (kind: string): ReportSweep => ({
  id: "w",
  kind,
  status: "COMPLETED",
  trigger: "timer",
  startedAt: new Date("2026-10-12T23:00:00Z"),
  finishedAt: new Date("2026-10-13T03:00:00Z"),
  selectedCount: 1,
  haltReason: null,
});

check("the nightly's report marks it", () => {
  const why = needsAttention(sweep("SCRAPE"), [item({ ranMinutes: 11 })]).map((a) => a.why).join(" | ");
  assert(why === "consider the big lane (ran 11 min)", `Needs attention (got ${JSON.stringify(why)})`);
  assert(needsAttention(sweep("SCRAPE"), [item({ ranMinutes: 9 })]).length === 0, "9 minutes: nothing");
  assert(needsAttention(sweep("SCRAPE_BIG"), [item({ ranMinutes: 90 })]).length === 0, "the big lane's own sites are not told to consider it");
});

check("the fix item opens once", () => {
  assert(shouldOpenConsiderItem("consider the big lane (ran 11 min)", []), "the first night opens one");
  assert(!shouldOpenConsiderItem("consider the big lane (ran 12 min)", [CONSIDER_BIG_LANE_CODE]), "the second night opens no second item");
  assert(!shouldOpenConsiderItem(null, []), "no flag, no item");
  assert(!VALUE_CHECK_QUEUE_CODES.has(CONSIDER_BIG_LANE_CODE), "and a value check never closes it");
});

const strip = (s: string) => s.replace(/^\s*\/\/[^\n]*$/gm, "");
check("the wiring", () => {
  const nightly = strip(readFileSync(join(__dirname, "..", "sweep", "nightly.ts"), "utf8"));
  assert(/ranMinutes: \(r\.finishedAt\.getTime\(\) - r\.startedAt\.getTime\(\)\) \/ 60_000,/.test(nightly), "each item carries how long the site took");
  const realRun = nightly.slice(nightly.indexOf("async function realRun"), nightly.indexOf("async function dryRunDetails"));
  assert(/if \(lane === "nightly" && !single\) await openConsiderBigLaneItem\(result\);/.test(realRun), "the nightly fleet opens the item after each site");
  const opener = nightly.slice(nightly.indexOf("async function openConsiderBigLaneItem"));
  assert(/code: CONSIDER_BIG_LANE_CODE, resolvedAt: null/.test(opener), "it reads the open items first");
  assert(/shouldOpenConsiderItem\(/.test(opener), "and decides with the plan");
  assert(/field: "COVERAGE", source: "CHECK", code: CONSIDER_BIG_LANE_CODE/.test(opener) && /note: "consider the big lane"/.test(opener), "COVERAGE, with the note");
});

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("considerBigLane: all passed");
