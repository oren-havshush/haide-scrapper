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

  // Capture the niloo POST response (the jobs JSON)
  p.on('response', async (resp) => {
    const u = resp.url();
    if (u.includes('niloo-server.herokuapp.com')) {
      try {
        const body = await resp.body();
        fs.writeFileSync(path.resolve('.scratch', 'niloo-response.bin'), body);
        console.log(`Saved niloo response: ${body.length} bytes status=${resp.status()} ct=${resp.headers()['content-type']}`);
      } catch (e: any) {
        console.log('Could not save niloo body:', e?.message);
      }
    }
  });

  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  // Wait until JobsContext logs that it fetched jobs
  await p.waitForFunction(() => document.body.innerText.length > 5000, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(4000);

  const html = await p.content();
  fs.writeFileSync(path.resolve('.scratch', 'scrap-page4.html'), html);
  console.log(`HTML size: ${html.length}`);

  // Run a fresh structural summary, this time filtered to elements with substantial inner text
  const summary = await p.evaluate(() => {
    const stats: Record<string, { count: number; sampleClass: string; parentTag: string; sampleText: string }> = {};
    const all = document.querySelectorAll('*');
    for (const el of all) {
      if (!el.parentElement || !el.classList.length) continue;
      const sig = el.tagName + '|' + Array.from(el.classList).sort().join('.');
      const key = el.parentElement.tagName + ' > ' + sig;
      if (!stats[key]) {
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100);
        stats[key] = { count: 0, sampleClass: Array.from(el.classList).join(' '), parentTag: el.parentElement.tagName, sampleText: text };
      }
      stats[key].count++;
    }
    return Object.entries(stats)
      .filter(([_, v]) => v.count >= 3 && v.count <= 1000)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 30)
      .map(([sig, v]) => ({ sig, ...v }));
  });

  console.log(JSON.stringify({ summary }, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
