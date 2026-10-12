// Run: npx tsx worker/lib/setupScriptLimits.test.ts
//
// The setup script's two limits (owner, 2026-10-12, LRN-SETUP-23).
//   - Size: validators.ts capped a script at 8,000 characters since the hook
//     was a 5-line SPA fix (2026-05-11). Matrix, ORS and Pelephone sit at
//     7,981-7,996 and a per-job form needs ~9,040. The cap is now 16,000; what
//     it protects is reviewability, not storage (all 456 sites' configs are
//     1.5 MB together).
//   - Time: setupScriptRun.ts set page.setDefaultTimeout(90_000), which bounds
//     Playwright's own waits and NOT page.evaluate, so a script could run until
//     the 15-minute per-site cap. The evaluate is now raced against 90 s; when
//     the limit fires the run records setup_script_timeout naming the page and
//     goes on as if the script had returned nothing.
//
// Driven against a real Chromium page, like setupScriptRun.test.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { runSetupScript, SETUP_SCRIPT_TIMEOUT_MS } from "./setupScriptRun";
import { newExtractGuard, zeroMatchRefusal, onExplicitZeroMatch } from "./zeroMatch";
import { challengeWarnings } from "./challengeWait";
import { updateSiteConfigSchema } from "../../src/lib/validators";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const w = console.warn, i = console.info;
  console.warn = () => {};
  console.info = () => {};
  try {
    return await fn();
  } finally {
    console.warn = w;
    console.info = i;
  }
};

// --- the size cap ---
{
  const config = (setupScript: string) => ({ fieldMappings: {}, pageFlow: [], formCapture: null, setupScript });
  const ok = (n: number) => updateSiteConfigSchema.safeParse(config("x".repeat(n))).success;
  assert(ok(9_040), "a 9,040-character script (Matrix's per-job form) is accepted");
  assert(ok(16_000), "16,000 characters are accepted");
  assert(!ok(16_001), "16,001 characters are refused");
  const src = readFileSync(join(__dirname, "../../src/lib/validators.ts"), "utf8");
  assert(/\.max\(16_000\)/.test(src), "validators.ts caps setupScript at 16_000");
  assert(/reviewab/i.test(src.slice(src.indexOf("setupScript: z"), src.indexOf("setupScript: z") + 1200)) ||
    /reviewab/i.test(src.slice(src.indexOf("setupScript: z") - 1200, src.indexOf("setupScript: z"))),
    "the comment beside the cap gives the reason: reviewability");
}

// --- the time limit ---
(async () => {
  assert(SETUP_SCRIPT_TIMEOUT_MS === 90_000, "the limit is 90 s");
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent("<!doctype html><html><body><div id=a>x</div></body></html>");

    // A script that never finishes, against a 600 ms limit.
    {
      const guard = newExtractGuard(true);
      const t0 = Date.now();
      const outcome = await quiet(() =>
        runSetupScript(page, "await new Promise(() => {});", { guard, timeoutMs: 600 }),
      );
      const ms = Date.now() - t0;
      assert(outcome === "timeout", `a script past the limit is cut off (got ${outcome})`);
      assert(ms < 5_000, `and the run goes on at once (took ${ms} ms)`);
      assert(guard.scriptTimeouts.length === 1, `one setup_script_timeout recorded (got ${guard.scriptTimeouts.length})`);
      assert(/^setup_script_timeout: /.test(guard.scriptTimeouts[0] ?? ""), `it is a setup_script_timeout warning (got ${guard.scriptTimeouts[0]})`);
      assert((guard.scriptTimeouts[0] ?? "").includes("about:blank"), `naming the page (got ${guard.scriptTimeouts[0]})`);
      const still = await page.evaluate(() => document.getElementById("a")?.textContent);
      assert(still === "x", "the page is still usable for extraction");
    }
    // A script that finishes in time: nothing recorded.
    {
      const guard = newExtractGuard(true);
      const outcome = await quiet(() => runSetupScript(page, "document.title = 'ok';", { guard, timeoutMs: 5_000 }));
      assert(outcome === "ran", `a quick script ran (got ${outcome})`);
      assert(guard.scriptTimeouts.length === 0, "and records nothing");
    }
  } finally {
    await browser?.close();
  }

  // The warning reaches the run on every path.
  {
    const guard = newExtractGuard(true);
    guard.scriptTimeouts.push("setup_script_timeout: x");
    assert(challengeWarnings(guard, true).includes("setup_script_timeout: x"), "a written run carries it");
    assert(challengeWarnings(guard).includes("setup_script_timeout: x"), "an empty, refused or crashed run carries it");
    onExplicitZeroMatch(guard, ".x", "x");
    assert((zeroMatchRefusal(guard, 0)?.warnings ?? []).includes("setup_script_timeout: x"), "a zero-match refusal carries it");
  }

  // scrape.ts passes the run's guard at every call.
  {
    const src = readFileSync(join(__dirname, "../jobs/scrape.ts"), "utf8");
    const calls = src.match(/runSetupScript\(page, setupScript[^)]*\)/g) ?? [];
    assert(calls.length === 5, `five call sites (got ${calls.length})`);
    assert(calls.every((c) => /\{ guard/.test(c)), `each passes the run's guard (got ${JSON.stringify(calls)})`);
  }

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log("setupScriptLimits: 16,000 characters, and a 90 s limit that records and moves on");
})();
