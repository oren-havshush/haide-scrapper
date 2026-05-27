import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL = process.argv[2];

(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    extraHTTPHeaders: { 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' },
  });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await p.waitForTimeout(3000);

  const html = await p.content();
  const outPath = path.join(os.tmpdir(), 'scrap-ness.html');
  fs.writeFileSync(outPath, html);

  const summary = await p.evaluate(() => {
    const stats = {};
    const all = document.querySelectorAll('*');
    for (const el of all) {
      if (!el.parentElement || !el.classList.length) continue;
      const sig = el.tagName + '|' + Array.from(el.classList).sort().join('.');
      const key = el.parentElement.tagName + ' > ' + sig;
      if (!stats[key]) stats[key] = { count: 0, sampleClass: Array.from(el.classList).join(' ') };
      stats[key].count++;
    }
    return Object.entries(stats)
      .filter(([_, v]) => v.count >= 3 && v.count <= 500)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 25)
      .map(([sig, v]) => ({ sig, ...v }));
  });

  const totalText = await p.evaluate(() => {
    const m = (document.body.innerText || '').match(/(\d+)\s*(?:משרות|jobs|positions|results)/i);
    return m ? m[0] : null;
  });

  const jobLinkProbe = await p.evaluate(() => {
    const candidates = ['a[href*="job"]', 'a[href*="position"]', 'a[href*="career"]', '.job', '.position', '[class*="job"]', '[class*="position"]', '[class*="vacanc"]'];
    return candidates.map(sel => ({ sel, count: document.querySelectorAll(sel).length }));
  });

  console.log(JSON.stringify({ htmlPath: outPath, htmlBytes: html.length, summary, totalText, jobLinkProbe }, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
