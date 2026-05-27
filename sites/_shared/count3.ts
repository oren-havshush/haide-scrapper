import { chromium } from 'playwright';
(async () => {
  const URL = process.argv[2];
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', viewport: { width: 1440, height: 1800 } });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  const r = await p.evaluate(() => ({
    cols33: document.querySelectorAll('.elementor-col-33:has(a[title="להגשת מועמדות"])').length,
    cols: document.querySelectorAll('.elementor-column:has(a[title="להגשת מועמדות"])').length,
    buttonWraps: document.querySelectorAll('.elementor-widget-wrap:has(a[title="להגשת מועמדות"])').length,
    applyLinks: document.querySelectorAll('a[title="להגשת מועמדות"]').length,
  }));
  console.log(JSON.stringify(r, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
