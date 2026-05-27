/**
 * Per-site dry-run that runs setupScript (if any), waits, and checks
 * itemSelector + each field selector against the live page.
 * Usage: npx tsx .dryrun3.ts <SITE_ID>
 */
import { chromium } from "playwright";
import * as fs from "fs";

const SITE_ID = process.argv[2];
if (!SITE_ID) { console.error("usage: dryrun3 <site_id>"); process.exit(2); }

const CFG = `/tmp/skip-audit/${SITE_ID}.config.json`;
const cfg = JSON.parse(fs.readFileSync(CFG, "utf8")).data as {
  fieldMappings: Record<string, unknown>;
  pageFlow: Array<{ url: string; action: string }>;
};
const fm = cfg.fieldMappings as Record<string, { selector: string; extractAttr?: string } | { _meta: unknown }>;
const meta = (fm._meta as Record<string, unknown>) || {};
const itemSelector = meta.itemSelector as string | undefined;
const setupScript = meta.setupScript as string | undefined;

const fieldSelectors: { name: string; selector: string; attr?: string }[] = [];
for (const [k, v] of Object.entries(fm)) {
  if (k === "_meta") continue;
  const f = v as { selector: string; extractAttr?: string };
  if (f && f.selector) fieldSelectors.push({ name: k, selector: f.selector, attr: f.extractAttr });
}

// Get the site URL
const all = JSON.parse(fs.readFileSync("/tmp/all-sites.json", "utf8")).data as Array<{ id: string; siteUrl: string }>;
const site = all.find((s) => s.id === SITE_ID);
if (!site) { console.error("site not found"); process.exit(3); }

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox","--disable-blink-features=AutomationControlled","--lang=he-IL"],
  });
  const ctx = await browser.newContext({
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
    extraHTTPHeaders: { "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7" },
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });
  const page = await ctx.newPage();
  console.log(`[goto] ${site.siteUrl}`);
  const resp = await page.goto(site.siteUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  console.log(`  http: ${resp ? resp.status() : "?"}`);
  await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(3000);
  if (setupScript) {
    console.log(`[setup] running setupScript (${setupScript.length} chars)`);
    try { await page.evaluate(`(async () => { ${setupScript} })()`); } catch (e) { console.log(`  setupErr: ${(e as Error).message}`); }
    await page.waitForTimeout(3000);
  }
  const out = await page.evaluate((args: { itemSel: string | undefined; fields: { name: string; selector: string; attr?: string }[] }) => {
    if (!args.itemSel) return { count: 0, samples: [], itemSel: null, noItemSel: true };
    const items = document.querySelectorAll(args.itemSel);
    const samples: Record<string, string | null>[] = [];
    for (let i = 0; i < Math.min(3, items.length); i++) {
      const it = items[i];
      const rec: Record<string, string | null> = {};
      for (const f of args.fields) {
        try {
          const el = it.querySelector(f.selector);
          if (!el) { rec[f.name] = null; continue; }
          if (f.attr) rec[f.name] = (el as HTMLElement).getAttribute(f.attr);
          else rec[f.name] = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 100);
        } catch (e) {
          rec[f.name] = `ERR: ${(e as Error).message}`;
        }
      }
      samples.push(rec);
    }
    return { count: items.length, samples, itemSel: args.itemSel };
  }, { itemSel: itemSelector, fields: fieldSelectors });
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();
