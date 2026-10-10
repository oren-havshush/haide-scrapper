// Run: npx tsx worker/lib/challengeWait.test.ts
//
// SiteGround's automatic "ipc" check, and the two challenge labels (owner,
// 2026-10-10). Measured from the box on 2026-10-10 for gazit and tl-care: the
// listing answers 202 with sg-captcha: challenge, the page refreshes to
// /.well-known/sgcaptcha/?…&y=ipc:<ip>, its script answers with &sol=…, and the
// listing comes back 200 — a browser passes it by itself in two navigations.
// The worker now waits for that chain to settle on the listing URL, capped at
// 20 s, ipc only: ipr (IP reputation), SiteGround's interactive captcha and the
// cap running out stay blocked, as today. The wait is recorded on the run.
// Label 1: an empty result or a drop in a run that saw a challenge is blocked.
// Label 2: the crash path saves the challenge detail it already holds.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  IPC_WAIT_CAP_MS,
  challengeLabel,
  challengeWaitRecord,
  challengeWarnings,
  judgeChallengeChain,
  navRecordOf,
  sgVerdictOf,
  type NavRecord,
} from "./challengeWait";
import { newExtractGuard } from "./zeroMatch";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const LISTING = "https://www.gazit.co.il/%D7%A7%D7%A8%D7%99%D7%99%D7%A8%D7%94/";
const SG = { server: "nginx", "sg-captcha": "challenge" };
const nav = (url: string, status: number, headers: Record<string, string> = {}): NavRecord => navRecordOf(url, status, headers);

assert(IPC_WAIT_CAP_MS === 20_000, "the wait is capped at 20 s");

// gazit, 2026-10-10, step by step.
{
  const chain: NavRecord[] = [];
  chain.push(nav(LISTING, 202, SG));
  assert(judgeChallengeChain(chain, LISTING) === "waiting", "the 202 alone: waiting");
  chain.push(nav("https://www.gazit.co.il/.well-known/sgcaptcha/?r=%2F%D7%A7%2F&y=ipc:194.88.110.149:1791649409.145", 200, SG));
  assert(judgeChallengeChain(chain, LISTING) === "waiting", "the ipc page: waiting");
  chain.push(nav("https://www.gazit.co.il/.well-known/sgcaptcha/?r=%2F%D7%A7%2F&sol=MjE6MTc5", 202, SG));
  assert(judgeChallengeChain(chain, LISTING) === "waiting", "its answer: still waiting");
  chain.push(nav(LISTING, 200, { server: "nginx" }));
  assert(judgeChallengeChain(chain, LISTING) === "settled", "the listing back at 200 without the header: settled");
}
// ipr is waited for exactly like ipc (owner, 2026-10-10 19:25Z): gazit's chain
// as the box recorded it at 18:48Z settled by itself in 1.7 s.
{
  const IPR = "https://www.gazit.co.il/.well-known/sgcaptcha/?r=%2F%D7%A7%2F&y=ipr:194.88.110.149:1791543180.826";
  const chain: NavRecord[] = [nav(LISTING, 202, SG), nav(IPR, 200, SG)];
  assert(judgeChallengeChain(chain, LISTING) === "waiting", "an ipr chain is waited for (no stop at ipr)");
  assert(sgVerdictOf(chain) === "ipr", "and its verdict is read as ipr");
  chain.push(nav("https://www.gazit.co.il/.well-known/sgcaptcha/?r=%2F%D7%A7%2F&sol=MjE6&s=819:77714", 202, SG));
  chain.push(nav(LISTING, 200, { server: "nginx" }));
  assert(judgeChallengeChain(chain, LISTING) === "settled", "gazit's 18:48Z ipr chain is settled");
  assert(
    challengeWaitRecord("settled", 1672, sgVerdictOf(chain)) === "challenge_wait: SiteGround ipr settled on the listing in 1.7 s",
    `the record names the ipr verdict (got "${challengeWaitRecord("settled", 1672, sgVerdictOf(chain))}")`,
  );
  // An ipr chain that escalates to the interactive captcha: blocked.
  const esc = [nav(LISTING, 202, SG), nav(IPR, 200, SG), nav("https://www.gazit.co.il/.well-known/captcha/?y=ipr:194.88.110.149&r=%2F", 200, {})];
  assert(judgeChallengeChain(esc, LISTING) === "captcha", "an ipr chain that reaches /.well-known/captcha/ is captcha (blocked)");
  // An ipr chain that never returns to the listing stays waiting; at the cap it is blocked.
  assert(judgeChallengeChain([nav(LISTING, 202, SG), nav(IPR, 200, SG)], LISTING) === "waiting", "an ipr chain that does not return is still waiting");
  assert(
    challengeWaitRecord("timeout", 20_000, "ipr") === "challenge_wait: SiteGround ipr did not settle within 20 s — blocked",
    "and at the cap it is recorded as blocked, naming ipr",
  );
}
// ipc still settles, and its record still says ipc.
{
  const chain = [nav(LISTING, 202, SG), nav("https://www.gazit.co.il/.well-known/sgcaptcha/?y=ipc:1.2.3.4:1", 200, SG), nav(LISTING, 200, {})];
  assert(judgeChallengeChain(chain, LISTING) === "settled" && sgVerdictOf(chain) === "ipc", "an ipc chain still settles, read as ipc");
  assert(challengeWaitRecord("settled", 4200, "ipc") === "challenge_wait: SiteGround ipc settled on the listing in 4.2 s", "with an ipc record");
}
// SiteGround's interactive captcha: blocked.
{
  const chain = [nav(LISTING, 202, SG), nav("https://www.gazit.co.il/.well-known/captcha/?y=ipr:1.2.3.4&r=%2F", 200, {})];
  assert(judgeChallengeChain(chain, LISTING) === "captcha", "the interactive Robot Challenge page stops the wait");
}
// Not challenged, and a settled page that is not the listing.
assert(judgeChallengeChain([nav(LISTING, 200, { server: "nginx" })], LISTING) === "not_challenged", "no sg-captcha anywhere: nothing to wait for");
assert(judgeChallengeChain([], LISTING) === "not_challenged", "no navigation: nothing to wait for");
{
  const chain = [nav(LISTING, 202, SG), nav("https://www.gazit.co.il/.well-known/sgcaptcha/?y=ipc:1.2.3.4:1", 200, SG), nav("https://www.gazit.co.il/", 200, {})];
  assert(judgeChallengeChain(chain, LISTING) === "waiting", "a page other than the listing is not settled");
}
// A Cloudflare challenge is not SiteGround's ipc: never waited for.
assert(
  judgeChallengeChain([nav("https://www.one1.co.il/careers/", 403, { server: "cloudflare", "cf-mitigated": "challenge" })], "https://www.one1.co.il/careers/") === "not_challenged",
  "a Cloudflare challenge is not waited for",
);

