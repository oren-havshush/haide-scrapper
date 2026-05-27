import { chromium } from 'playwright';
(async () => {
  const URL = process.argv[2];
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', viewport: { width: 1440, height: 1800 } });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(3000);
  const r = await p.evaluate(() => ({
    rows: document.querySelectorAll('.TableRowWrap').length,
    rowsVisible: Array.from(document.querySelectorAll('.TableRowWrap')).filter(el => !(el as HTMLElement).hidden && (el as HTMLElement).offsetParent !== null).length,
    panels: document.querySelectorAll('.AllTablesWrap').length,
  }));
  console.log(JSON.stringify(r, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
