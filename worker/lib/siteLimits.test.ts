// Run: npx tsx worker/lib/siteLimits.test.ts
//
// Per-site limits (big-lane design, item 3): `limits` is a top-level config key
// stored as _meta.limits. Absent limits give exactly today's constants; each
// ceiling is refused one above; a budget above 15 minutes needs lane "big";
// pagination.maxPages above 100 needs limits.maxPages to allow it; the item cap
// warning names the site's own cap; and the scrape and the sweep driver read
// the limits at the lines that used the constants.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { updateSiteConfigSchema } from "../../src/lib/validators";
import { mergeConfigPatch } from "../../src/lib/configPatch";
import { FLEET_LIMITS, LIMIT_CEILINGS, pageCap, readSiteLimits, resolveLimits, sweepWaitMinutes } from "./siteLimits";
import { capItems, itemCapWarnings, MAX_EXTRACTED_ITEMS } from "./itemCap";
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

check("absent limits are today's constants", () => {
  assert(FLEET_LIMITS.timeoutMs === 900_000, `timeout 15 min (got ${FLEET_LIMITS.timeoutMs})`);
  assert(FLEET_LIMITS.nearTimeoutMs === 840_000, `near_timeout from 14 min (got ${FLEET_LIMITS.nearTimeoutMs})`);
  assert(FLEET_LIMITS.maxItems === 2000 && MAX_EXTRACTED_ITEMS === 2000, "2,000 items");
  assert(FLEET_LIMITS.maxPages === 100, "100 pages");
  assert(sweepWaitMinutes({}, 18) === 18, "the sweep waits its own 18");
  assert(pageCap(20, {}) === 20 && pageCap(150, {}) === 100, "the page cap stays 100");
  const r = resolveLimits({ timeBudgetMinutes: 180, maxItems: 5000, maxPages: 300 });
  assert(r.timeoutMs === 180 * 60_000 && r.nearTimeoutMs === 179 * 60_000 && r.maxItems === 5000 && r.maxPages === 300, "a site's own limits");
  assert(sweepWaitMinutes({ timeBudgetMinutes: 180 }, 18) === 183, "the sweep waits budget + 3");
  assert(pageCap(253, { maxPages: 300 }) === 253 && pageCap(300, { maxPages: 260 }) === 260, "the page cap is the site's");
});

check("readSiteLimits", () => {
  const fm = (limits: unknown) => ({ _meta: { limits } });
  const got = readSiteLimits(fm({ timeBudgetMinutes: 180, maxItems: 5000, maxPages: 300 }));
  assert(got.timeBudgetMinutes === 180 && got.maxItems === 5000 && got.maxPages === 300, "reads all three at the ceiling");
  const bad = readSiteLimits(fm({ timeBudgetMinutes: 181, maxItems: 5001, maxPages: 301 }));
  assert(Object.keys(bad).length === 0, "ignores each one above its ceiling");
  const odd = readSiteLimits(fm({ timeBudgetMinutes: 0, maxItems: 1.5, maxPages: "10" }));
  assert(Object.keys(odd).length === 0, "ignores zero, fractions and strings");
  assert(Object.keys(readSiteLimits({ _meta: {} })).length === 0 && Object.keys(readSiteLimits(null)).length === 0, "absent is {}");
});

const base = { fieldMappings: {}, pageFlow: [], formCapture: null };
const ok = (body: Record<string, unknown>) => updateSiteConfigSchema.safeParse({ ...base, ...body }).success;

check("the schema", () => {
  assert(ok({ lane: "big", limits: { ...LIMIT_CEILINGS } }), "accepts every ceiling on a big-lane site");
  assert(!ok({ lane: "big", limits: { timeBudgetMinutes: 181 } }), "refuses 181 minutes");
  assert(!ok({ limits: { maxItems: 5001 } }), "refuses 5,001 items");
  assert(!ok({ limits: { maxPages: 301 } }), "refuses 301 pages");
  assert(!ok({ limits: { maxItems: 0 } }), "refuses 0");
  assert(!ok({ limits: { maxItemz: 10 } }), "refuses an unknown key");
  assert(ok({ limits: { timeBudgetMinutes: 15, maxItems: 3000 } }), "a nightly site may set 15 minutes and more items");
  assert(!ok({ limits: { timeBudgetMinutes: 16 } }), "a nightly site may not take more than 15 minutes");
  assert(ok({ lane: "big", limits: { timeBudgetMinutes: 16 } }), "a big-lane site may");
  const url = (maxPages: number) => ({ type: "url", param: "pg", maxPages });
  assert(ok({ pagination: url(100) }), "100 pages without limits");
  assert(!ok({ pagination: url(253) }), "253 pages refused without limits");
  assert(ok({ pagination: url(253), limits: { maxPages: 300 } }), "253 pages with limits.maxPages 300");
  assert(!ok({ pagination: url(253), limits: { maxPages: 200 } }), "253 pages refused with limits.maxPages 200");
  assert(!ok({ pagination: url(301), limits: { maxPages: 300 } }), "301 pages refused at any limit");
});

