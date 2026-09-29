// Run: npx tsx worker/lib/zeroMatch.test.ts
//
// 2026-09-29, night one: biopharmax's configured item selector
// (.jet-listing-grid__item) matched nothing — the site shows JetEngine's
// "no listings" block — and the worker fell back to auto-detect, which built a
// "job" titled EN out of the language switcher and published it. A wrong value
// is worse than a missing one.
//
// On a scheduled run a configured item selector that matches zero elements is
// now a listing refusal: category structure_changed, nothing stored, the
// previous rows kept, and never a fallback to auto-detect. The manual path is
// unchanged until the owner decides.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ZERO_MATCH_WARNING,
  newExtractGuard,
  onExplicitZeroMatch,
  zeroMatchRefusal,
} from "./zeroMatch";

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
  } catch (e) {
    console.error(`FAIL: ${name} threw — ${(e as Error).message}`);
    failures++;
  }
}

const SEL = "body .jet-listing-grid__item";

check("the decision", () => {
  const scheduled = newExtractGuard(true);
  assert(scheduled.noAutoDetect === true, "a scheduled run never falls back to auto-detect");
  assert(onExplicitZeroMatch(scheduled, SEL) === "refuse", "a zero match on a scheduled run refuses");
  assert(scheduled.zeroMatch === SEL, "and records which selector matched nothing");

  const manual = newExtractGuard(false);
  assert(manual.noAutoDetect === false, "the manual path keeps its fallback");
  assert(onExplicitZeroMatch(manual, SEL) === "auto-detect", "a manual zero match still auto-detects (unchanged)");
  assert(manual.zeroMatch === null, "and records nothing");
  assert(onExplicitZeroMatch(null, SEL) === "auto-detect", "no guard (other callers) is today's behaviour");
});

check("the refusal", () => {
  const g = newExtractGuard(true);
  onExplicitZeroMatch(g, SEL);
  const r = zeroMatchRefusal(g, 0);
  assert(!!r, "a scheduled zero match with no rows is refused");
  assert(r?.failureCategory === "structure_changed", `category structure_changed (${r?.failureCategory})`);
  assert(!!r && r.error.includes("item selector matched nothing") && r.error.includes(SEL), `the error says so (${r?.error})`);
  assert(
    !!r && r.warnings.length === 1 && r.warnings[0] === `${ZERO_MATCH_WARNING}: ${SEL}`,
    `one warning the report can name (${JSON.stringify(r?.warnings)})`,
  );

  assert(zeroMatchRefusal(g, 5) === null, "rows from another page or listing URL: not this refusal's call");
  assert(zeroMatchRefusal(newExtractGuard(true), 0) === null, "no zero match recorded: the ordinary empty path");
  const m = newExtractGuard(false);
  onExplicitZeroMatch(m, SEL);
  assert(zeroMatchRefusal(m, 0) === null, "never on the manual path");
  assert(zeroMatchRefusal(null, 0) === null, "nor with no guard");
});

check("scrape.ts wires it where it counts", () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const src = strip(readFileSync(join(__dirname, "..", "jobs", "scrape.ts"), "utf8"));
  const body = (name: string) => {
    const lines = src.split("\n");
    const start = lines.findIndex((l) => new RegExp(`^(export )?(async )?function ${name}\\(`).test(l));
    const end = lines.findIndex((l, i) => i > start && l === "}");
    return start < 0 || end < 0 ? "" : lines.slice(start, end + 1).join("\n");
  };

  // 1. The fallback is not reached on a refusal.
  const once = body("extractRawFieldsFromListingPageOnce");
  assert(once.length > 500, `extractRawFieldsFromListingPageOnce extracted (${once.length})`);
  const decide = once.indexOf("onExplicitZeroMatch(");
  const fallback = once.lastIndexOf("extractWithAutoItemDetection(");
  assert(decide > 0 && decide < fallback, "the zero-match decision comes before the auto-detect fallback");
  assert(
    /onExplicitZeroMatch\([^)]*\)\s*===\s*"refuse"\)\s*\{?\s*return \[\];/.test(once.replace(/\s+/g, " ")),
    "and on refuse it returns no rows — the fallback is never called",
  );

  // 2. The guard is the run's own, and only a scheduled run's refuses.
  assert(/extract:\s*newExtractGuard\(scheduled\)/.test(src), "RunMode.extract = newExtractGuard(scheduled)");

  // 3. A zero match on a scheduled run stores no rows and keeps the previous ones.
  const exec = body("executeScrape");
  const refusalAt = exec.indexOf("zeroMatchRefusal(runMode.extract");
  const listing = exec.indexOf("decideListingOutcome(");
  const persist = exec.indexOf("buildJobRows(");
  // The detail phase starts here (the pending-seed check inside extractOneTarget
  // is earlier in the text but is the listing walk, not a detail visit).
  const pending = exec.indexOf("const pendingSeeds =");
  assert(refusalAt > listing, "the refusal is decided after the listing outcome");
  assert(refusalAt > 0 && refusalAt < persist && refusalAt < pending, "and before any detail page or any row is built");
  assert(
    /const zeroMatch = zeroMatchRefusal\(runMode\.extract, rawFieldsList\.length\);\s*if \(zeroMatch\) \{?\s*return await refuseListingRun\(scrapeRunId, zeroMatch\);/.test(
      exec.replace(/\s+/g, " "),
    ),
    "it returns through refuseListingRun",
  );
  const refuse = body("refuseListingRun");
  assert(refuse.length > 200, "refuseListingRun extracted");
  for (const w of ["job.create", "job.createMany", "job.delete", "job.deleteMany", "job.update", "$transaction"]) {
    assert(!refuse.includes(w), `refuseListingRun writes no Job row (${w}) — previous rows are kept, none stored`);
  }
});

check("the report says what happened", () => {
  const report = readFileSync(join(__dirname, "sweepReport.ts"), "utf8");
  assert(report.includes("item selector matched nothing"), "Needs attention names it");
});

// The report behaviour itself, on the item a refusal leaves behind.
void (async () => {
  const { needsAttention } = await import("./sweepReport");
  const g = newExtractGuard(true);
  onExplicitZeroMatch(g, SEL);
  const r = zeroMatchRefusal(g, 0)!;
  const lines = needsAttention(
    { id: "s", kind: "SCRAPE", status: "COMPLETED", trigger: "timer", startedAt: new Date(), finishedAt: new Date(), selectedCount: 1, haltReason: null },
    [{
      siteId: "b", siteUrl: "https://www.biopharmax.com/he/careers/", phase: "scrape", outcome: "soft_failure",
      failureCategory: r.failureCategory, jobsBefore: 4, jobsAfter: 4, newestJobAt: null, siteStatus: "ACTIVE",
      wouldDemoteTo: null, wouldPromoteTo: null, warnings: r.warnings,
    }],
    { timeZone: "Asia/Jerusalem" },
  );
  const why = lines[0]?.why ?? "";
  if (!why.includes(`item selector matched nothing (${SEL})`) || !why.includes("4 listing(s) kept") || why.includes("silent drift")) {
    console.error(`FAIL: the Needs-attention line names the zero match, not drift (${why})`);
    process.exitCode = 1;
  }
})();

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("zeroMatch: a scheduled run never publishes auto-detected cards for a selector that matched nothing");
