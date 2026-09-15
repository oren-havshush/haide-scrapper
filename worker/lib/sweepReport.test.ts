// Run: npx tsx worker/lib/sweepReport.test.ts

import {
  computeCounters,
  isStaleButGreen,
  needsAttention,
  renderSweepReport,
  sweepDate,
  verdictLine,
  type ReportItem,
  type ReportSweep,
} from "./sweepReport";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const TZ = "Asia/Jerusalem";
const STARTED = new Date("2026-09-10T00:05:00Z"); // 03:05 in Jerusalem

function sweep(over: Partial<ReportSweep> = {}): ReportSweep {
  return {
    id: "sw1",
    kind: "SCRAPE",
    status: "COMPLETED",
    trigger: "timer",
    startedAt: STARTED,
    finishedAt: new Date(STARTED.getTime() + 90 * 60_000),
    selectedCount: 145,
    haltReason: null,
    ...over,
  };
}

function item(over: Partial<ReportItem> = {}): ReportItem {
  return {
    siteId: over.siteId ?? "s1",
    siteUrl: over.siteUrl ?? "https://a.test",
    phase: "scrape",
    outcome: "success",
    failureCategory: null,
    jobsBefore: 10,
    jobsAfter: 10,
    newestJobAt: new Date(STARTED.getTime() + 60_000),
    siteStatus: "ACTIVE",
    wouldDemoteTo: null,
    wouldPromoteTo: null,
    ...over,
  };
}

const ok = (n: number) =>
  Array.from({ length: n }, (_, i) => item({ siteId: `s${i}`, siteUrl: `https://s${i}.test` }));

// ---------------------------------------------------------------------------
// The verdict line — three shapes
// ---------------------------------------------------------------------------

{
  // The date is the LOCAL date. 00:05 UTC is already the 10th in Jerusalem, so
  // a UTC label would be right here by luck; 22:00 UTC on the 9th would not.
  assert(sweepDate(STARTED, TZ) === "2026-09-10", "the Jerusalem date is used");
  assert(
    sweepDate(new Date("2026-09-09T22:00:00Z"), TZ) === "2026-09-10",
    "22:00 UTC on the 9th is already the 10th in Jerusalem — this is the off-by-one the TZ prevents",
  );
  assert(
    sweepDate(new Date("2026-09-09T22:00:00Z"), "UTC") === "2026-09-09",
    "and UTC would have labelled that same sweep the previous night",
  );
  assert(
    sweepDate(STARTED, "Not/AZone") === "2026-09-10",
    "an unknown timezone falls back rather than losing the report",
  );
}

{
  const items = [...ok(2), item({ siteId: "x", siteUrl: "https://x.test", wouldPromoteTo: "ACTIVE" })];
  const line = verdictLine(sweep(), items, { timeZone: TZ });
  assert(
    line === "Nightly sweep 2026-09-10: 145 sites, 1 need attention",
    `shape 1, the clean night: got "${line}"`,
  );
}

{
  // The 24 used to carry outcome "ok", which the driver never writes; it passed
  // only while "checked" counted attempts. "checked" now counts outcomes whose
  // job reached COMPLETED, so the fixture uses the outcome the driver writes.
  const items = [
    item({ siteId: "p1", phase: "policy", outcome: "newly_restricted" }),
    ...ok(24).map((i) => ({ ...i, phase: "policy", outcome: "success" })),
  ];
  const line = verdictLine(sweep({ kind: "POLICY", selectedCount: 25 }), items, { timeZone: TZ });
  assert(
    line === "Policy sweep 2026-09-10: 25 checked, 1 newly RESTRICTED",
    `shape 2, the policy sweep: got "${line}"`,
  );
}

{
  const items = [
    ...ok(38),
    ...Array.from({ length: 3 }, (_, i) =>
      item({ siteId: `f${i}`, siteUrl: `https://f${i}.test`, outcome: "hard_failure", failureCategory: "timeout" }),
    ),
  ];
  const line = verdictLine(sweep({ status: "HALTED", haltReason: "3 consecutive" }), items, {
    timeZone: TZ,
  });
  assert(
    line === "Nightly sweep 2026-09-10: HALTED after 3 failures — 41 of 145 done",
    `shape 3, the halt: got "${line}"`,
  );
}

