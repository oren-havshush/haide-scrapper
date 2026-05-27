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

  const requests: Array<{ url: string; method: string; postData: string | null }> = [];
  p.on('request', (req) => {
    if (req.url().includes('admin-ajax') || req.url().includes('careers')) {
      requests.push({ url: req.url(), method: req.method(), postData: req.postData() });
    }
  });

  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(1500);

  // Click load-more once and capture
  const btn = await p.$('#load-more-jobs');
  if (btn) {
    await btn.click();
    await p.waitForTimeout(3000);
  }

  console.log('Captured requests:');
  for (const r of requests) {
    console.log(`  ${r.method} ${r.url}`);
    if (r.postData) console.log(`    body: ${r.postData.slice(0, 300)}`);
  }

  // Try the trick URL ?posts_per_page=200
  console.log('\n--- Trying ?posts_per_page=200 ---');
  await p.goto(url + '?posts_per_page=200', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(1500);
  const c1 = await p.evaluate(() => document.querySelectorAll('.accordion_item').length);
  console.log('accordion_item count with posts_per_page=200:', c1);

  console.log('\n--- Trying ?showposts=200 ---');
  await p.goto(url + '?showposts=200', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(1500);
  const c2 = await p.evaluate(() => document.querySelectorAll('.accordion_item').length);
  console.log('accordion_item count with showposts=200:', c2);

  console.log('\n--- Trying ?max=200 ---');
  await p.goto(url + '?max=200', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(1500);
  const c3 = await p.evaluate(() => document.querySelectorAll('.accordion_item').length);
  console.log('accordion_item count with max=200:', c3);

  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
