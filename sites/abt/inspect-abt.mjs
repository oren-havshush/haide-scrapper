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
  await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  const html = await p.content();
  const outPath = path.join(os.tmpdir(), 'scrap-abt.html');
  fs.writeFileSync(outPath, html);

  const summary = await p.evaluate(() => {
    const stats = {};
    const all = document.querySelectorAll('*');
    for (const el of all) {
      if (!el.parentElement || !el.classList.length) continue;
      const sig = el.tagName + '|' + Array.from(el.classList).sort().join('.');
      const key = el.parentElement.tagName + ' > ' + sig;
      if (!stats[key]) stats[key] = { count: 0, sampleClass: Array.from(el.classList).join(' '), parentTag: el.parentElement.tagName };
      stats[key].count++;
    }
    return Object.entries(stats)
      .filter(([_, v]) => v.count >= 2 && v.count <= 500)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 30)
      .map(([sig, v]) => ({ sig, ...v }));
  });

  const headings = await p.evaluate(() => {
    const out = [];
    for (const h of document.querySelectorAll('h1,h2,h3,h4')) {
      out.push({ tag: h.tagName, text: (h.textContent || '').replace(/\s+/g,' ').trim().slice(0, 120), classes: h.className });
    }
    return out;
  });

  console.log(JSON.stringify({ htmlPath: outPath, htmlBytes: html.length, summary, headings }, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
