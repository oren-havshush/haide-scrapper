/**
 * Audit the SKIPPED sites: visit each one with the same Playwright config the
 * worker uses, see what the live page looks like, and report whether the
 * stored selectors still match anything.
 *
 *   npx tsx .skip-audit.ts > /tmp/skip-audit.json
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

const TOKEN = "b4c323139be81fcd7b27ad1b16e6d372e941e011f1bd45b950823ad65bcf76b1";
const BASE = "https://scrapper.haide-jobs.co.il";

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
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
  });
  const page = await ctx.newPage();
  return { ctx, page };
}

async function probe(page: Page, listingSelector: string | null, itemSelector: string | null) {
  return page.evaluate(
    ({ listing, item }) => {
      function safeQAll(sel: string | null): number {
        if (!sel) return -1;
        try { return document.querySelectorAll(sel).length; } catch { return -2; }
      }
      const text = (document.body?.textContent || "").toLowerCase();
      const html = document.documentElement.outerHTML;
      const wafSignals = {
        cloudflare: /cf-chl|cloudflare|just a moment|attention required/i.test(html),
        imperva: /incapsula|imperva|_incap_/i.test(html),
        akamai: /akam-sw|akamaihd|aksb-/i.test(html),
        recaptcha: /g-recaptcha|recaptcha\/api/i.test(html),
        loginWall: /התחבר|התחברות|sign in|log in|please log in/i.test(text) && html.length < 80000,
        emptyShell: html.length < 12000,
      };
      return {
        title: document.title,
        url: location.href,
        htmlBytes: html.length,
        textChars: text.length,
        listingCount: safeQAll(listing),
        itemCount: safeQAll(item),
        anchorsWithJobInClass: document.querySelectorAll('a[class*="job" i], a[href*="job" i], a[href*="career" i], a[href*="position" i]').length,
        wafSignals,
      };
    },
    { listing: listingSelector, item: itemSelector },
  );
}

async function tryClusterHints(page: Page) {
  return page.evaluate(() => {
    const stats: Record<string, number> = {};
    for (const el of Array.from(document.querySelectorAll("*"))) {
      if (!el.parentElement || !el.classList.length) continue;
      const sig = el.tagName.toLowerCase() + "." + Array.from(el.classList).sort().join(".");
      const key = (el.parentElement.tagName.toLowerCase() + " > " + sig).slice(0, 200);
      stats[key] = (stats[key] || 0) + 1;
    }
    return Object.entries(stats)
      .filter(([, n]) => n >= 4 && n <= 200)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([sig, count]) => ({ sig, count }));
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
    const cfg = readJSON<{
      data: {
        fieldMappings: { _meta?: { listingSelector?: string | null; itemSelector?: string | null; setupScript?: string | null; pagination?: unknown; formCapture?: unknown } };
        pageFlow: Array<{ url: string; action: string }>;
      };
    }>(cfgPath);
    const meta = cfg.data.fieldMappings?._meta ?? {};
    const listingSelector = meta.listingSelector ?? null;
    const itemSelector = meta.itemSelector ?? null;
    const setupScript = meta.setupScript ?? null;
    const pageFlow = cfg.data.pageFlow ?? [];

    const out: Record<string, unknown> = {
      id: site.id,
      url: site.siteUrl,
      confidence: site.confidenceScore,
      lastRunStatus: site.latestScrapeRun?.status ?? null,
      lastJobCount: site.latestScrapeRun?.jobCount ?? null,
      listingSelector,
      itemSelector,
      hasSetupScript: Boolean(setupScript),
      hasFormCapture: Boolean(meta.formCapture),
      pageFlow,
    };

    const { ctx, page } = await newCtx(browser);
    try {
      let respStatus: number | null = null;
      try {
        const resp = await page.goto(site.siteUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        respStatus = resp?.status() ?? null;
      } catch (e) {
        out.gotoError = (e as Error).message;
      }
      out.httpStatus = respStatus;
      await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
      await page.waitForTimeout(2500);

      out.beforeSetup = await probe(page, listingSelector, itemSelector);

      if (setupScript) {
        try { await page.evaluate(setupScript); } catch (e) { out.setupError = (e as Error).message; }
        out.afterSetup = await probe(page, listingSelector, itemSelector);
      }

      if (((out.beforeSetup as { itemCount?: number })?.itemCount ?? 0) <= 0 && ((out.afterSetup as { itemCount?: number } | undefined)?.itemCount ?? 0) <= 0) {
        out.clusterHints = await tryClusterHints(page);
      }

      // Try first detail link if pageFlow has a detail step
      const detailStep = pageFlow.find((s) => s.action === "navigate" && s.url !== site.siteUrl);
      if (detailStep && (((out.afterSetup as { itemCount?: number } | undefined)?.itemCount ?? (out.beforeSetup as { itemCount?: number }).itemCount) ?? 0) > 0) {
        const firstHref = await page.evaluate((sel: string) => {
          const items = document.querySelectorAll(sel);
          const first = items[0];
          const a = first?.querySelector("a[href]") as HTMLAnchorElement | null;
          return a ? a.href : null;
        }, itemSelector!);
        out.firstItemHref = firstHref;
      }

      const safeName = site.id;
      fs.writeFileSync(path.join("/tmp/skip-audit", `${safeName}.html`), await page.content());
    } catch (e) {
      out.fatal = (e as Error).message;
    } finally {
      await ctx.close().catch(() => {});
    }
    results.push(out);
    console.error(`[done] ${site.siteUrl} — items: ${(out.afterSetup as { itemCount?: number } | undefined)?.itemCount ?? (out.beforeSetup as { itemCount?: number } | undefined)?.itemCount}`);
  }

  await browser.close();
  fs.writeFileSync("/tmp/skip-audit/results.json", JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
