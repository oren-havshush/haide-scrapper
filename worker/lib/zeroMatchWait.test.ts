// Run: npx tsx worker/lib/zeroMatchWait.test.ts
//
// The zero-match refusal records the run's waits (owner, 2026-10-12). tl-care,
// the 2026-10-12 sweep: the SiteGround wait ran and logged "challenge_wait:
// SiteGround interactive captcha after 11.5 s — blocked", but zeroMatchRefusal
// built its own warnings without guard.challengeWaits, so the item carried only
// blocked_challenge. Every branch of the refusal now carries the waits, as the
// written, empty, dropped and crashed runs already did (challengeWarnings).

import { newExtractGuard, onExplicitZeroMatch, zeroMatchRefusal } from "./zeroMatch";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const WAIT = "challenge_wait: SiteGround interactive captcha after 11.5 s — blocked";
const SETTLED = "challenge_wait: SiteGround ipr settled on the listing in 2.7 s";
const CF_TITLE = String.fromCharCode(0x5e8, 0x5e7, 0x20, 0x5e8, 0x5d2, 0x5e2) + "...";

// tl-care's night: a SiteGround challenge, the wait's record, a zero match.
{
  const g = newExtractGuard(true);
  g.challenge = "SiteGround challenge (sg-captcha: challenge)";
  g.challengeWaits.push(WAIT);
  onExplicitZeroMatch(g, ".elementor-accordion .elementor-accordion-item", "");
  const r = zeroMatchRefusal(g, 0);
  assert(r?.failureCategory === "blocked", `tl-care's night is blocked (got ${r?.failureCategory})`);
  assert((r?.warnings ?? []).includes(WAIT), `the host-challenge branch records the wait (got ${JSON.stringify(r?.warnings)})`);
}
// The Cloudflare-title branch.
{
  const g = newExtractGuard(true);
  g.challengeWaits.push(SETTLED);
  onExplicitZeroMatch(g, "body #root", CF_TITLE);
  const r = zeroMatchRefusal(g, 0);
  assert(r?.failureCategory === "blocked", "a Cloudflare title is blocked");
  assert((r?.warnings ?? []).includes(SETTLED), `the Cloudflare-title branch records the wait (got ${JSON.stringify(r?.warnings)})`);
}
// The host_error branch.
{
  const g = newExtractGuard(true);
  g.hostError = "HTTP 503 (Service Unavailable)";
  g.challengeWaits.push(SETTLED);
  onExplicitZeroMatch(g, ".productDiv", "Service Unavailable");
  const r = zeroMatchRefusal(g, 0);
  assert(r?.failureCategory === "host_error", "a 5xx is host_error");
  assert((r?.warnings ?? []).includes(SETTLED), `the host_error branch records the wait (got ${JSON.stringify(r?.warnings)})`);
}
// The structure_changed branch: a wait that settled, then no match.
{
  const g = newExtractGuard(true);
  g.challengeWaits.push(SETTLED);
  onExplicitZeroMatch(g, ".x", "Real page");
  const r = zeroMatchRefusal(g, 0);
  assert(r?.failureCategory === "structure_changed", "settled then no match: structure_changed");
  assert((r?.warnings ?? []).includes(SETTLED), `the structure_changed branch records the wait (got ${JSON.stringify(r?.warnings)})`);
}
// No wait, no wait line; and the warnings it had before are unchanged.
{
  const g = newExtractGuard(true);
  g.challenge = "Cloudflare challenge (cf-mitigated: challenge)";
  onExplicitZeroMatch(g, ".x", "x");
  const r = zeroMatchRefusal(g, 0);
  assert(
    JSON.stringify(r?.warnings) === JSON.stringify(["item_selector_zero_match: .x", "blocked_challenge: Cloudflare challenge (cf-mitigated: challenge)"]),
    `no wait: the same two warnings as before (got ${JSON.stringify(r?.warnings)})`,
  );
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("zeroMatchWait: every branch of the zero-match refusal records the run's waits");
