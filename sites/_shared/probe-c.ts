/**
 * Targeted probe for the 4 broken-selector sites.
 * Loads each, sleeps, and emits cluster + anchor hints we can use to pick new selectors.
 *
 *   npx tsx .probe-c.ts > /tmp/skip-audit/probe-c.json
 */
import { chromium } from "playwright";
import * as fs from "fs";

const SITES: { id: string; url: string }[] = [
  { id: "cmpay3wac002201lsq3pdkijf", url: "https://career.malamteam.com/%D7%A8%D7%A9%D7%99%D7%9E%D7%AA-%D7%9E%D7%A9%D7%A8%D7%95%D7%AA/" },
  { id: "cmp9x7ztw001x01ls5d0qdxzl", url: "https://www.menoramivt.co.il/job-posting/open-position" },
  { id: "cmozjcfq5000s01phd9itwowu", url: "https://www.cal-online.co.il/about/jobs/" },
];

async function probe(url: string) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox","--disable-blink-features=AutomationControlled","--lang=he-IL"],
  });
  const ctx = await browser.newContext({
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    extraHTTPHeaders: { "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7" },
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    Object.defineProperty(navigator, "languages", { get: () => ["he-IL","he","en-US","en"] });
  });
  const page = await ctx.newPage();
  let status: number | null = null;
  try {
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    status = resp ? resp.status() : null;
  } catch {}
  await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(3500);

  const probeData = await page.evaluate(() => {
    const html = document.documentElement.outerHTML;
    const title = document.title;
    const stats: Record<string, number> = {};
    const all = Array.from(document.querySelectorAll("*"));
    for (const el of all) {
      if (!el.parentElement || !el.classList.length) continue;
      const sig = el.tagName.toLowerCase() + "." + Array.from(el.classList).sort().join(".");
      const key = (el.parentElement.tagName.toLowerCase() + " > " + sig).slice(0, 200);
      stats[key] = (stats[key] || 0) + 1;
    }
    const clusters = Object.entries(stats)
      .filter((e) => e[1] >= 3 && e[1] <= 200)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map((e) => ({ sig: e[0], count: e[1] }));

    const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
    const likely = anchors.filter((a) => {
      const h = a.href.toLowerCase();
      const t = (a.textContent || "").trim();
      if (!t || t.length > 200) return false;
      return /job|career|position|vacanc|drush|drosh|jobid|position-id/i.test(h) && !/login|signin|signup|contact|privacy/.test(h);
    });
    const samples = likely.slice(0, 10).map((a) => ({
      href: a.href,
      text: (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
      classes: a.className,
      parentTag: a.parentElement ? a.parentElement.tagName : null,
      parentClass: a.parentElement ? a.parentElement.className : null,
    }));

    // Also look for data-attribute clusters (often used for job lists)
    const dataAttrCounts: Record<string, number> = {};
    for (const el of all) {
      for (const a of (el as Element).getAttributeNames()) {
        if (a.startsWith("data-")) dataAttrCounts[a] = (dataAttrCounts[a] || 0) + 1;
      }
    }
    const topDataAttrs = Object.entries(dataAttrCounts).sort((a, b) => b[1] - a[1]).slice(0, 12);

    // ARIA roles common for lists
    const roles: Record<string, number> = {};
    for (const el of all) {
      const r = (el as HTMLElement).getAttribute("role");
      if (r) roles[r] = (roles[r] || 0) + 1;
    }

    return {
      title,
      htmlBytes: html.length,
      clusters,
      anchorSamples: samples,
      anchorCount: likely.length,
      topDataAttrs,
      roles: Object.entries(roles).sort((a,b)=>b[1]-a[1]).slice(0,10),
    };
  });

  fs.writeFileSync(`/tmp/skip-audit/probe-${probeData.title.slice(0,20).replace(/\s+/g,'_')}.html`, await page.content());
  await browser.close();
  return { url, httpStatus: status, ...probeData };
}

(async () => {
  const out: Record<string, unknown> = {};
  for (const s of SITES) {
    console.error(`[probing] ${s.url}`);
    try {
      out[s.id] = await probe(s.url);
    } catch (e) {
      out[s.id] = { url: s.url, fatal: (e as Error).message };
    }
  }
  console.log(JSON.stringify(out, null, 2));
})();