{
  // A site qualifying twice must be counted once, or the verdict line lies.
  const twice = item({
    siteId: "d",
    siteUrl: "https://d.test",
    outcome: "hard_failure",
    failureCategory: "timeout",
    jobsBefore: 12,
    jobsAfter: 12,
    wouldDemoteTo: "REVIEW",
  });
  const lines = needsAttention(sweep(), [twice]);
  assert(lines.length === 1, "a site needing attention for two reasons is listed once");
  assert(
    lines[0].why.includes("demoted") && lines[0].why.includes("failed"),
    "with both reasons on the one line",
  );
}

// ---------------------------------------------------------------------------
// Counters come from the items — on BOTH paths
// ---------------------------------------------------------------------------

{
  // The bug this is for: the halt path wrote zeros for the three numbers that
  // say what the gate saved, on exactly the nights something went wrong.
  const items = [
    item({ siteId: "a", siteUrl: "https://a.test", wouldPromoteTo: "ACTIVE" }),
    item({ siteId: "b", siteUrl: "https://b.test", wouldDemoteTo: "REVIEW" }),
    item({
      siteId: "c",
      siteUrl: "https://c.test",
      outcome: "hard_failure",
      failureCategory: "timeout",
      jobsBefore: 30,
      jobsAfter: 30,
    }),
    item({ siteId: "d", siteUrl: "https://d.test", outcome: "soft_failure", failureCategory: "empty_results" }),
    item({ siteId: "e", siteUrl: "https://e.test", outcome: "skipped_conflict" }),
  ];

  const halted = computeCounters(sweep({ status: "HALTED" }), items);
  assert(halted.ok === 2, "ok counted on a HALTED sweep");
  assert(halted.failed === 1, "hard failures counted");
  assert(halted.silentDrift === 1, "soft failures counted as silent drift");
  assert(halted.skippedConflict === 1, "conflicts counted");
  assert(halted.wouldHavePromoted === 1, "wouldHavePromoted is NOT zero on a halt");
  assert(halted.wouldHaveDemoted === 1, "wouldHaveDemoted is NOT zero on a halt");
  assert(halted.listingsProtected === 1, "listingsProtected is NOT zero on a halt");

  const completed = computeCounters(sweep({ status: "COMPLETED" }), items);
  assert(
    JSON.stringify(completed) === JSON.stringify(halted),
    "and the COMPLETED path computes exactly the same numbers from the same items",
  );
}

{
  // listingsProtected is the withheld wipe, not a status verdict.
  const demoteOnly = item({ wouldDemoteTo: "REVIEW", jobsBefore: 9, jobsAfter: 9 });
  assert(
    computeCounters(sweep(), [demoteOnly]).listingsProtected === 0,
    "a demotion protects no listings — it touches no Job row",
  );

  const login = item({
    outcome: "withheld_skip",
    failureCategory: "apply_requires_login",
    jobsBefore: 9,
    jobsAfter: 9,
  });
  assert(
    computeCounters(sweep(), [login]).listingsProtected === 0,
    "an apply-login skip deletes nothing, so it protects nothing",
  );

  const cancelled = item({ outcome: "worker_not_draining", failureCategory: "cancelled", jobsBefore: 9 });
  assert(
    computeCounters(sweep(), [cancelled]).listingsProtected === 0,
    "a run the sweep cancelled itself protected nothing",
  );

  const empty = item({ outcome: "soft_failure", failureCategory: "empty_results", jobsBefore: 9, jobsAfter: 0 });
  assert(
    computeCounters(sweep(), [empty]).listingsProtected === 0,
    "empty_results is an early return that never reaches failScrapeRun",
  );
}

// ---------------------------------------------------------------------------
// Stale-but-green — from Job, not from the outcome
// ---------------------------------------------------------------------------

{
  // The fixture that matters: the outcome says success and the rows are old.
  // A healthy scrape recreates every row inside its transaction, so a createdAt
  // predating the sweep proves the run never reached that line.
  const stale = item({
    siteId: "g",
    siteUrl: "https://green.test",
    outcome: "success",
    newestJobAt: new Date(STARTED.getTime() - 86_400_000),
  });
  assert(isStaleButGreen(stale, STARTED), "success + rows older than the sweep is stale-but-green");

  const counters = computeCounters(sweep(), [stale]);
  assert(counters.ok === 1, "it still counts as ok — the run did report success");
  assert(counters.failed === 0, "and is not a failure");

  const attention = needsAttention(sweep(), [stale]);
  assert(attention.length === 1, "but it needs attention");
  assert(
    attention[0].why.includes("never persisted"),
    "and the reason says the run never persisted, which is what an operator acts on",
  );
}