// --- label 1: an empty result or a drop after a challenge is blocked -------------------
const SGD = "SiteGround challenge (sg-captcha: challenge)";
assert(challengeLabel("empty_results", SGD) === "blocked", "empty_results after a challenge is blocked (gazit, 2026-10-10)");
assert(challengeLabel("suspicious_drop", SGD) === "blocked", "a drop after a challenge is blocked (tl-care, 2026-10-10)");
assert(challengeLabel("field_fill_drop", SGD) === "blocked", "a fill drop after a challenge is blocked");
assert(challengeLabel("empty_results", null) === "empty_results", "no challenge: empty_results as before");
assert(challengeLabel("suspicious_drop", null) === "suspicious_drop", "no challenge: suspicious_drop as before");
assert(challengeLabel("timeout", SGD) === "timeout", "other categories are left as they are");

// --- label 2: the challenge detail is saved, and the wait is recorded -----------------
{
  const g = newExtractGuard(true);
  g.challenge = SGD;
  g.challengeWaits.push("challenge_wait: SiteGround ipc did not settle within 20 s");
  const w = challengeWarnings(g);
  assert(w.includes(`blocked_challenge: ${SGD}`), `the challenge detail is saved (${JSON.stringify(w)})`);
  assert(w.includes("challenge_wait: SiteGround ipc did not settle within 20 s"), "and the wait");
  const clean = newExtractGuard(true);
  assert(challengeWarnings(clean).length === 0, "no challenge, no wait: nothing");
  assert(challengeWarnings(null).length === 0, "no guard: nothing");
}

// --- the wiring ---------------------------------------------------------------------
{
  const scrape = readFileSync(join(__dirname, "..", "jobs", "scrape.ts"), "utf8");
  const goto = scrape.slice(scrape.indexOf("async function gotoForgiving("), scrape.indexOf("function sleepMs("));
  assert(/settleSiteGroundIpc\(/.test(goto) && /opts\.listingRetry/.test(goto), "gotoForgiving settles SiteGround's ipc chain on a listing navigation");
  assert((scrape.match(/listingRetry: true, guard: /g) ?? []).length === 2, "both listing navigations pass the run's guard");
  const settle = scrape.slice(scrape.indexOf("async function settleSiteGroundIpc("), scrape.indexOf("async function settleSiteGroundIpc(") + 2500);
  assert(/IPC_WAIT_CAP_MS/.test(settle) && /challengeWaits\.push\(/.test(settle), "the wait is capped and recorded on the guard");
  assert(/challengeWaitRecord\(outcome, ms, sgVerdictOf\(navs\)\)/.test(settle), "the record names the verdict the IP got");
  assert(/guard\.challenge = null/.test(settle), "a settled chain clears the run's challenge (the page is the real listing)");
  const empty = scrape.slice(scrape.indexOf("// Handle empty results (AC #5)"), scrape.indexOf("// Handle empty results (AC #5)") + 1500);
  assert(/challengeLabel\("empty_results", runMode\.extract\?\.challenge \?\? null\)/.test(empty), "the empty-results path reads the run's challenge");
  assert(/challengeLabel\("suspicious_drop", runMode\.extract\?\.challenge \?\? null\)/.test(scrape), "the drop refusal reads it");
  assert(/challengeLabel\("field_fill_drop", runMode\.extract\?\.challenge \?\? null\)/.test(scrape), "the fill refusal reads it");
  const crash = scrape.slice(scrape.indexOf('console.error("[scrape] Scrape failed:"'), scrape.indexOf('console.error("[scrape] Scrape failed:"') + 600);
  assert(/warnings: challengeWarnings\(runMode\.extract\)/.test(crash), "the crash path saves the challenge detail");
  assert(/challengeWarnings\(runMode\.extract\)/.test(scrape.slice(scrape.indexOf("scrapeWarnings.push(...checks.warnings)") - 2000, scrape.indexOf("scrapeWarnings.push(...checks.warnings)") + 2000)), "a written run records its wait too");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("challengeWait: all assertions passed");
