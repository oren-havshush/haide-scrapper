// Guarded single-site runs requested through the API (addsite2 phase two,
// step 3, option B). Pure: the route and the claim in worker/sweep/nightly.ts
// both decide here.
//
// An operator without ssh asks for the run with POST /api/sites/[id]/guarded-run;
// a GuardedRunRequest row waits; a timer on the box claims it every two minutes
// and runs the existing single-site driver (nightly.ts --site <id> --now
// semantics, email off). The run never goes through the worker's FIFO scrape.

export type GuardedRunGate =
  | { ok: true }
  | { ok: false; code: "SITE_NOT_FOUND" | "NOT_REVIEW" | "ALREADY_PENDING" | "SWEEP_RUNNING" | "QUIET_WINDOW"; reason: string };

/** 01:30 to 07:05 Asia/Jerusalem: the nightly sweep and the public site's 07:01 read. */
const QUIET_START_MIN = 1 * 60 + 30;
const QUIET_END_MIN = 7 * 60 + 5;
const TIME_ZONE = "Asia/Jerusalem";

/** Minutes since midnight in Jerusalem, whatever the host clock says (the box is UTC). */
function jerusalemMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

/** Inside 01:30 (inclusive) to 07:05 (exclusive), Jerusalem time. */
export function inGuardedRunQuietWindow(now: Date): boolean {
  const m = jerusalemMinutes(now);
  return m >= QUIET_START_MIN && m < QUIET_END_MIN;
}

const quiet: GuardedRunGate = {
  ok: false,
  code: "QUIET_WINDOW",
  reason: "guarded runs are not taken between 01:30 and 07:05 Asia/Jerusalem (the nightly sweep and the 07:01 public read)",
};
const sweepRunning: GuardedRunGate = {
  ok: false,
  code: "SWEEP_RUNNING",
  reason: "a sweep is running; ask again when it has finished",
};

/**
 * The route's gate, in addition to the token. `pending` is a request for this
 * site still PENDING or RUNNING; `activeSweep` is any ScrapeSweep RUNNING.
 */
export function planGuardedRunRequest(
  site: { status: string } | null,
  activeSweep: boolean,
  pending: boolean,
  now: Date,
): GuardedRunGate {
  if (!site) return { ok: false, code: "SITE_NOT_FOUND", reason: "no such site" };
  if (site.status !== "REVIEW") {
    return {
      ok: false,
      code: "NOT_REVIEW",
      reason: `the site is ${site.status}; a guarded run is for a site a config fix has just moved to REVIEW`,
    };
  }
  if (pending) return { ok: false, code: "ALREADY_PENDING", reason: "a guarded run for this site is already pending or running" };
  if (activeSweep) return sweepRunning;
  if (inGuardedRunQuietWindow(now)) return quiet;
  return { ok: true };
}

/** The claim re-checks what can change while a request waits; a refused claim leaves the row PENDING. */
export function planGuardedRunClaim(activeSweep: boolean, now: Date): GuardedRunGate {
  if (activeSweep) return sweepRunning;
  if (inGuardedRunQuietWindow(now)) return quiet;
  return { ok: true };
}
