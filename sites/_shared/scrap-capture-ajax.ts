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

  const reqs: any[] = [];
  p.on('request', (req) => {
    const u = req.url();
    if (u.includes('careers') && req.method() !== 'GET') {
      reqs.push({ method: req.method(), url: u, postData: req.postData() });
    }
    if (u.includes('Job') || u.includes('search') || u.includes('positions') || u.includes('Load')) {
      if (req.method() === 'POST' || u.includes('?')) {
        reqs.push({ method: req.method(), url: u, postData: req.postData() });
      }
    }
  });

  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(1500);

  console.log('--- Clicking load-more once ---');
  await p.evaluate(() => {
    const btn = document.querySelector('button.load-more-jobs') as HTMLButtonElement;
    if (window['jQuery']) (window['jQuery'])(btn).trigger('click');
    else btn.click();
  });
  await p.waitForTimeout(5000);

  console.log('--- Captured requests ---');
  for (const r of reqs) {
    console.log(`${r.method} ${r.url}`);
    if (r.postData) console.log(`  body: ${r.postData.slice(0, 500)}`);
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
