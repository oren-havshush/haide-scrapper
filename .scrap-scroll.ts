import { chromium } from 'playwright';
(async () => {
  const URL = process.argv[2];
  const SEL = process.argv[3];
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  let prev = await p.evaluate((s) => document.querySelectorAll(s).length, SEL);
  console.log('initial:', prev);
  for (let i = 0; i < 20; i++) {
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await p.waitForTimeout(1200);
    const c = await p.evaluate((s) => document.querySelectorAll(s).length, SEL);
    if (c === prev) { console.log('plateau at', c, 'after', i + 1, 'scrolls'); break; }
    prev = c;
    console.log(`scroll ${i + 1}:`, c);
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
