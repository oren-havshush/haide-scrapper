// Run: npx tsx worker/lib/sweepBreaker.test.ts
//
// The breaker has to tell "the infrastructure has gone" from "some sites are
// broken", and both mistakes are expensive:
//
//   too eager  — the sweep halts on night one over three slow sites and never
//                reaches the rest of the fleet, every night, for ever;
//   too shy    — the browser stops launching at 03:05 and the sweep records a
//                failure against all 140 sites before anyone sees it.
//
// Most of these cases are the first kind, because that is the one that looks
// like working code.

import {
  BREAKER_THRESHOLD,
  QUALIFYING_SUCCESS_WINDOW_MS,
  SOFT_FAILURE_ALERT_RATIO,
  createBreakerState,
  recordOutcome,
  shouldAlertSoftFailures,
  type BreakerState,
} from "./sweepBreaker";
import { classifyOutcome, isSuccessfulRun, selectSitesForSweep } from "./sweepSelection";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const NOW = new Date("2026-09-14T03:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

/** Fold a list of outcomes, all on recently-healthy sites unless said otherwise. */
function fold(
  events: Array<{ outcome: string; lastSuccessAt?: Date | null }>,
): BreakerState {
  let state = createBreakerState();
  events.forEach((e, i) => {
    state = recordOutcome(state, {
      siteUrl: `https://site-${i}.test`,
      outcome: e.outcome,
      lastSuccessAt: e.lastSuccessAt === undefined ? daysAgo(1) : e.lastSuccessAt,
      now: NOW,
    });
  });
  return state;
}

// ---------------------------------------------------------------------------
// 1. Three hard failures on recently-healthy sites halt
// ---------------------------------------------------------------------------

{
  const two = fold([{ outcome: "hard_failure" }, { outcome: "hard_failure" }]);
  assert(!two.halted, "two hard failures do not halt");
  assert(two.consecutiveHard === 2, "but they are counted");

  const three = fold([
    { outcome: "hard_failure" },
    { outcome: "hard_failure" },
    { outcome: "hard_failure" },
  ]);
  assert(three.halted, "three consecutive hard failures halt the sweep");
  assert(
    three.haltReason !== null && three.haltReason.includes("consecutive hard failures"),
    "and the sweep records why",
  );
  assert(
    three.haltReason !== null && three.haltReason.includes("site-2"),
    "naming the site that tripped it, so the report has somewhere to start",
  );
}

assert(BREAKER_THRESHOLD === 3, "the threshold is three");

// ---------------------------------------------------------------------------
// 2. A success between them resets
// ---------------------------------------------------------------------------

{
  const state = fold([
    { outcome: "hard_failure" },
    { outcome: "hard_failure" },
    { outcome: "success" },
    { outcome: "hard_failure" },
    { outcome: "hard_failure" },
  ]);
  assert(!state.halted, "two, a success, then two more does not halt");
  assert(state.consecutiveHard === 2, "the streak restarted after the success");
  assert(state.hardTotal === 4, "though all four hard failures are still reported");
}

{
  // A success at the last possible moment.
  const state = fold([
    { outcome: "hard_failure" },
    { outcome: "hard_failure" },
    { outcome: "success" },
    { outcome: "hard_failure" },
  ]);
  assert(!state.halted, "a success on the third site prevents the halt on the fourth");
}

// ---------------------------------------------------------------------------
// 3. Three on long-broken sites do NOT halt
// ---------------------------------------------------------------------------

{
  // SCRAPE_TIMEOUT_MS is a per-site cap, so a dead site times out with the
  // infrastructure perfectly healthy. Halting over these would stop the sweep
  // on night one and every night after.
  const state = fold([
    { outcome: "hard_failure", lastSuccessAt: daysAgo(40) },
    { outcome: "hard_failure", lastSuccessAt: daysAgo(90) },
    { outcome: "hard_failure", lastSuccessAt: null },
  ]);
  assert(!state.halted, "three hard failures on long-broken sites do NOT halt");
  assert(state.consecutiveHard === 0, "they never enter the streak");
  assert(state.hardTotal === 3, "but they are all counted for the report");
  assert(state.hardUnqualified === 3, "and identified as unqualified");
}

{
  // A site that has never succeeded is the commonest unqualified case — five
  // REVIEW sites in tonight's real selection have never been attempted at all.
  const state = fold([
    { outcome: "hard_failure", lastSuccessAt: null },
    { outcome: "hard_failure", lastSuccessAt: null },
    { outcome: "hard_failure", lastSuccessAt: null },
    { outcome: "hard_failure", lastSuccessAt: null },
  ]);
  assert(!state.halted, "a site that never succeeded can never trip the breaker");
}

{
  // Unqualified failures must not RESET the streak either, or a long-broken
  // site between two real failures would hide an outage.
  const state = fold([
    { outcome: "hard_failure" },
    { outcome: "hard_failure", lastSuccessAt: daysAgo(60) },
    { outcome: "hard_failure" },
  ]);
  assert(
    state.consecutiveHard === 2,
    "an unqualified failure neither counts nor resets — the streak is 2, not 1 or 3",
  );
  assert(!state.halted, "so it has not halted yet");
}

{
  // The 7-day boundary.
  const inside = fold([
    { outcome: "hard_failure", lastSuccessAt: new Date(NOW.getTime() - QUALIFYING_SUCCESS_WINDOW_MS) },
  ]);
  assert(inside.consecutiveHard === 1, "exactly 7 days still qualifies");

  const outside = fold([
    {
      outcome: "hard_failure",
      lastSuccessAt: new Date(NOW.getTime() - QUALIFYING_SUCCESS_WINDOW_MS - 1),
    },
  ]);
  assert(outside.consecutiveHard === 0, "one millisecond past 7 days does not");
}

// ---------------------------------------------------------------------------
// 4. Soft failures never halt
// ---------------------------------------------------------------------------

{
  const state = fold([
    { outcome: "soft_failure" },
    { outcome: "soft_failure" },
    { outcome: "soft_failure" },
    { outcome: "soft_failure" },
    { outcome: "soft_failure" },
  ]);
  assert(!state.halted, "soft failures never halt, however many");
  assert(state.consecutiveHard === 0, "and never enter the streak");
  assert(state.softTotal === 5, "they are counted separately");
}

{
  // Soft failures must not reset either. Two hard failures with a soft one
  // between them is still two hard failures in a row as far as the
  // infrastructure is concerned.
  const state = fold([
    { outcome: "hard_failure" },
    { outcome: "soft_failure" },
    { outcome: "hard_failure" },
    { outcome: "hard_failure" },
  ]);
  assert(
    state.halted,
    "a soft failure does not shield the third hard failure — it neither counts nor resets",
  );
}

{
  const state = fold([
    { outcome: "soft_failure" },
    { outcome: "soft_failure" },
    { outcome: "success" },
    { outcome: "success" },
    { outcome: "success" },
  ]);
  assert(
    shouldAlertSoftFailures(state),
    "2 soft of 5 attempted is over the 20% ratio and is alerted",
  );
  assert(!state.halted, "but it is still not a halt");
}

{
  const state = fold([
    { outcome: "soft_failure" },
    ...Array.from({ length: 9 }, () => ({ outcome: "success" })),
  ]);
  assert(
    !shouldAlertSoftFailures(state),
    "1 of 10 is under the ratio and is not alerted",
  );
}

assert(!shouldAlertSoftFailures(createBreakerState()), "an empty sweep alerts nothing");
assert(SOFT_FAILURE_ALERT_RATIO === 0.2, "the ratio is 20%");

// ---------------------------------------------------------------------------
// 5. Outcomes that are decisions, not faults
// ---------------------------------------------------------------------------

for (const cat of [
  "orphaned",
  "interrupted",
  "oversize",
  "apply_requires_login",
  "cancelled",
]) {
  assert(
    classifyOutcome({ status: "FAILED", failureCategory: cat }) !== "hard_failure",
    `${cat} is not a hard failure — it is a decision or a diagnosis`,
  );
}

{
  // Three of them in a row, plus the driver's own outcome strings, must leave
  // the breaker exactly where it started.
  const state = fold([
    { outcome: "other" },
    { outcome: "skipped_conflict" },
    { outcome: "worker_not_draining" },
    { outcome: "withheld_skip" },
  ]);
  assert(!state.halted, "none of the driver's own outcomes can halt the sweep");
  assert(state.consecutiveHard === 0, "and none enters the streak");
  assert(state.hardTotal === 0, "nor is counted as a hard failure");
}

// ---------------------------------------------------------------------------
// 6. The shared success definition, across all three uses
// ---------------------------------------------------------------------------

{
  // One run, asked the three questions the plan says must agree.
  const run = { status: "COMPLETED", failureCategory: "empty_results" };

  assert(!isSuccessfulRun(run), "1. COMPLETED + empty_results is not a recent success");

  const afterTwoHard = fold([
    { outcome: "hard_failure" },
    { outcome: "hard_failure" },
    { outcome: classifyOutcome(run) },
    { outcome: "hard_failure" },
  ]);
  assert(
    afterTwoHard.halted,
    "2. it does not reset the breaker — the third hard failure still halts",
  );

  const selected = selectSitesForSweep(
    [
      {
        id: "s",
        siteUrl: "https://s.test",
        status: "ACTIVE",
        fieldMappings: { title: { selector: "h1" } },
        lastSuccessAt: null, // because that run was not a success
        lastAttemptAt: new Date(NOW.getTime() - 3_600_000),
      },
    ],
    { now: NOW },
  ).selected;
  assert(selected.length === 1, "3. it does not satisfy the 20h window — the site is due");
}

// ---------------------------------------------------------------------------
// A refused drop neither halts nor resets, and counts toward the alert
// ---------------------------------------------------------------------------

{
  const s = fold([
    { outcome: "hard_failure" },
    { outcome: "hard_failure" },
    { outcome: "suspicious_drop" },
    { outcome: "hard_failure" },
  ]);
  assert(s.halted, "a suspicious_drop between hard failures does not reset the streak");

  const drops = fold(Array.from({ length: 10 }, () => ({ outcome: "suspicious_drop" })));
  assert(!drops.halted, "ten refused drops never halt");
  assert(drops.consecutiveHard === 0, "and are not hard failures");
  assert(
    drops.softTotal === 10,
    `but count toward the soft-failure alert — many sites dropping on one night is a shared cause (got ${drops.softTotal})`,
  );
  assert(shouldAlertSoftFailures(drops), "which then alerts");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("sweepBreaker: an outage halts the night, broken sites do not");
