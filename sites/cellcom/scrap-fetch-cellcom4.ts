import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

(async () => {
  const url = process.argv[2];
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 1500 },
    extraHTTPHeaders: { 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8' },
  });
  const p = await ctx.newPage();

  const xhrs: { url: string; status: number; method: string; contentType?: string }[] = [];
  p.on('response', async (r) => {
    const u = r.url();
    if ((u.includes('cellcom') || u.includes('episerver')) && r.request().resourceType() !== 'image' && r.request().resourceType() !== 'stylesheet' && r.request().resourceType() !== 'font') {
      xhrs.push({ url: u, status: r.status(), method: r.request().method(), contentType: r.headers()['content-type'] });
    }
  });

  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await p.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await p.waitForFunction(() => (window as any).prerenderReady === true, null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(5000);

  // Trigger possible scroll-based loading
  for (let i = 0; i < 6; i++) {
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await p.waitForTimeout(1000);
  }

  // Save screenshot
  await p.screenshot({ path: path.resolve('.scratch', 'cellcom-screenshot.png'), fullPage: true });

  // Save HTML
  const html = await p.content();
  fs.writeFileSync(path.resolve('.scratch', 'cellcom-rendered.html'), html);

  // Body text + structure stats
  const bodyTextHead = await p.evaluate(() => (document.body?.innerText || '').slice(0, 8000));
  const linkCount = await p.evaluate(() => document.querySelectorAll('a').length);
  const allHrefs = await p.evaluate(() =>
    Array.from(document.querySelectorAll('a[href]'))
      .map((a) => (a as HTMLAnchorElement).href)
      .filter((h) => h.includes('Careersportal') || h.includes('jobs') || h.includes('career'))
      .slice(0, 30)
  );

  const summary = await p.evaluate(() => {
    const stats: Record<string, { count: number; sampleClass: string; parentTag: string }> = {};
    const all = document.querySelectorAll('*');
    for (const el of all) {
      if (!el.parentElement || !el.classList.length) continue;
      const sig = el.tagName + '|' + Array.from(el.classList).sort().join('.');
      const key = el.parentElement.tagName + ' > ' + sig;
      if (!stats[key]) stats[key] = { count: 0, sampleClass: Array.from(el.classList).join(' '), parentTag: el.parentElement.tagName };
      stats[key].count++;
    }
    return Object.entries(stats)
      .filter(([_, v]) => v.count >= 3 && v.count <= 500)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 30)
      .map(([sig, v]) => ({ sig, ...v }));
  });

  console.log(JSON.stringify({ htmlBytes: html.length, bodyTextHead, linkCount, allHrefs, summary, xhrs: xhrs.slice(0, 50) }, null, 2));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
