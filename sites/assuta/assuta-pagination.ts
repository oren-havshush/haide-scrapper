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

  const interestingReqs: any[] = [];
  p.on('request', (req) => {
    const u = req.url();
    if (
      /\/api\/|\/_next\/data\/|umbraco|graphql/i.test(u) &&
      !/google|gtm|facebook|hcaptcha|perfdrive|hotjar|doubleclick|gstatic/i.test(u)
    ) {
      interestingReqs.push({ method: req.method(), url: u.slice(0, 250), postData: req.postData()?.slice(0, 300) });
    }
  });

  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForSelector('.accordion-item', { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(2000);

  // Title sanity
  const title = await p.title();
  console.log('page title:', title);

  // Initial count
  let count = await p.evaluate(() => document.querySelectorAll('.accordion-item').length);
  console.log('initial .accordion-item count:', count);

  // Search for visible "load more" / pagination text/buttons
  const found = await p.evaluate(() => {
    const out: any = { allButtons: [], totalText: [] };
    document.querySelectorAll('button, a').forEach(el => {
      const t = (el.textContent || '').trim();
      if (t && t.length < 50) out.allButtons.push(t);
    });
    document.querySelectorAll('h1, h2, h3, h4, p, span, div').forEach(el => {
      const t = (el.textContent || '').trim();
      if (/^\d{1,4}\s+(משרות|jobs|results)/i.test(t) || /(נמצאו|מציג)\s*\d+/i.test(t) || /^\d{1,4}\s+מתוך/.test(t)) {
        out.totalText.push(t.slice(0, 100));
      }
    });
    return out;
  });
  console.log('all unique button/link texts:', Array.from(new Set(found.allButtons)).slice(0, 40));
  console.log('total-count texts:', found.totalText);

  // Scroll to bottom 5 times and see if count grows
  for (let i = 0; i < 5; i++) {
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await p.waitForTimeout(2000);
    const c = await p.evaluate(() => document.querySelectorAll('.accordion-item').length);
    console.log(`after scroll ${i + 1}: count=${c}`);
  }

  console.log('\n--- /api/ or /_next/data/ requests captured ---');
  for (const r of interestingReqs.slice(0, 30)) {
    console.log(`${r.method} ${r.url}`);
    if (r.postData) console.log('  body:', r.postData);
  }

  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
