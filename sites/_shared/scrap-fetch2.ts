import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

(async () => {
  const url = process.argv[2];
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    extraHTTPHeaders: { 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' },
  });
  const p = await ctx.newPage();

  const xhrs: { url: string; method: string; status?: number; ct?: string; bytes?: number }[] = [];
  p.on('response', async (resp) => {
    const u = resp.url();
    const ct = resp.headers()['content-type'] || '';
    // Skip static asset + analytics noise
    if (/\.(js|css|woff2?|png|jpg|svg|ico)(\?|$)/i.test(u)) return;
    if (/google|facebook|gtag|doubleclick|nagishli/i.test(u)) return;
    let bytes = 0;
    try { const buf = await resp.body(); bytes = buf.length; } catch {}
    xhrs.push({ url: u, method: resp.request().method(), status: resp.status(), ct, bytes });
  });

  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  // Give the client time to hydrate and run its data fetch
  await p.waitForTimeout(4000);
  // Scroll to bottom in case items lazy-load
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await p.waitForTimeout(2000);

  const html = await p.content();
  const outPath = path.resolve('.scratch', 'scrap-page2.html');
  fs.writeFileSync(outPath, html);

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

  console.log(JSON.stringify({ summary, htmlBytes: html.length, htmlPath: outPath, xhrs }, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
