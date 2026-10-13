// Run: npx tsx worker/lib/scriptCutOff.test.ts
//
// A scheduled run whose setup script hit its limit is refused (owner,
// 2026-10-13, horizontech). The 90-s limit cut horizontech's script after ~233
// of 265 detail pages, and the run wrote 32 rows with no description: a
// scheduled run made a site worse, the one thing the guards exist to stop.
// Like a truncated walk: nothing written, the previous listings kept, and the
// morning line says "setup script cut off at <n> s; nothing written, <k>
// listing(s) kept". A manual run is not refused; it carries the warning. The
// summary counts it under its own category, never as ok.

process.env.TZ = "UTC";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeCounters, needsAttention, renderSweepReport, type ReportItem, type ReportSweep } from "./sweepReport";
import { classifyOutcome, SETUP_SCRIPT_CUT_OFF } from "./sweepSelection";
import { scriptCutOffRefusal } from "./scriptCutOff";
import { newExtractGuard } from "./zeroMatch";

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

const timeoutLine = (s: number) =>
  `setup_script_timeout: the setupScript on https://horizontech.co.il/x/ ran past ${s} s; the run went on without it`;

check("the category is a refusal, not ok", () => {
  assert(SETUP_SCRIPT_CUT_OFF === "setup_script_cut_off", `the category (got ${SETUP_SCRIPT_CUT_OFF})`);
  const o = classifyOutcome({ status: "COMPLETED", failureCategory: SETUP_SCRIPT_CUT_OFF });
  assert(o === "suspicious_drop", `a refused run with its listings kept (got ${o})`);
});

check("a scheduled run whose script hit its limit is refused", () => {
  const g = newExtractGuard(true);
  g.scriptTimeouts.push(timeoutLine(90));
  const r = scriptCutOffRefusal(g);
  assert(r !== null, "refused");
  assert(r?.failureCategory === SETUP_SCRIPT_CUT_OFF, `its category (got ${r?.failureCategory})`);
  assert((r?.warnings ?? [])[0] === "setup_script_cut_off: 90 s", `the first warning names the limit (got ${JSON.stringify(r?.warnings)})`);
  assert((r?.warnings ?? []).includes(timeoutLine(90)), "and the script's own timeout warning, naming the page, is kept");
  assert(/cut off at 90 s/.test(r?.error ?? "") && /previous listings kept/.test(r?.error ?? ""), `the run's error (got ${r?.error})`);
  const g180 = newExtractGuard(true, 2000, 180_000);
  g180.scriptTimeouts.push(timeoutLine(180));
  assert((scriptCutOffRefusal(g180)?.warnings ?? [])[0] === "setup_script_cut_off: 180 s", "the site's own limit is named");
});

check("a manual run, or a script that finished, is not refused", () => {
  const manual = newExtractGuard(false);
  manual.scriptTimeouts.push(timeoutLine(90));
  assert(scriptCutOffRefusal(manual) === null, "a manual run is not refused (it carries the warning)");
  assert(scriptCutOffRefusal(newExtractGuard(true)) === null, "a scheduled run whose script finished is not refused");
  assert(scriptCutOffRefusal(null) === null, "no guard, no refusal");
});

const sweep: ReportSweep = {
  id: "s1",
  kind: "SCRAPE",
  status: "COMPLETED",
  trigger: "timer",
  startedAt: new Date("2026-10-13T23:01:00Z"),
  finishedAt: new Date("2026-10-14T00:48:00Z"),
  selectedCount: 1,
  haltReason: null,
};
const item: ReportItem = {
  siteId: "horizontech",
  siteUrl: "https://horizontech.co.il/x/",
  phase: "scrape",
  outcome: classifyOutcome({ status: "COMPLETED", failureCategory: SETUP_SCRIPT_CUT_OFF }),
  failureCategory: SETUP_SCRIPT_CUT_OFF,
  jobsBefore: 265,
  jobsAfter: 265,
  newestJobAt: null,
  siteStatus: "ACTIVE",
  wouldDemoteTo: null,
  wouldPromoteTo: null,
  warnings: ["setup_script_cut_off: 90 s", timeoutLine(90)],
};

check("the morning line", () => {
  const why = needsAttention(sweep, [item]).map((a) => a.why);
  assert(
    why.length === 1 && why[0] === "setup script cut off at 90 s; nothing written, 265 listing(s) kept",
    `one line, the owner's wording (got ${JSON.stringify(why)})`,
  );
});

check("the summary counts it on its own row, not ok", () => {
  const c = computeCounters(sweep, [item]);
  assert(c.ok === 0, `not ok (got ${c.ok})`);
  const text = renderSweepReport(sweep, [item], { timeZone: "Asia/Jerusalem" });
  assert(/^\s+1\s+setup_script_cut_off$/m.test(text), "an Outcomes row of its own");
});

check("scrape.ts refuses before the listing is written", () => {
  const src = readFileSync(join(__dirname, "../jobs/scrape.ts"), "utf8").replace(/^\s*\/\/[^\n]*$/gm, "");
  const calls = [...src.matchAll(/scriptCutOffRefusal\(runMode\.extract\)/g)].map((m) => m.index ?? -1);
  assert(calls.length === 2, `checked twice: after the listing, and after the detail pages (got ${calls.length})`);
  const itemCap = src.indexOf("failureCategory: ITEM_CAP");
  const firstDetail = src.indexOf("const visited = await visitDetailPages(");
  assert(calls[0] > itemCap && calls[0] < firstDetail, "the first check sits after the item cap, before any detail page");
  const persist = src.indexOf("planScheduledPersist(rows.length");
  assert(calls[1] > firstDetail && calls[1] < persist, "the second sits before the scheduled persist plan");
  const near = (at: number) => src.slice(at, at + 300);
  assert(calls.every((at) => /refuseListingRun\(scrapeRunId, /.test(near(at))), "each refusal goes through refuseListingRun (nothing written)");
});

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("scriptCutOff: all assertions passed");
