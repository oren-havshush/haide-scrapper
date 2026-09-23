// When to stop the night.
//
// The breaker exists for one failure: the infrastructure has gone, and the sweep
// is about to walk the whole fleet recording a failure against every site. It
// does NOT exist to notice that individual sites are broken — that is normal,
// there are always a few, and halting over them would mean the sweep never
// reaches the end of the queue.
//
// Telling those apart needs two ideas, and both are easy to get wrong.
//
// ---------------------------------------------------------------------------
// 1. Only some failures are evidence about the infrastructure
// ---------------------------------------------------------------------------
//
// A hard failure is `FAILED` with `timeout` or `other` — a browser that would
// not launch, a page that never answered, an exception nobody categorised.
//
// Everything else is a decision or a diagnosis, not a fault:
//
//   orphaned             a reaper tidying up after an earlier crash
//   interrupted          the worker was restarted
//   oversize             the extraction refused an implausible row count
//   apply_requires_login the site cannot be applied to at all
//   cancelled            the sweep itself stopped the job
//   empty_results        the site published nothing, or its selectors died
//   structure_changed    nothing survived validation
//   suspicious_drop      the run extracted a fraction of the site's listings
//                        and the undersize guard refused to write them
//   listing_url_failed   one of the site's listing pages errored
//   listing_url_empty    one of them went dark where it had listings
//   listing_urls_removed the site holds listings from a page no longer configured
//                        (all three: the run refused to publish a partial set)
//
// Counting any of them would halt the night for reasons that say nothing about
// whether the next site would scrape.
//
// ---------------------------------------------------------------------------
// 2. A hard failure only counts if the site worked recently
// ---------------------------------------------------------------------------
//
// SCRAPE_TIMEOUT_MS is a PER-SITE 15-minute cap. A site that is slow, huge, or
// quietly dead times out with the infrastructure in perfect health, and there
// are always some. Three of those in a row would halt the sweep on night one
// and every night after, because ordering is deterministic enough that the same
// broken sites cluster.
//
// Only a site that succeeded **within the last 7 days** and is now failing is
// evidence that something changed. Failures on long-broken sites are counted
// and reported — they are the manual-review queue — but they never halt.

import type { Outcome } from "./sweepSelection";

/** Three consecutive qualified hard failures stop the sweep. */
export const BREAKER_THRESHOLD = 3;

/** A hard failure counts only if the site succeeded inside this window. */
export const QUALIFYING_SUCCESS_WINDOW_MS = 7 * 24 * 60 * 60_000; // 7 days

/**
 * Soft failures never halt, but past this share of the night they stop being
 * per-site config death and start looking like a shared ATS re-theme or an IP
 * block. Reported, never enforced.
 */
export const SOFT_FAILURE_ALERT_RATIO = 0.2;

export type BreakerState = {
  /** Consecutive QUALIFIED hard failures. Unqualified ones do not touch this. */
  consecutiveHard: number;
  halted: boolean;
  haltReason: string | null;
  /** Every hard failure, qualified or not — the report wants both numbers. */
  hardTotal: number;
  /** Hard failures that did not count because the site has not worked lately. */
  hardUnqualified: number;
  softTotal: number;
  attempted: number;
};

export function createBreakerState(): BreakerState {
  return {
    consecutiveHard: 0,
    halted: false,
    haltReason: null,
    hardTotal: 0,
    hardUnqualified: 0,
    softTotal: 0,
    attempted: 0,
  };
}

export type BreakerEvent = {
  siteUrl: string;
  outcome: Outcome | string;
  /** The site's last success BEFORE tonight's run. Null if it never has. */
  lastSuccessAt: Date | null;
  now: Date;
};

/**
 * Fold one site's result into the breaker. Pure: returns a new state.
 *
 * The three cases that are NOT "increment or reset" are the whole subtlety:
 *
 *   an unqualified hard failure  counts in the report, leaves the streak alone;
 *   a soft failure               neither counts nor resets;
 *   anything else                neither counts nor resets.
 *
 * "Neither" matters. If a soft failure reset the streak, two hard failures
 * either side of one `empty_results` would never add up, and the breaker would
 * miss a real outage. If it incremented, a fleet-wide selector change would
 * halt a night when the infrastructure was fine.
 */
export function recordOutcome(state: BreakerState, event: BreakerEvent): BreakerState {
  const next: BreakerState = { ...state, attempted: state.attempted + 1 };

  if (event.outcome === "success") {
    // The ONLY thing that resets the streak — and only the shared success
    // definition counts as one. A COMPLETED carrying a failureCategory is
    // classified `soft_failure` before it ever reaches here.
    next.consecutiveHard = 0;
    return next;
  }

  if (event.outcome === "soft_failure" || event.outcome === "suspicious_drop") {
    // A refused drop is a result the site could not be trusted for, like
    // drift. One is about that site; many on one night is the shared-cause
    // signature the soft-failure alert looks for, so it counts toward it.
    next.softTotal = state.softTotal + 1;
    return next; // neither counts nor resets
  }

  if (event.outcome !== "hard_failure") {
    return next; // a decision, a cancellation, a skip — not a fault
  }

  next.hardTotal = state.hardTotal + 1;

  const qualified =
    event.lastSuccessAt !== null &&
    event.now.getTime() - event.lastSuccessAt.getTime() <= QUALIFYING_SUCCESS_WINDOW_MS;

  if (!qualified) {
    // Reported, never halting. Leaves the streak untouched: a long-broken site
    // failing again is not evidence either way about tonight.
    next.hardUnqualified = state.hardUnqualified + 1;
    return next;
  }

  next.consecutiveHard = state.consecutiveHard + 1;
  if (next.consecutiveHard >= BREAKER_THRESHOLD) {
    next.halted = true;
    next.haltReason =
      `${next.consecutiveHard} consecutive hard failures on sites that succeeded ` +
      `within ${QUALIFYING_SUCCESS_WINDOW_MS / 86_400_000} days (last: ${event.siteUrl})`;
  }
  return next;
}

/**
 * Soft failures above the alert ratio. Never halts — this is a line in the
 * report, and the signature it is looking for is many sites breaking the same
 * way on the same night.
 */
export function shouldAlertSoftFailures(state: BreakerState): boolean {
  if (state.attempted === 0) return false;
  return state.softTotal / state.attempted > SOFT_FAILURE_ALERT_RATIO;
}
