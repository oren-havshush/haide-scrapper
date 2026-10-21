// Run: npx tsx scripts/lib/profileRun.test.ts
//
// Report fixes 3, item 13: the model only on --llm, dry run and real run
// alike, its values printed as the model's; --probe takes a user agent and
// retries once as desktop Chrome when refused; a failed logo fetch is retried
// once. The flag logic and the retries with stubs; the wiring by source.

import { readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

// --- the wiring (what HEAD lacks) -------------------------------------------------------------
const src = readFileSync(join(__dirname, "..", "company-profile.ts"), "utf8");
{
  assert(!/const useLlm = !flag\("no-llm"\)/.test(src), "the model is no longer on by default");
  assert(/const useLlm = llmRequested\(process\.argv\)/.test(src), "it runs only on --llm");
  assert(/MODEL \$\{field\} \(the model's, not the page's\)/.test(src), "a model value is printed as the model's");
  assert(/probeWithIdentityRetry\(/.test(src) && /arg\("probe-ua"\)/.test(src), "--probe takes a user agent and retries as Chrome");
  assert(/retryOnce\(\(\) => fetchImage\(candidate\.url, referer\)/.test(src), "a logo fetch is retried once");
}

(async () => {
  const { DESKTOP_CHROME_UA, isRefusedNav, llmRequested, probeWithIdentityRetry, retryOnce } = await import("./profileRun");

  // --- the flag ---------------------------------------------------------------------------------
  assert(!llmRequested(["--site", "x"]) && !llmRequested(["--site", "x", "--dry-run"]), "no flag: no model, dry run or not");
  assert(llmRequested(["--site", "x", "--llm"]) && llmRequested(["--dry-run", "--llm"]), "--llm: the model, on the dry run too");
  assert(!llmRequested(["--llm", "--no-llm"]) && !llmRequested(["--no-llm"]), "--no-llm still means no");

  // --- refusal ------------------------------------------------------------------------------------
  assert(isRefusedNav({ status: 403 }) && isRefusedNav({ status: 429 }), "a 403 or 429 is a refusal");
  assert(isRefusedNav({ status: 200, bodyText: "Request Rejected\nThe requested URL was rejected." }), "as-invest's 200 'Request Rejected'");
  assert(!isRefusedNav({ status: 404 }) && !isRefusedNav({ status: 200, bodyText: "ברוכים הבאים" }) && !isRefusedNav(null), "a 404 or a page is not");

  // --- the probe: a stub that refuses the first identity ------------------------------------------
  const seen: Array<string | undefined> = [];
  const stub = async (ua: string | undefined) => {
    seen.push(ua);
    return ua === DESKTOP_CHROME_UA ? { nav: { status: 200 }, about: "found" } : { nav: { status: 403 }, about: null };
  };
  const r = await probeWithIdentityRetry(stub, (x) => isRefusedNav(x.nav));
  assert(JSON.stringify(seen) === JSON.stringify([undefined, DESKTOP_CHROME_UA]), `the default, then Chrome (got ${JSON.stringify(seen)})`);
  assert(r.retried && r.result.about === "found" && r.userAgent === DESKTOP_CHROME_UA, "the Chrome result is kept");
  seen.length = 0;
  const given = await probeWithIdentityRetry(stub, (x) => isRefusedNav(x.nav), "MyAgent/1.0");
  assert(seen[0] === "MyAgent/1.0" && given.retried, "a given user agent is tried first");
  seen.length = 0;
  const ok = await probeWithIdentityRetry(async (ua) => { seen.push(ua); return { nav: { status: 200 } }; }, (x) => isRefusedNav(x.nav));
  assert(seen.length === 1 && !ok.retried, "not refused: one run");
  seen.length = 0;
  await probeWithIdentityRetry(async (ua) => { seen.push(ua); return { nav: { status: 403 } }; }, (x) => isRefusedNav(x.nav), DESKTOP_CHROME_UA);
  assert(seen.length === 1, "Chrome refused: not tried twice");

  // --- the logo retry ---------------------------------------------------------------------------------
  let calls = 0;
  const flaky = async () => {
    calls++;
    if (calls === 1) throw new TypeError("fetch failed");
    return "bytes";
  };
  const transient = (e: unknown) => e instanceof TypeError;
  assert((await retryOnce(flaky, transient)) === "bytes" && calls === 2, "a transient failure: tried once more");
  calls = 0;
  let threw = false;
  try {
    await retryOnce(async () => { calls++; throw new RangeError("rejected: too small"); }, transient);
  } catch {
    threw = true;
  }
  assert(threw && calls === 1, "a rejection is an answer: not retried");

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log("profileRun: the model only on --llm; the probe retries as Chrome when refused; a logo fetch once more");
})().catch((e) => {
  console.error(`FAIL: profileRun test threw — ${(e as Error).message}`);
  process.exit(1);
});
