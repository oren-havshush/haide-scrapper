// Run: npx tsx worker/lib/sweepBudget.test.ts
//
// Two numbers that decide what the night does, and one alert that decides
// whether anyone believes the report.
//
//   1. The enqueue budget has to end early enough that the LAST site's run is
//      finished before the public jobs site reads this database at 07:01. That
//      site reads the Job table directly and keeps its own copy for the day, so
//      a run still writing at 07:00 is published half-done for 24 hours.
//   2. The soft-failure alert claims "many sites, one shared cause". Over one
//      site it is not a claim, it is arithmetic.

import {
  createBreakerState,
  recordOutcome,
  shouldAlertSoftFailures,
  SOFT_FAILURE_ALERT_MIN_ATTEMPTED,
  SOFT_FAILURE_ALERT_RATIO,
  type BreakerState,
} from "./sweepBreaker";
import { sweepConfig } from "../../src/lib/config";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

// ---------------------------------------------------------------------------
console.log("# the enqueue budget ends before the public site reads");
// ---------------------------------------------------------------------------
{
  delete process.env.SWEEP_MAX_RUNTIME_MINUTES;
  const cap = sweepConfig.maxRuntimeMinutes;
  assert(cap === 260, `the default enqueue budget is 260 minutes (got ${cap})`);

  // The arithmetic the number comes from, written out so a future change to
  // either end of it fails here rather than at 07:01 one morning.
  const SCRAPE_STARTS_MIN = 2 * 60; // 02:00, the timer in part 4
  const PUBLIC_SITE_READS_MIN = 7 * 60 + 1; // 07:01, daily
  const lastEnqueue = SCRAPE_STARTS_MIN + cap;
  const lastFinish = lastEnqueue + sweepConfig.perSiteTimeoutMinutes;

  assert(
    lastFinish < PUBLIC_SITE_READS_MIN,
    `the last site can finish before the public read: enqueue stops ${lastEnqueue}m, ` +
      `worst finish ${lastFinish}m, public read ${PUBLIC_SITE_READS_MIN}m`,
  );
  assert(
    lastFinish <= 7 * 60,
    `with the whole run settled before 07:00 (worst finish ${lastFinish}m)`,
  );
  // And it is not absurdly conservative either — a fleet of 145 sites needs the
  // hours. The old value, 300, is what fails the check above.
  assert(
    SCRAPE_STARTS_MIN + 300 + sweepConfig.perSiteTimeoutMinutes > PUBLIC_SITE_READS_MIN,
    "the previous 300-minute budget really did run past the public read — this is the reason",
  );
  assert(cap >= 240, `and the budget is still long enough for the fleet (${cap}m)`);

  // Still overridable, for a catch-up run by hand.
  process.env.SWEEP_MAX_RUNTIME_MINUTES = "45";
  assert(sweepConfig.maxRuntimeMinutes === 45, "the env var still overrides it");
  delete process.env.SWEEP_MAX_RUNTIME_MINUTES;
}

// ---------------------------------------------------------------------------
console.log("# the soft-failure alert needs enough sites to mean anything");
// ---------------------------------------------------------------------------
{
  const soft = (n: number, attemptedExtra = 0): BreakerState => {
    let s = createBreakerState();
    for (let i = 0; i < n; i++) {
      s = recordOutcome(s, {
        siteUrl: `https://soft${i}.test`,
        outcome: "soft_failure",
        lastSuccessAt: null,
        now: new Date(),
      });
    }
    for (let i = 0; i < attemptedExtra; i++) {
      s = recordOutcome(s, {
        siteUrl: `https://ok${i}.test`,
        outcome: "success",
        lastSuccessAt: null,
        now: new Date(),
      });
    }
    return s;
  };

  // The case this exists for: `nightly.ts --site <id> --now`, one site, empty.
  // 1/1 is 100% — and the report would have announced a fleet-wide shared cause
  // over a single site an operator deliberately re-ran.
  const one = soft(1);
  assert(one.attempted === 1 && one.softTotal === 1, "one site attempted, one soft failure");
  assert(one.softTotal / one.attempted > SOFT_FAILURE_ALERT_RATIO, "which is over the ratio");
  assert(!shouldAlertSoftFailures(one), "and the alert is withheld anyway");

  for (let n = 1; n < SOFT_FAILURE_ALERT_MIN_ATTEMPTED; n++) {
    assert(
      !shouldAlertSoftFailures(soft(n)),
      `${n} site(s), all soft: still no alert (below the ${SOFT_FAILURE_ALERT_MIN_ATTEMPTED} floor)`,
    );
  }

  // At the floor it starts working again, and it still measures the ratio.
  const five = soft(SOFT_FAILURE_ALERT_MIN_ATTEMPTED);
  assert(
    shouldAlertSoftFailures(five),
    `${SOFT_FAILURE_ALERT_MIN_ATTEMPTED} sites, all soft: the alert fires`,
  );
  assert(
    !shouldAlertSoftFailures(soft(1, 9)),
    "10 sites with 1 soft failure is under the ratio, so no alert — the floor did not replace the ratio",
  );
  assert(
    shouldAlertSoftFailures(soft(30, 110)),
    "30 of 140 on a real night still alerts",
  );
  assert(!shouldAlertSoftFailures(createBreakerState()), "and an empty night never alerts");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nsweepBudget: the night ends before the morning, and the alert means what it says");
