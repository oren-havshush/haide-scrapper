import { chromium } from 'playwright';
(async () => {
  const URL = process.argv[2];
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    viewport: { width: 1440, height: 1800 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    extraHTTPHeaders: {
      'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => {
    const c = document.querySelector('.population-target');
    return c && c.children.length > 0;
  }, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(2000);
  const r = await p.evaluate(() => {
    const target = document.querySelector('.population-target');
    return {
      targetChildren: target ? target.children.length : -1,
      preview: target ? target.innerHTML.slice(0, 500) : '',
    };
  });
  console.log(JSON.stringify(r, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
