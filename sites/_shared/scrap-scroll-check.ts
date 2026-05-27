import { chromium } from 'playwright';

(async () => {
  const url = process.argv[2];
  const b = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });
  const ctx = await b.newContext({
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
    extraHTTPHeaders: { 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' },
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(1500);

  const countSel = '.job-item:not(.job-item-clone)';
  const initial = await p.evaluate((s) => document.querySelectorAll(s).length, countSel);
  console.log('initial real .job-item count:', initial);

  for (let i = 0; i < 3; i++) {
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await p.waitForTimeout(1500);
    const c = await p.evaluate((s) => document.querySelectorAll(s).length, countSel);
    console.log(`after scroll ${i + 1}:`, c);
  }

  const hasBtn = await p.evaluate(() => !!document.querySelector('button.load-more-jobs'));
  console.log('load-more-jobs button present:', hasBtn);
  if (hasBtn) {
    for (let i = 0; i < 25; i++) {
      const btn = await p.$('button.load-more-jobs');
      if (!btn) { console.log(`btn gone after click ${i}`); break; }
      const visible = await btn.isVisible().catch(() => false);
      if (!visible) { console.log(`btn hidden after click ${i}`); break; }
      await btn.click().catch(() => {});
      await p.waitForTimeout(1500);
      const c = await p.evaluate((s) => document.querySelectorAll(s).length, countSel);
      console.log(`after click ${i + 1}:`, c);
    }
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
