import { chromium } from 'playwright';

async function tryNav(label: string, opts: any) {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext(opts);
  const p = await ctx.newPage();
  const t0 = Date.now();
  try {
    const r = await p.goto('https://www.bezeq.co.il/career_new/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    console.log(`${label}: OK status=${r?.status()} elapsed=${Date.now() - t0}ms`);
  } catch (e: any) {
    console.log(`${label}: FAIL ${e.message?.split('\n')[0]} elapsed=${Date.now() - t0}ms`);
  } finally {
    await b.close();
  }
}

(async () => {
  // 1. Bare default Playwright (HeadlessChrome UA)
  await tryNav('default-UA', {});
  // 2. Same but with real Chrome UA + he-IL
  await tryNav('chrome-UA+he-IL', {
    locale: 'he-IL', timezoneId: 'Asia/Jerusalem',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' },
  });
  // 3. Just real Chrome UA, no he-IL
  await tryNav('chrome-UA-only', {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  // 4. Just he-IL, default UA
  await tryNav('he-IL-only', {
    locale: 'he-IL', timezoneId: 'Asia/Jerusalem',
    extraHTTPHeaders: { 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' },
  });
})();
