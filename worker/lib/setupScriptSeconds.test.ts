// Run: npx tsx worker/lib/setupScriptSeconds.test.ts
//
// The setup script's per-site limit (owner, 2026-10-13, horizontech). The 90-s
// limit (e3e500f) cut horizontech's script, which reads 265 detail pages at
// about 2 a second, after ~233 of them; 32 rows were written with no
// description. `limits.setupScriptSeconds` gives a site its own limit: default
// 90, ceiling 300, and a value over 90 must fit the site's time budget. It is
// read by the same path that applies the 90 s today: runSetupScript's limit,
// through the run's extract guard, which all five call sites already pass.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { updateSiteConfigSchema } from "../../src/lib/validators";
import { FLEET_LIMITS, LIMIT_CEILINGS, readSiteLimits, resolveLimits } from "./siteLimits";
import { runSetupScript, SETUP_SCRIPT_TIMEOUT_MS } from "./setupScriptRun";
import { newExtractGuard } from "./zeroMatch";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}
function check(name: string, body: () => void) {
  try {
    body();
  } catch (err) {
    console.error(`FAIL: ${name} threw: ${(err as Error).message}`);
    failures++;
  }
}

const meta = (limits: unknown) => ({ _meta: { limits } });
const config = (limits: Record<string, number>, lane?: "big") => ({
  fieldMappings: {},
  pageFlow: [],
  formCapture: null,
  limits,
  ...(lane ? { lane } : {}),
});
const ok = (limits: Record<string, number>, lane?: "big") => updateSiteConfigSchema.safeParse(config(limits, lane)).success;

check("the default is today's 90 s", () => {
  assert(SETUP_SCRIPT_TIMEOUT_MS === 90_000, "the fleet limit stays 90 s");
  assert((FLEET_LIMITS as Record<string, unknown>).setupScriptMs === 90_000, `FLEET_LIMITS.setupScriptMs is 90,000 (got ${(FLEET_LIMITS as Record<string, unknown>).setupScriptMs})`);
  assert(newExtractGuard(true).scriptLimitMs === 90_000, `a guard without limits carries 90,000 (got ${newExtractGuard(true).scriptLimitMs})`);
});

check("the ceiling is 300", () => {
  assert((LIMIT_CEILINGS as Record<string, number>).setupScriptSeconds === 300, `LIMIT_CEILINGS.setupScriptSeconds is 300 (got ${(LIMIT_CEILINGS as Record<string, number>).setupScriptSeconds})`);
});

check("the stored value is read", () => {
  assert((readSiteLimits(meta({ setupScriptSeconds: 180 })) as Record<string, number>).setupScriptSeconds === 180, "180 is read");
  assert((readSiteLimits(meta({ setupScriptSeconds: 301 })) as Record<string, number>).setupScriptSeconds === undefined, "301 is ignored, as absent");
  assert((readSiteLimits(meta({ setupScriptSeconds: 0 })) as Record<string, number>).setupScriptSeconds === undefined, "0 is ignored");
  const r = resolveLimits(readSiteLimits(meta({ setupScriptSeconds: 180 }))) as Record<string, unknown>;
  assert(r.setupScriptMs === 180_000, `180 resolves to 180,000 ms (got ${r.setupScriptMs})`);
  const g = newExtractGuard(true, 2000, 180_000);
  assert(g.scriptLimitMs === 180_000, `the guard carries the site's limit (got ${g.scriptLimitMs})`);
});

check("the schema: up to 300, and over 90 only inside the budget", () => {
  assert(ok({ setupScriptSeconds: 90 }), "90 is accepted");
  assert(ok({ setupScriptSeconds: 180 }), "180 is accepted on a nightly site (15-minute budget)");
  assert(ok({ setupScriptSeconds: 300 }), "300 is accepted on a nightly site");
  assert(!ok({ setupScriptSeconds: 301 }), "301 is refused");
  assert(!ok({ setupScriptSeconds: 0 }), "0 is refused");
  // The script may run twice on the listing (once more after load-more), and
  // the extraction needs the rest: over 90, the limit is at most a third of
  // the budget.
  assert(!ok({ setupScriptSeconds: 120, timeBudgetMinutes: 5 }), "120 s on a 5-minute budget is refused (more than a third)");
  assert(ok({ setupScriptSeconds: 100, timeBudgetMinutes: 5 }), "100 s on a 5-minute budget is accepted (a third)");
  assert(ok({ setupScriptSeconds: 90, timeBudgetMinutes: 1 }), "90 s is today's limit and is never refused");
  const r = updateSiteConfigSchema.safeParse(config({ setupScriptSeconds: 120, timeBudgetMinutes: 5 }));
  const msg = r.success ? "" : r.error.issues.map((i) => i.message).join("; ");
  assert(/setupScriptSeconds/.test(msg) && /budget/.test(msg), `the refusal names the key and the budget (got "${msg}")`);
});

check("the scrape reads it where it builds the run's guard", () => {
  const src = readFileSync(join(__dirname, "../jobs/scrape.ts"), "utf8");
  assert(/newExtractGuard\(scheduled, limits\.maxItems, limits\.setupScriptMs\)/.test(src), "handleScrapeJob passes limits.setupScriptMs to the guard");
  const run = readFileSync(join(__dirname, "setupScriptRun.ts"), "utf8");
  assert(/opts\.timeoutMs \?\? opts\.guard\?\.scriptLimitMs \?\? SETUP_SCRIPT_TIMEOUT_MS/.test(run), "runSetupScript takes its limit from the guard");
});

// The limit reaches the race: a guard with a 600 ms limit cuts the script at 600 ms.
(async () => {
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent("<!doctype html><html><body></body></html>");
    const w = console.warn;
    console.warn = () => {};
    const guard = newExtractGuard(true, 2000, 600);
    const t0 = Date.now();
    const outcome = await runSetupScript(page, "await new Promise(() => {});", { guard }).finally(() => {
      console.warn = w;
    });
    const ms = Date.now() - t0;
    assert(outcome === "timeout", `the guard's 600 ms limit cuts the script (got ${outcome})`);
    assert(ms < 5_000, `at once (took ${ms} ms)`);
    // A quick script under a long limit still runs to the end.
    const g2 = newExtractGuard(true, 2000, 180_000);
    const done = await runSetupScript(page, "document.body.setAttribute('data-x', '1');", { guard: g2 });
    assert(done === "ran" && g2.scriptTimeouts.length === 0, `a quick script under 180 s runs and records nothing (got ${done})`);
  } finally {
    await browser?.close();
  }
  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log("setupScriptSeconds: all assertions passed");
})();