{
  const fresh = item({ newestJobAt: new Date(STARTED.getTime() + 60_000) });
  assert(!isStaleButGreen(fresh, STARTED), "rows written after the sweep started are fine");

  const exactly = item({ newestJobAt: STARTED });
  assert(!isStaleButGreen(exactly, STARTED), "rows exactly at the start are not stale");

  const failed = item({
    outcome: "hard_failure",
    failureCategory: "timeout",
    newestJobAt: new Date(STARTED.getTime() - 86_400_000),
  });
  assert(
    !isStaleButGreen(failed, STARTED),
    "a failed run with old rows is just a failure — stale-but-green is about runs claiming success",
  );

  const never = item({ newestJobAt: null });
  assert(!isStaleButGreen(never, STARTED), "a site with no listings at all is not stale-but-green");
}

// ---------------------------------------------------------------------------
// The rendered report
// ---------------------------------------------------------------------------

{
  const items = [
    ...ok(3),
    item({ siteId: "z", siteUrl: "https://zero.test", jobsBefore: 14, jobsAfter: 0 }),
  ];
  const text = renderSweepReport(sweep(), items, { timeZone: TZ });
  const lines = text.split("\n");

  assert(
    lines[0] === verdictLine(sweep(), items, { timeZone: TZ }),
    "the verdict line is the FIRST line of the report",
  );
  for (const section of ["Ran", "Changed", "Needs attention", "Outcomes", "Gate"]) {
    assert(text.includes(section), `the report has a ${section} section`);
  }
  assert(text.includes("https://zero.test"), "a site that returned zero is named");
  assert(text.includes("returned 0 listings, had 14"), "with the count it used to have");
  assert(
    text.includes("silent drift"),
    "silent drift has its own bucket rather than sitting under failures",
  );
}

{
  const text = renderSweepReport(sweep({ status: "HALTED", haltReason: "3 consecutive hard failures" }), ok(4), {
    timeZone: TZ,
  });
  assert(text.includes("HALTED"), "a halted sweep says so");
  assert(text.includes("3 consecutive hard failures"), "and carries the halt reason");
  assert(text.includes("NOT REACHED 141"), "and how many sites it never got to");
}

{
  const clean = renderSweepReport(sweep({ selectedCount: 3 }), ok(3), { timeZone: TZ });
  assert(clean.includes("Needs attention (0)"), "a clean night needs attention from nobody");
  assert(clean.includes("nothing"), "and says so");
  assert(clean.split("\n").length < 30, `a clean night is one screen (${clean.split("\n").length} lines)`);
}

{
  // A defect the driver saw in memory reaches the report; the dashboard, which
  // has no defect column, simply renders nothing extra.
  const withDefect = item({ siteId: "d", siteUrl: "https://d.test", defect: "run flipped back to IN_PROGRESS" });
  assert(
    renderSweepReport(sweep(), [withDefect], { timeZone: TZ }).includes("DEFECT: run flipped back"),
    "a defect is surfaced in the report",
  );
  const noDefect = item({ siteId: "d", siteUrl: "https://d.test" });
  assert(
    !renderSweepReport(sweep(), [noDefect], { timeZone: TZ }).includes("DEFECT"),
    "and absent when there is none",
  );
}

// ---------------------------------------------------------------------------
// Drift, drops, skipped sites and warnings are named, not just counted
// ---------------------------------------------------------------------------

/** A block that throws is a failure of that block, not the end of the run. */
function check(name: string, body: () => void) {
  try {
    body();
  } catch (err) {
    console.error(`FAIL: ${name} threw: ${(err as Error).message}`);
    failures++;
  }
}

check("silent drift is named", () => {
  const drifted = item({
    siteId: "dr",
    siteUrl: "https://drift.test",
    outcome: "soft_failure",
    failureCategory: "empty_results",
    jobsBefore: 19,
    jobsAfter: 19,
    newestJobAt: new Date("2026-05-26T09:14:32Z"),
  });
  const neverHad = item({
    siteId: "nh",
    siteUrl: "https://never.test",
    outcome: "soft_failure",
    failureCategory: "structure_changed",
    jobsBefore: 0,
    jobsAfter: 0,
    newestJobAt: null,
    siteStatus: "REVIEW",
  });
  const lines = needsAttention(sweep(), [drifted, neverHad, ...ok(2)]);
  assert(lines.length === 2, `both drifted sites need attention (got ${lines.length})`);
  assert(
    lines[0]?.why === "silent drift (empty_results): 19 listing(s) on the site, newest 2026-05-26",
    `category, count and newest listing date (got "${lines[0]?.why}")`,
  );
  assert(
    lines[1]?.why === "silent drift (structure_changed): 0 listing(s) on the site, newest none",
    `a site with nothing published says none (got "${lines[1]?.why}")`,
  );
  assert(
    computeCounters(sweep(), [drifted]).silentDrift === 1,
    "and the silentDrift counter is unchanged",
  );
});

