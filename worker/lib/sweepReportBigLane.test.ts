// Run: npx tsx worker/lib/sweepReportBigLane.test.ts
//
// The big lane's report (big-lane design, item 7): one morning email. The
// nightly's report carries a "Big lane (22:00-01:45)" block, the latest
// SCRAPE_BIG sweep's own stored report from the last 12 hours, or "no big-lane
// run last night". A run the window's end cut off reads "cut off at 01:45
// after N min — nothing written, N listing(s) kept", and a site that would not
// fit is named in the big lane's own report.

process.env.TZ = "UTC";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { needsAttention, renderSweepReport, type ReportItem, type ReportSweep } from "./sweepReport";
import { CUT_OFF, cutOffWarning } from "./bigLane";
import { classifyOutcome } from "./sweepSelection";

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

const bigSweep: ReportSweep = {
  id: "big1",
  kind: "SCRAPE_BIG",
  status: "COMPLETED",
  trigger: "timer",
  startedAt: new Date("2026-10-12T19:00:00Z"),
  finishedAt: new Date("2026-10-12T22:48:00Z"),
  selectedCount: 2,
  haltReason: null,
};
const cutItem: ReportItem = {
  siteId: "maof",
  siteUrl: "https://www.maof-hr.co.il/",
  phase: "scrape",
  outcome: classifyOutcome({ status: "FAILED", failureCategory: CUT_OFF }),
  failureCategory: CUT_OFF,
  jobsBefore: 2524,
  jobsAfter: 2524,
  newestJobAt: null,
  siteStatus: "ACTIVE",
  wouldDemoteTo: null,
  wouldPromoteTo: null,
  warnings: [cutOffWarning(45)],
};

check("the cut-off line", () => {
  assert(cutOffWarning(44.6) === "cut_off: after 45 min", `the run's warning (got ${cutOffWarning(44.6)})`);
  const why = needsAttention(bigSweep, [cutItem]).map((a) => a.why).join(" | ");
  assert(why === "cut off at 01:45 after 45 min — nothing written, 2524 listing(s) kept", `Needs attention (got ${JSON.stringify(why)})`);
});

check("the big lane's own report", () => {
  const text = renderSweepReport(bigSweep, [cutItem], {
    timeZone: "Asia/Jerusalem",
    skipped: [{ siteUrl: "https://big2.example/", reason: "would not finish before 01:45 (expected 120 min)", kind: "no_fit" }],
  });
  assert(/^Big lane 2026-10-12/.test(text), `its verdict line says Big lane (got ${JSON.stringify(text.split("\n")[0])})`);
  assert(/https:\/\/big2\.example\/ — would not finish before 01:45 \(expected 120 min\)/.test(text), "the site that did not fit is named");
  assert(/cut off at 01:45 after 45 min/.test(text), "the cut-off is under Needs attention");
});

const nightly: ReportSweep = { ...bigSweep, id: "n1", kind: "SCRAPE", startedAt: new Date("2026-10-12T23:00:00Z"), finishedAt: new Date("2026-10-13T03:30:00Z") };

check("the block in the morning email", () => {
  const stored = renderSweepReport(bigSweep, [cutItem], { timeZone: "Asia/Jerusalem" });
  const withBlock = renderSweepReport(nightly, [], { timeZone: "Asia/Jerusalem", bigLane: { logText: stored } });
  const at = withBlock.indexOf("Big lane (22:00-01:45)");
  assert(at > 0, "the nightly report has the block");
  const block = withBlock.slice(at);
  assert(block.includes(`  ${stored.split("\n")[0]}`), "it carries the big lane's report, indented");
  assert(/  {6}cut off at 01:45 after 45 min/.test(block), "with its cut-off line");
  const none = renderSweepReport(nightly, [], { timeZone: "Asia/Jerusalem", bigLane: null });
  assert(/Big lane \(22:00-01:45\)\n  no big-lane run last night/.test(none), "no run: one line says so");
  const absent = renderSweepReport(nightly, [], { timeZone: "Asia/Jerusalem" });
  assert(!/Big lane \(22:00-01:45\)/.test(absent), "not asked for (a policy or single-site report): no block");
});

const strip = (s: string) => s.replace(/^\s*\/\/[^\n]*$/gm, "");
const read = (...p: string[]) => strip(readFileSync(join(__dirname, "..", "..", ...p), "utf8"));

check("the wiring", () => {
  const scrape = read("worker", "jobs", "scrape.ts");
  const timer = scrape.slice(scrape.indexOf("function createTimeoutPromise"), scrape.indexOf("async function skipSiteForApplyLogin"));
  assert(/\.\.\.\(deadline\.cutOff \? \{ warnings: \[cutOffWarning\(\(Date\.now\(\) - startedMs\) \/ 60_000\)\] \} : \{\}\)/.test(timer), "a cut-off run records how long it ran");
  const nightlySrc = read("worker", "sweep", "nightly.ts");
  assert(/async function latestBigLaneReport\(now: Date\)/.test(nightlySrc), "the driver reads the latest big-lane report");
  const latest = nightlySrc.slice(nightlySrc.indexOf("async function latestBigLaneReport"));
  assert(/kind: BIG_LANE_SWEEP_KIND/.test(latest) && /finishedAt: \{ gte: new Date\(now\.getTime\(\) - 12 \* 3_600_000\) \}/.test(latest), "a SCRAPE_BIG sweep that finished in the last 12 hours");
  const realRun = nightlySrc.slice(nightlySrc.indexOf("async function realRun"), nightlySrc.indexOf("async function dryRunDetails"));
  assert(/const bigLaneReport = lane === "nightly" && !single \? await latestBigLaneReport\(now\) : undefined;/.test(realRun), "only the nightly fleet's report carries it");
  assert((realRun.match(/bigLane: bigLaneReport,/g) ?? []).length === 4, "on every close");
  const common = read("worker", "sweep", "sweepCommon.ts");
  assert(/bigLane: args\.bigLane,/.test(common), "closeSweep renders it");
});

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("sweepReportBigLane: all passed");
