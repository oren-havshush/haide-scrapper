// Run: npx tsx worker/lib/requestDelay.test.ts
//
// browserOverrides.requestDelayMs: the worker waits that long before every page
// load it makes for a site — the listing, each pagination click, each detail
// page — and spaces the setup script's own fetches the same way. ashtrom
// throttles the server's IP after a burst of automated loads (2026-09-26/28:
// transitions of 17.8s, then none within 40s, then detail pages timing out).
//
// Checked on a FAKE page that records when each load happens, so the gap is
// measured, not inferred from the code.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  REQUEST_DELAY_MAX_MS,
  beforeClickLoad,
  createPacer,
  paceFetchIn,
  pacePage,
  pacerFor,
  readRequestDelayMs,
} from "./requestDelay";
import { updateSiteConfigSchema } from "../../src/lib/validators";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}
async function check(name: string, body: () => Promise<void> | void) {
  try {
    await body();
  } catch (e) {
    console.error(`FAIL: ${name} threw — ${(e as Error).message}`);
    failures++;
  }
}

const DELAY = 60; // ms — real sleeps, kept short
const SLACK = 5; // timer granularity

/** A page that records the moment each load actually starts. */
function fakePage() {
  const loads: number[] = [];
  return {
    loads,
    async goto(url: string) {
      void url;
      loads.push(Date.now());
      return null;
    },
    /** What a paginator does: wait for the pacer, then click (= a load). */
    async clickNext(this: object) {
      await beforeClickLoad(this, "pagination");
      loads.push(Date.now());
    },
  };
}
const gaps = (t: number[]) => t.slice(1).map((v, i) => v - t[i]!);

(async () => {
  await check("the config value", () => {
    const BASE = { fieldMappings: {}, pageFlow: [] as unknown[], formCapture: null };
    const ok = (bo: unknown) => updateSiteConfigSchema.safeParse({ ...BASE, browserOverrides: bo }).success;
    assert(ok({ requestDelayMs: 3000 }), "3000 is accepted");
    assert(ok({ requestDelayMs: 0 }), "0 is accepted (explicitly off)");
    assert(ok({ requestDelayMs: 15000 }), "15000 is the ceiling, and accepted");
    assert(!ok({ requestDelayMs: 15001 }), "above 15000 is refused");
    assert(!ok({ requestDelayMs: -1 }), "negative is refused");
    assert(!ok({ requestDelayMs: 1500.5 }), "a fraction is refused");
    assert(!ok({ requestDelayMs: "3000" }), "a string is refused");
    assert(ok({}), "absent is the default");
    assert(REQUEST_DELAY_MAX_MS === 15000, "the worker's ceiling is the validator's");

    assert(readRequestDelayMs(3000) === 3000, "the worker reads 3000");
    assert(readRequestDelayMs(0) === null, "0 means no pacing");
    assert(readRequestDelayMs(undefined) === null, "absent means no pacing");
    assert(readRequestDelayMs(99_999) === null, "an out-of-range stored value is ignored, not clamped into a guess");
    assert(readRequestDelayMs("3000") === null, "a string is ignored");
  });

  await check("every page load waits the delay", async () => {
    const page = pacePage(fakePage(), createPacer(DELAY));
    const t0 = Date.now();
    await page.goto("https://site.test/career"); // the listing
    await page.clickNext(); // a pagination click
    await page.goto("https://site.test/career/1"); // a detail page
    await page.goto("https://site.test/career/2"); // another
    assert(page.loads.length === 4, `four loads recorded (${page.loads.length})`);
    assert(page.loads[0]! - t0 >= DELAY - SLACK, `the FIRST load waits too (${page.loads[0]! - t0}ms)`);
    for (const [i, g] of gaps(page.loads).entries()) {
      assert(g >= DELAY - SLACK, `gap ${i + 1} is at least the delay (${g}ms >= ${DELAY})`);
    }
    const p = pacerFor(page);
    assert(!!p && p.loads.map((l) => l.kind).join(",") === "navigation,pagination,navigation,navigation",
      `the pacer saw each load by kind (${p?.loads.map((l) => l.kind).join(",")})`);
  });

  await check("no delay configured: nothing waits", async () => {
    const page = fakePage();
    const t0 = Date.now();
    await page.goto("a");
    await page.clickNext.call(page);
    await page.goto("b");
    assert(page.loads[2]! - t0 < DELAY, `an unpaced page loads at once (${page.loads[2]! - t0}ms)`);
    assert(pacerFor(page) === undefined, "and has no pacer");
  });

  await check("the setup script's own fetches are spaced", async () => {
    const calls: number[] = [];
    const win = {
      fetch: async (url: string) => {
        void url;
        calls.push(Date.now());
        return "ok";
      },
    };
    const original = win.fetch;
    const restore = paceFetchIn(win, DELAY);
    // A setup script that fires three fetches at once — the burst that trips a throttle.
    await Promise.all([win.fetch("/a"), win.fetch("/b"), win.fetch("/c")]);
    assert(calls.length === 3, `three fetches went out (${calls.length})`);
    for (const [i, g] of gaps(calls).entries()) {
      assert(g >= DELAY - SLACK, `setup fetch gap ${i + 1} is at least the delay (${g}ms)`);
    }
    restore();
    assert(win.fetch === original, "restored afterwards, so the site's own later fetches are not slowed");
  });

  await check("scrape.ts paces every page it makes", () => {
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const src = strip(readFileSync(join(__dirname, "..", "jobs", "scrape.ts"), "utf8"));
    const setup = strip(readFileSync(join(__dirname, "setupScriptRun.ts"), "utf8"));
    const creates = src.split("await createPage(").length - 1;
    const paced = src.split("pacePage(page, createPacer(").length - 1;
    assert(creates === 2, `two pages are created — the run and the rehearsal (${creates})`);
    assert(paced === 2, `and both are paced when a delay is set (${paced})`);
    assert(/await beforeClickLoad\(page, "pagination"\);\s*await btn\.click\(/.test(src), "the pagination click waits first");
    assert(/await beforeClickLoad\(page, "load-more"\);\s*await btn\.click\(/.test(src), "and so does the load-more click");
    assert(/paceFetchIn/.test(setup) && /pacerFor\(page\)/.test(setup), "the setup-script phase spaces its fetches");
    assert(/requestDelayMs/.test(src), "the override is read from browserOverrides");
  });

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.info("requestDelay: every page load for a paced site waits the configured delay");
})();
