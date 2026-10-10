// Run: npx tsx worker/lib/navRetry.test.ts
//
// The listing-navigation retry (owner, 2026-10-05). b-e failed on 3 of the last
// 6 nights and one1 once, each time the FIRST page.goto to the listing hitting
// its 30-second limit about 35 s into the run; the same sites load in 3 s by day
// and scrape in 35-115 s on a good night. Six such timeouts in 8 days, all in
// the sweep's first half hour. So: on a listing page.goto timeout, wait about
// 15 s and try once more with a 60 s limit. Two timeouts fail as today. Any other
// error is not retried. Detail pages and pagination are unchanged.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LISTING_RETRY_TIMEOUT_MS,
  LISTING_RETRY_WAIT_MS,
  isNavigationTimeout,
  navigateWithRetry,
} from "./navRetry";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

/** A Playwright-shaped timeout: name TimeoutError, today's message. */
function timeout(ms: number): Error {
  const e = new Error(`page.goto: Timeout ${ms}ms exceeded.\nCall log:\n  - navigating to "https://b-e.org.il/", waiting until "domcontentloaded"`);
  e.name = "TimeoutError";
  return e;
}

function harness(outcomes: Array<"ok" | "timeout" | "dns">) {
  const calls: number[] = [];
  const slept: number[] = [];
  const logs: string[] = [];
  const go = async (t: number) => {
    calls.push(t);
    const o = outcomes[calls.length - 1];
    if (o === "timeout") throw timeout(t);
    if (o === "dns") throw new Error("page.goto: net::ERR_NAME_NOT_RESOLVED at https://x.test/");
    return `response@${t}`;
  };
  const opts = { firstTimeoutMs: 30_000, sleep: async (ms: number) => void slept.push(ms), log: (m: string) => void logs.push(m) };
  return { calls, slept, logs, run: () => navigateWithRetry(go, opts) };
}

(async () => {
  assert(LISTING_RETRY_WAIT_MS === 15_000 && LISTING_RETRY_TIMEOUT_MS === 60_000, "wait about 15 s, then a 60 s limit");

  // --- what counts as a navigation timeout --------------------------------------
  assert(isNavigationTimeout(timeout(30_000)), "Playwright's TimeoutError is a navigation timeout");
  const plain = new Error("page.goto: Timeout 30000ms exceeded.");
  assert(isNavigationTimeout(plain), "so is its message, whatever the error's name");
  assert(!isNavigationTimeout(new Error("page.goto: net::ERR_CONNECTION_RESET")), "a reset is not");
  assert(!isNavigationTimeout(new Error("Scrape execution exceeded 15-minute timeout")), "nor the run's own 15-minute deadline");
  assert(!isNavigationTimeout("Timeout 30000ms exceeded"), "a non-Error is not");

  // --- the first load works: one attempt, no wait ---------------------------------
  {
    const h = harness(["ok"]);
    const r = await h.run();
    assert(r === "response@30000", "the first response is returned");
    assert(JSON.stringify(h.calls) === "[30000]" && h.slept.length === 0, `one attempt at 30 s, no wait (${JSON.stringify(h)})`);
  }

  // --- b-e: the first load times out, the second works ------------------------------
  {
    const h = harness(["timeout", "ok"]);
    const r = await h.run().catch((e: Error) => `threw: ${e.message.split("\n")[0]}`);
    assert(r === "response@60000", `the retry's response is returned (${r})`);
    assert(JSON.stringify(h.calls) === "[30000,60000]", `30 s, then 60 s (${JSON.stringify(h.calls)})`);
    assert(JSON.stringify(h.slept) === "[15000]", `with a 15 s wait between (${JSON.stringify(h.slept)})`);
    assert(h.logs.some((l) => l.includes("retrying once")), "and the retry is logged");
  }

  // --- two timeouts: fails as today ------------------------------------------------
  {
    const h = harness(["timeout", "timeout"]);
    let err: unknown = null;
    try {
      await h.run();
    } catch (e) {
      err = e;
    }
    assert(err instanceof Error && isNavigationTimeout(err), "two timeouts still throw a navigation timeout (category timeout, as today)");
    assert(err instanceof Error && err.message.startsWith("page.goto: Timeout"), `with Playwright's message (${(err as Error)?.message})`);
    assert(h.calls.length === 2, `and nothing tries a third time (${h.calls.length})`);
  }

  // --- any other error: no retry -----------------------------------------------------
  {
    const h = harness(["dns", "ok"]);
    let err: unknown = null;
    try {
      await h.run();
    } catch (e) {
      err = e;
    }
    assert(err instanceof Error && err.message.includes("ERR_NAME_NOT_RESOLVED"), "a non-timeout error is thrown at once");
    assert(h.calls.length === 1 && h.slept.length === 0, "without a wait or a second attempt");
  }

  // --- the wiring: the listing loads retry; detail pages and pagination do not ---------
  {
    const src = readFileSync(join(__dirname, "../jobs/scrape.ts"), "utf8");
    // Since 2026-10-10 the two listing loads also pass the run's guard, for the
    // SiteGround ipc wait (worker/lib/challengeWait.ts).
    const listingCalls = src.match(/gotoForgiving\([^;]*\{ listingRetry: true, guard: [^}]*\}\)/g) ?? [];
    assert(listingCalls.length === 2, `the two listing loads opt in (got ${listingCalls.length})`);
    assert(/gotoForgiving\(page, targetUrl, NAVIGATION_TIMEOUT_MS, \{ listingRetry: true, guard: runMode\.extract \}\)/.test(src), "the run's first navigation (executeScrape)");
    assert(/gotoForgiving\(page, listingUrlOverride \?\? listingStep\.url, NAVIGATION_TIMEOUT_MS, \{ listingRetry: true, guard: guard \}\)/.test(src), "and the page-flow listing step");
    assert(/gotoForgiving\(page, detailUrl, DETAIL_PAGE_TIMEOUT_MS\);/.test(src), "a detail page is unchanged");
    assert(/gotoForgiving\(page, target, NAVIGATION_TIMEOUT_MS\);/.test(src), "pagination is unchanged");
    const fn = src.slice(src.indexOf("async function gotoForgiving("), src.indexOf("function sleepMs("));
    assert(/navigateWithRetry\(/.test(fn), "gotoForgiving uses navigateWithRetry when asked");
  }

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.info("navRetry: a listing page.goto timeout is retried once (15 s wait, 60 s limit); two fail as today");
})();
