/**
 * Audit SKIPPED sites: visit each, run setupScript (if any), probe stored
 * selectors, detect WAF/login walls, surface candidate clusters.
 *
 *   npx tsx .skip-audit2.ts > /tmp/skip-audit/results.json
 *
 * Avoids inner-helper closures inside page.evaluate (tsx's __name injection
 * breaks them in the browser context).
 */
import { chromium, Browser, BrowserContext, Page } from "playwright";
import * as fs from "fs";
import * as path from "path";

type Site = {
  id: string;
  siteUrl: string;
  confidenceScore: number | null;
  skippedAt: string | null;
  latestScrapeRun: { status?: string; jobCount?: number } | null;
};

function readJSON<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

async function newCtx(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
    extraHTTPHeaders: { "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7" },
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    Object.defineProperty(navigator, "languages", { get: () => ["he-IL", "he", "en-US", "en"] });
  });
  const page = await ctx.newPage();
  return { ctx, page };
}

async function probe(page: Page, listingSelector: string | null, itemSelector: string | null) {
  return page.evaluate((args: { listing: string | null; item: string | null }) => {
    const listing = args.listing;
    const item = args.item;
    let listingCount = -1;
    let itemCount = -1;
    try {
      if (listing) listingCount = document.querySelectorAll(listing).length;
    } catch { listingCount = -2; }
    try {
      if (item) itemCount = document.querySelectorAll(item).length;
    } catch { itemCount = -2; }
    const text = (document.body && document.body.textContent ? document.body.textContent : "").toLowerCase();
    const html = document.documentElement.outerHTML;
    const wafSignals = {
      cloudflare: /cf-chl|cloudflare|just a moment|attention required/i.test(html),
      imperva: /incapsula|imperva|_incap_/i.test(html),
      akamai: /akam-sw|akamaihd|aksb-/i.test(html),
      reblaze: /reblaze|rbzid/i.test(html),
      recaptcha: /g-recaptcha|recaptcha\/api/i.test(html),
      loginWall: /התחבר|התחברות|sign in|log in|please log in/i.test(text) && html.length < 80000,
      emptyShell: html.length < 12000,
    };
    return {
      title: document.title,
      url: location.href,
      htmlBytes: html.length,
      textChars: text.length,
      listingCount,
      itemCount,
      anchorsWithJobInClass: document.querySelectorAll('a[class*="job" i], a[href*="job" i], a[href*="career" i], a[href*="position" i]').length,
      wafSignals,
    };
  }, { listing: listingSelector, item: itemSelector });
}

async function tryClusterHints(page: Page) {
  return page.evaluate(() => {
    const stats: Record<string, number> = {};
    const all = Array.from(document.querySelectorAll("*"));
    for (const el of all) {
      if (!el.parentElement || !el.classList.length) continue;
      const sig = el.tagName.toLowerCase() + "." + Array.from(el.classList).sort().join(".");
      const key = (el.parentElement.tagName.toLowerCase() + " > " + sig).slice(0, 200);
      stats[key] = (stats[key] || 0) + 1;
    }
    return Object.entries(stats)
      .filter((e) => e[1] >= 4 && e[1] <= 200)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map((e) => ({ sig: e[0], count: e[1] }));
  });
}

async function jobLinkSamples(page: Page) {
  return page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
    const likely = anchors.filter((a) => {
      const h = a.href.toLowerCase();
      return /job|career|position|vacanc|drush|drosh/.test(h) && !/login|signin|signup|contact/.test(h);
    });
    return likely.slice(0, 8).map((a) => ({
      href: a.href,
      text: (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
      parentTag: a.parentElement ? a.parentElement.tagName : null,
      parentClass: a.parentElement ? a.parentElement.className : null,
    }));
  });
}

async function main() {
  const skipped = readJSON<{ data: Site[] }>("/tmp/skipped.json").data;
  fs.mkdirSync("/tmp/skip-audit", { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-blink-features=AutomationControlled",
      "--lang=he-IL",
    ],
  });

  const results: Array<Record<string, unknown>> = [];

  for (const site of skipped) {
    const cfgPath = `/tmp/skip-audit/${site.id}.config.json`;
    let cfg: {
      data: {
        fieldMappings: { _meta?: { listingSelector?: string | null; itemSelector?: string | null; setupScript?: string | null } } | null;
        pageFlow: Array<{ url: string; action: string }> | null;
      };
    };
    try {
      cfg = readJSON(cfgPath);
    } catch (e) {
      results.push({ id: site.id, url: site.siteUrl, fatal: `no config: ${(e as Error).message}` });
      continue;
    }
    const meta = (cfg.data.fieldMappings && cfg.data.fieldMappings._meta) || {};
    const listingSelector = meta.listingSelector || null;
    const itemSelector = meta.itemSelector || null;
    const setupScript = meta.setupScript || null;
    const pageFlow = cfg.data.pageFlow || [];

    const out: Record<string, unknown> = {
      id: site.id,
      url: site.siteUrl,
      confidence: site.confidenceScore,
      lastRunStatus: site.latestScrapeRun ? site.latestScrapeRun.status : null,
      lastJobCount: site.latestScrapeRun ? site.latestScrapeRun.jobCount : null,
      listingSelector,
      itemSelector,
      hasSetupScript: Boolean(setupScript),
      pageFlow,
    };

    const { ctx, page } = await newCtx(browser);
    try {
      let respStatus: number | null = null;
      try {
        const resp = await page.goto(site.siteUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        respStatus = resp ? resp.status() : null;
      } catch (e) {
        out.gotoError = (e as Error).message;
      }
      out.httpStatus = respStatus;
      await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
      await page.waitForTimeout(2500);

      out.beforeSetup = await probe(page, listingSelector, itemSelector);

      if (setupScript) {
        try { await page.evaluate(`(async () => { ${setupScript} })()`); } catch (e) { out.setupError = (e as Error).message; }
        await page.waitForTimeout(2500);
        out.afterSetup = await probe(page, listingSelector, itemSelector);
      }

      const beforeCount = (out.beforeSetup as { itemCount?: number }).itemCount ?? -1;
      const afterCount = (out.afterSetup as { itemCount?: number } | undefined)?.itemCount ?? beforeCount;

      if (afterCount <= 0 && beforeCount <= 0) {
        out.clusterHints = await tryClusterHints(page);
        out.jobLinks = await jobLinkSamples(page);
      }

      const safeName = site.id;
      fs.writeFileSync(path.join("/tmp/skip-audit", `${safeName}.html`), await page.content());
    } catch (e) {
      out.fatal = (e as Error).message;
    } finally {
      await ctx.close().catch(() => {});
    }
    results.push(out);
    const ic = (out.afterSetup as { itemCount?: number } | undefined)?.itemCount ?? (out.beforeSetup as { itemCount?: number } | undefined)?.itemCount ?? "?";
    console.error(`[done] ${site.siteUrl} — items: ${ic}`);
  }

  await browser.close();
  fs.writeFileSync("/tmp/skip-audit/results.json", JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
