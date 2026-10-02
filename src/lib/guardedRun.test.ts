// Run: npx tsx src/lib/guardedRun.test.ts
//
// addsite2 phase two, step 3, option B: an operator without ssh asks for a
// guarded single-site run through the API, and a timer on the box claims it.
// The route's own gate, in addition to the token, refuses when:
//   - the site is not REVIEW (a fix has just demoted it, so it is REVIEW);
//   - a request for the site is already pending or running;
//   - a sweep is running;
//   - it is between 01:30 and 07:05 Asia/Jerusalem (the nightly and the 07:01
//     public read).
// The claim re-checks the last two when it runs.

import { inGuardedRunQuietWindow, planGuardedRunClaim, planGuardedRunRequest } from "./guardedRun";

let failures = 0;
const eq = (got: unknown, want: unknown, msg: string) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    console.error(`FAIL: ${msg}\n  got=${g}\n  want=${w}`);
    failures++;
  }
};

// Summer time: Jerusalem is UTC+3. Winter: UTC+2. The host clock is UTC.
const SUMMER_NOON = new Date("2026-10-02T09:00:00Z"); // 12:00 Jerusalem
const REVIEW = { status: "REVIEW" };
const code = (r: { ok: boolean; code?: string }) => (r.ok ? "ok" : r.code);

// --- the request gate ---------------------------------------------------------------
eq(code(planGuardedRunRequest(REVIEW, false, false, SUMMER_NOON)), "ok", "a REVIEW site, nothing pending, nothing running, midday: allowed");
eq(code(planGuardedRunRequest(null, false, false, SUMMER_NOON)), "SITE_NOT_FOUND", "no such site: refused");
for (const status of ["ACTIVE", "SKIPPED", "ANALYZING", "FAILED"]) {
  eq(code(planGuardedRunRequest({ status }, false, false, SUMMER_NOON)), "NOT_REVIEW", `a ${status} site: refused (only a site a fix has just demoted)`);
}
eq(code(planGuardedRunRequest(REVIEW, false, true, SUMMER_NOON)), "ALREADY_PENDING", "a request for the site already pending: refused");
eq(code(planGuardedRunRequest(REVIEW, true, false, SUMMER_NOON)), "SWEEP_RUNNING", "a sweep running: refused");
const refused = planGuardedRunRequest(REVIEW, true, false, SUMMER_NOON);
eq(!refused.ok && typeof refused.reason === "string" && refused.reason.length > 10, true, "a refusal says why");

// --- the quiet window, in Jerusalem time, on a UTC host -------------------------------
const at = (iso: string) => new Date(iso);
eq(inGuardedRunQuietWindow(at("2026-10-01T22:29:59Z")), false, "01:29:59 Jerusalem (summer): open");
eq(inGuardedRunQuietWindow(at("2026-10-01T22:30:00Z")), true, "01:30 Jerusalem (summer): closed");
eq(inGuardedRunQuietWindow(at("2026-10-02T01:00:00Z")), true, "04:00 Jerusalem: closed");
eq(inGuardedRunQuietWindow(at("2026-10-02T04:04:59Z")), true, "07:04:59 Jerusalem (summer): closed");
eq(inGuardedRunQuietWindow(at("2026-10-02T04:05:00Z")), false, "07:05 Jerusalem (summer): open");
eq(inGuardedRunQuietWindow(at("2026-12-01T23:30:00Z")), true, "01:30 Jerusalem (winter, UTC+2): closed");
eq(inGuardedRunQuietWindow(at("2026-12-01T23:29:00Z")), false, "01:29 Jerusalem (winter): open");
eq(inGuardedRunQuietWindow(at("2026-12-02T05:05:00Z")), false, "07:05 Jerusalem (winter): open");
eq(inGuardedRunQuietWindow(at("2026-12-02T05:04:00Z")), true, "07:04 Jerusalem (winter): closed");
eq(code(planGuardedRunRequest(REVIEW, false, false, at("2026-10-02T00:00:00Z"))), "QUIET_WINDOW", "a request at 03:00 Jerusalem: refused");

// --- the claim re-checks what can change while a request waits -------------------------
eq(code(planGuardedRunClaim(false, SUMMER_NOON)), "ok", "claim: nothing running, midday");
eq(code(planGuardedRunClaim(true, SUMMER_NOON)), "SWEEP_RUNNING", "claim: a sweep running, the request waits");
eq(code(planGuardedRunClaim(false, at("2026-10-01T23:00:00Z"))), "QUIET_WINDOW", "claim: inside the window, the request waits");

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("guardedRun: REVIEW only, one at a time, never during a sweep or the night");
