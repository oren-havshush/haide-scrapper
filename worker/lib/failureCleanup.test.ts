// Run: npx tsx worker/lib/failureCleanup.test.ts
//
// Guards the rule that replaced the dispatcher's delete-everything catch block.
// The property under test is negative — "nothing is destroyed" — so the cases
// that matter most are the ones asserting a *settled* status is left alone.

import {
  planFailureCleanup,
  readScrapeRunId,
  TRANSIENT_SITE_STATUS,
} from "./failureCleanup";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

// --- the ANALYZING rescue (N1) -----------------------------------------
// handleAnalysisJob has no catch of its own, so every analysis failure lands in
// the dispatcher. Without this rescue the site stays ANALYZING forever, where
// it cannot be scraped and does not appear in the failures view.

{
  const c = planFailureCleanup({ siteStatus: "ANALYZING", scrapeRunId: null });
  assert(c.rescueSite, "ANALYZING is rescued");
  assert(c.emitStatusChange, "a real status change is announced");
}

// scanUrlForPolicy also creates sites in ANALYZING and hands them to a
// POLICY_REVIEW job, which is why the rule keys off status and not job type.
assert(
  planFailureCleanup({ siteStatus: TRANSIENT_SITE_STATUS, scrapeRunId: "run_1" }).rescueSite,
  "the rescue is status-driven, so a policy job on an ANALYZING site rescues too",
);

// --- settled statuses are never touched (R2, D) -------------------------
// This is the safeguard itself. Each of these would previously have had every
// Job row deleted and the site set FAILED.

for (const status of ["ACTIVE", "REVIEW", "FAILED", "SKIPPED"]) {
  const c = planFailureCleanup({ siteStatus: status, scrapeRunId: "run_1" });
  assert(!c.rescueSite, `${status} is settled and is left alone`);
  assert(!c.emitStatusChange, `${status} emits no phantom status change`);
}

// An unknown or missing status is not ANALYZING, so it is left alone too —
// the rule fails closed, never destructive.
assert(!planFailureCleanup({ siteStatus: null, scrapeRunId: null }).rescueSite, "null status is left alone");
assert(
  !planFailureCleanup({ siteStatus: undefined, scrapeRunId: null }).rescueSite,
  "missing status is left alone",
);
assert(
  !planFailureCleanup({ siteStatus: "analyzing", scrapeRunId: null }).rescueSite,
  "status match is exact, not case-insensitive",
);

// --- closing the orphaned ScrapeRun (F3) --------------------------------
// Leaving the run IN_PROGRESS blocks createScrapeRun with a ConflictError until
// a reaper pass, which can be a day away.

assert(
  planFailureCleanup({ siteStatus: "ACTIVE", scrapeRunId: "run_1" }).closeScrapeRun,
  "a linked run is closed even when the site is left untouched",
);
assert(
  !planFailureCleanup({ siteStatus: "ACTIVE", scrapeRunId: null }).closeScrapeRun,
  "no link means nothing to close",
);
assert(
  !planFailureCleanup({ siteStatus: "ACTIVE", scrapeRunId: "" }).closeScrapeRun,
  "an empty link is not a link",
);

// --- reading the link out of the payload --------------------------------

assert(readScrapeRunId({ scrapeRunId: "run_1" }) === "run_1", "reads the id from the payload");
assert(readScrapeRunId({ scrapeRunId: "run_1", maxJobs: 5 }) === "run_1", "ignores other payload keys");
assert(readScrapeRunId({}) === null, "absent key yields null");
assert(readScrapeRunId(null) === null, "null payload yields null");
assert(readScrapeRunId(undefined) === null, "undefined payload yields null");
assert(readScrapeRunId("run_1") === null, "a bare string payload is not a link");
assert(readScrapeRunId([{ scrapeRunId: "run_1" }]) === null, "an array payload is not a link");
assert(readScrapeRunId({ scrapeRunId: 42 }) === null, "a non-string id is not a link");
assert(readScrapeRunId({ scrapeRunId: "" }) === null, "an empty id is not a link");

// ANALYSIS jobs carry no payload at all (siteService creates them bare), which
// must not throw.
assert(readScrapeRunId({ reviewSource: "direct_discovery" }) === null, "a policy payload has no run link");

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("failureCleanup: all assertions passed");
