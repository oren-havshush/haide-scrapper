// Run: npx tsx worker/lib/challengePassed.test.ts
//
// A challenge passed on a written run (owner, 2026-10-11). fritz, the
// 2026-10-11 sweep: the listing answered 307, then 403 from Cloudflare with
// cf-mitigated: challenge ("Just a moment..."); the page's own script passed it,
// the listing loaded, and 9 real rows were written. The run still recorded
// "blocked_challenge: …", so the item and the warnings tally read as blocked.
// A run that wrote rows records "challenge_passed: <detail>"; every run that
// did not write keeps the blocked wording.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { challengeWarnings } from "./challengeWait";
import { BLOCKED_WARNING, CHALLENGE_PASSED_WARNING, newExtractGuard, noteChallengeResponse } from "./zeroMatch";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const LISTING = "https://www.fritz.co.il/open-positions/";
const CF_DETAIL = "Cloudflare challenge (cf-mitigated: challenge)";

/** fritz's night: 307, then 403 with cf-mitigated, then the listing. */
function fritzGuard() {
  const guard = newExtractGuard(true);
  noteChallengeResponse(guard, LISTING, { server: "cloudflare", location: LISTING });
  noteChallengeResponse(guard, LISTING, { server: "cloudflare", "cf-mitigated": "challenge", "content-type": "text/html; charset=UTF-8" });
  return guard;
}

assert(CHALLENGE_PASSED_WARNING === "challenge_passed", "the warning type is challenge_passed");

// A written run of 9: passed, never blocked.
{
  const guard = fritzGuard();
  assert(guard.challenge === CF_DETAIL, `the 403 is recorded as the run's challenge (got ${guard.challenge})`);
  const w = challengeWarnings(guard, true);
  assert(w.includes(`challenge_passed: ${CF_DETAIL}`), `fritz's written run records challenge_passed (got ${JSON.stringify(w)})`);
  assert(!w.some((x) => x.startsWith(`${BLOCKED_WARNING}:`)), `and no blocked_challenge (got ${JSON.stringify(w)})`);
}

// A run that wrote nothing keeps the blocked wording.
{
  const guard = fritzGuard();
  const w = challengeWarnings(guard, false);
  assert(w.includes(`blocked_challenge: ${CF_DETAIL}`), `a blocked run still records blocked_challenge (got ${JSON.stringify(w)})`);
  assert(!w.some((x) => x.startsWith("challenge_passed:")), "and never challenge_passed");
  const d = challengeWarnings(guard);
  assert(d.includes(`blocked_challenge: ${CF_DETAIL}`), "the default is the blocked wording (refusals, the crash path)");
}

// The waits are recorded either way; no challenge, no line.
{
  const guard = newExtractGuard(true);
  guard.challengeWaits.push("challenge_wait: SiteGround ipr settled on the listing in 3.0 s");
  const w = challengeWarnings(guard, true);
  assert(w.length === 1 && w[0].startsWith("challenge_wait:"), `a settled wait on a written run is its only line (got ${JSON.stringify(w)})`);
}

// scrape.ts: the written path says it wrote; the refusals and the crash do not.
{
  const scrape = readFileSync(join(__dirname, "../jobs/scrape.ts"), "utf8");
  const at = scrape.indexOf("scrapeWarnings.push(...checks.warnings)");
  const written = scrape.slice(at, at + 600);
  assert(/challengeWarnings\(runMode\.extract, true\)/.test(written), "the written run passes true");
  const others = scrape.match(/challengeWarnings\(runMode\.extract(, true)?\)/g) ?? [];
  assert(others.filter((x) => x.includes("true")).length === 1, "only the written run passes true");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("challengePassed: all assertions passed");
