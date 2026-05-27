import { chromium } from 'playwright';
(async () => {
  const URL = 'https://www.ashtrom.co.il/career';
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: { width: 1440, height: 1800 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(3000);
  const r = await p.evaluate(() => ({
    items1: document.querySelectorAll('a[class*="JobCard-StyledLinkWrapp"]').length,
    cards1: document.querySelectorAll('[class*="JobCard"]').length,
    cards2: document.querySelectorAll('[class*="JobsDisplay-JobCards"]').length,
    h3: document.querySelectorAll('h3').length,
    bodyTextLen: (document.body?.innerText || '').length,
    bodyTextSample: (document.body?.innerText || '').slice(0, 400),
  }));
  console.log(JSON.stringify(r, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