check("a patch keeps, sets and clears limits", () => {
  const stored = { fieldMappings: { title: { selector: "h2" }, _meta: { lane: "big", limits: { timeBudgetMinutes: 180 } } }, pageFlow: [] };
  const kept = mergeConfigPatch(stored, { setupScript: "x()" }) as { limits?: { timeBudgetMinutes?: number } };
  assert(kept.limits?.timeBudgetMinutes === 180, "kept when unnamed");
  const cleared = mergeConfigPatch(stored, { limits: null }) as { limits?: unknown };
  assert(cleared.limits === undefined, "cleared on null");
});

check("item_cap_reached names the site's own cap", () => {
  const cards = Array.from({ length: 6000 }, (_, i) => i);
  const big = newExtractGuard(true, 5000);
  const kept = capItems(cards, big.maxItems, big);
  assert(kept.length === 5000, `keeps the site's 5,000 (got ${kept.length})`);
  const w = itemCapWarnings(big);
  assert(w.length === 1 && w[0] === "item_cap_reached: 5,000 of 6,000 cards", `the warning (got ${JSON.stringify(w)})`);
  const fleet = newExtractGuard(true);
  assert(fleet.maxItems === 2000, "a guard without limits caps at 2,000");
  capItems(cards.slice(0, 2524), fleet.maxItems, fleet);
  assert(itemCapWarnings(fleet)[0] === "item_cap_reached: 2,000 of 2,524 cards", "and its warning is today's");
});

const strip = (s: string) => s.replace(/^\s*\/\/[^\n]*$/gm, "");
const scrape = strip(readFileSync(join(__dirname, "..", "jobs", "scrape.ts"), "utf8"));
check("scrape.ts reads the limits", () => {
  assert(!/SCRAPE_TIMEOUT_MS/.test(scrape), "the 15-minute constant is gone");
  assert(!/NEAR_TIMEOUT_MS/.test(scrape), "the 14-minute constant is gone");
  assert(/const limits = resolveLimits\(readSiteLimits\(site\.fieldMappings\)\);[\s\S]{0,400}?\n\s+limits,\n/.test(scrape), "handleScrapeJob resolves the site's limits into runMode");
  assert(/extract:\s*newExtractGuard\(scheduled, limits\.maxItems, limits\.setupScriptMs\)/.test(scrape), "the guard carries the site's item cap and script limit");
  assert(/capItems\(deduped, guard\?\.maxItems \?\? MAX_EXTRACTED_ITEMS, guard\)/.test(scrape), "the dedupe caps at the guard's max");
  assert(/listingBudgetExhausted\(scrapeStartedAt, Date\.now\(\), runMode\.deadlineMs\)/.test(scrape), "the listing budget is the run's deadline");
  assert(/deadlineMs: limits\.timeoutMs,/.test(scrape), "which starts as the site's budget");
  const timer = scrape.slice(scrape.indexOf("function createTimeoutPromise"));
  assert(/runDeadline\(startedMs, runMode\.limits\.timeoutMs, runMode\.stopAt\)/.test(timer) && /\}, deadline\.ms\);/.test(timer), "the deadline timer is the site's budget (or the big lane's stop, if sooner)");
  assert(/elapsedMs >= nearTimeoutMs/.test(scrape), "near_timeout reads the site's");
  assert(/more than the \$\{runMode\.extract\.maxItems\}/.test(scrape), "the item_cap refusal names the site's cap");
  const pag = scrape.slice(scrape.indexOf("function getPaginationConfig"), scrape.indexOf("function buildPaginatedUrl"));
  assert(/pageCap\(p\["maxPages"\] as number, readSiteLimits\(fieldMappingsRaw\)\)/.test(pag), "the page cap is the site's");
});

const service = strip(readFileSync(join(__dirname, "..", "..", "src", "services", "siteService.ts"), "utf8"));
assert(/limits:\s*config\.limits \?\? null/.test(service), "saveSiteConfig writes _meta.limits");

const nightly = strip(readFileSync(join(__dirname, "..", "sweep", "nightly.ts"), "utf8"));
assert(
  /sweepWaitMinutes\(readSiteLimits\(site\.fieldMappings\), sweepConfig\.perSiteTimeoutMinutes\)/.test(nightly),
  "the sweep waits the site's budget + 3",
);
assert(!/timeoutMs:\s*sweepConfig\.perSiteTimeoutMinutes \* 60_000/.test(nightly), "and not the fleet's 18 for every site");

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("siteLimits: all passed");
