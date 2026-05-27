import { chromium } from 'playwright';
(async () => {
  const URL = process.argv[2];
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', viewport: { width: 1440, height: 1800 } });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  const r = await p.evaluate(() => {
    const sel1 = '.tool_text:has(span[style*="font-size:20px"])';
    const sel2 = '.tool_text:has(span[style*="font-size:18px"])';
    const sel3 = '.tool_text:has(u strong)';
    return {
      sel1Count: document.querySelectorAll(sel1).length,
      sel2Count: document.querySelectorAll(sel2).length,
      sel3Count: document.querySelectorAll(sel3).length,
    };
  });
  console.log(JSON.stringify(r, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