check("a refused drop is named with both counts", () => {
  const refused = item({
    siteId: "m",
    siteUrl: "https://maccabi.test",
    outcome: "suspicious_drop",
    failureCategory: "suspicious_drop",
    jobsBefore: 433,
    jobsAfter: 433,
    scrapedCount: 8,
  });
  const lines = needsAttention(sweep(), [refused]);
  assert(lines.length === 1, "a refused drop needs attention");
  assert(
    lines[0]?.why === "suspicious drop refused: scraped 8, had 433 — nothing written, 433 listing(s) kept",
    `with both counts (got "${lines[0]?.why}")`,
  );
  const c = computeCounters(sweep(), [refused]);
  assert(c.ok === 0 && c.failed === 0 && c.silentDrift === 0, "it is not ok, not a hard failure, not drift");
  assert(c.listingsProtected === 1, "and it protected the site's listings");
  assert(
    renderSweepReport(sweep(), [refused], { timeZone: TZ }).includes("suspicious_drop"),
    "its category has its own bucket under Outcomes",
  );
});

check("a committed drop is named", () => {
  // What maccabi4u looked like before the guard: success, 433 -> 8.
  const committed = item({ siteId: "c", siteUrl: "https://committed.test", jobsBefore: 433, jobsAfter: 8 });
  const lines = needsAttention(sweep(), [committed]);
  assert(lines.length === 1, "a success that fell below half of a 10+ site needs attention");
  assert(
    lines[0]?.why === "listings fell 433 -> 8 (-98%) and were written",
    `with both counts (got "${lines[0]?.why}")`,
  );

  assert(
    needsAttention(sweep(), [item({ jobsBefore: 433, jobsAfter: 217 })]).length === 0,
    "433 -> 217 is not below half",
  );
  assert(
    needsAttention(sweep(), [item({ jobsBefore: 9, jobsAfter: 1 })]).length === 0,
    "a site under the 10-listing minimum is not a drop",
  );
  assert(
    needsAttention(sweep(), [item({ phase: "policy", outcome: "success", jobsBefore: 40, jobsAfter: 4 })])
      .length === 0,
    "a policy item's counts are read, not written by the check — never a drop",
  );
  assert(
    needsAttention(sweep(), [committed], { timeZone: TZ, dropThresholds: { minPrevious: 500, keepRatio: 0.5 } })
      .length === 0,
    "the thresholds passed in are the ones applied",
  );
});

check("skipped sites and warnings are listed", () => {
  const warned = item({
    siteId: "w",
    siteUrl: "https://warned.test",
    warnings: ["region_over_city: 130 job(s) stored a region", "job_count_drop: 8 saved vs previous 433 (-98%)"],
  });
  const text = renderSweepReport(sweep({ selectedCount: 2 }), [warned, ...ok(1)], {
    timeZone: TZ,
    skipped: [
      { siteUrl: "https://fresh.test", reason: "succeeded 8h ago, inside the 20h window" },
      { siteUrl: "https://nomap.test", reason: "no usable fieldMappings (would fail immediately)" },
    ],
  });
  assert(text.includes("skipped   2 at selection"), `Ran counts the skipped sites\n${text}`);
  assert(text.includes("https://fresh.test — succeeded 8h ago, inside the 20h window"), "each with its reason");
  assert(text.includes("https://nomap.test — no usable fieldMappings"), "including a config exclusion");
  assert(text.includes("Warnings (1 sites)"), "the Warnings header counts sites");
  assert(text.includes("  job_count_drop (1)"), "warnings are grouped by type");
  assert(text.includes("https://warned.test — 8 saved vs previous 433 (-98%)"), "with the site and the detail");
  assert(
    text.includes("Needs attention (0)"),
    "a warning alone is surfaced, not counted as needing attention",
  );
  assert(
    !renderSweepReport(sweep(), ok(2), { timeZone: TZ }).includes("at selection"),
    "a report given no skipped list prints none",
  );
});

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("sweepReport: one verdict line, counters from items, stale-but-green from Job");
