import { chromium } from 'playwright';
(async () => {
  const URL = process.argv[2];
  const OUT = process.argv[3];
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    locale: 'he-IL', timezoneId: 'Asia/Jerusalem',
    viewport: { width: 1440, height: 1800 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(2000);
  const html = await p.content();
  require('fs').writeFileSync(OUT, html);
  console.log('bytes:', html.length, 'url:', p.url(), 'title:', await p.title());
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
