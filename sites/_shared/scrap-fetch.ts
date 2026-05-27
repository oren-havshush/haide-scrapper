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
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  const html = await p.content();
  const outPath = path.resolve('.scratch', 'scrap-page.html');
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
      .slice(0, 20)
      .map(([sig, v]) => ({ sig, ...v }));
  });
  console.log(JSON.stringify({ summary, htmlBytes: html.length, htmlPath: outPath }, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
