import { chromium } from 'playwright';
import * as fs from 'fs';

(async () => {
  const url = process.argv[2];
  const b = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'] });
  const ctx = await b.newContext({
    locale: 'he-IL', timezoneId: 'Asia/Jerusalem',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
  });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(1500);

  const result = await p.evaluate(async () => {
    const body = 'FreeText=&ResultsPerPage=500&PageNumber=0&AdvertisingDestination=1';
    const resp = await fetch('/Umbraco/api/SearchJobsApi/FilterJobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      credentials: 'same-origin',
    });
    const ct = resp.headers.get('content-type') || '';
    const text = await resp.text();
    return { status: resp.status, ct, len: text.length, head: text.slice(0, 2000) };
  });
  console.log('status:', result.status);
  console.log('content-type:', result.ct);
  console.log('length:', result.len);
  console.log('--- first 2000 chars ---');
  console.log(result.head);
  fs.writeFileSync('.scratch/ajax-response.txt', result.head);

  // Now try PageNumber=0 ResultsPerPage=8 — the actual click behavior
  const result2 = await p.evaluate(async () => {
    const body = 'FreeText=&ResultsPerPage=8&PageNumber=1&AdvertisingDestination=1';
    const resp = await fetch('/Umbraco/api/SearchJobsApi/FilterJobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      credentials: 'same-origin',
    });
    const text = await resp.text();
    return { status: resp.status, len: text.length, head: text.slice(0, 2000) };
  });
  console.log('\n--- second response (PageNumber=1, RPP=8) ---');
  console.log('status:', result2.status, 'len:', result2.len);
  console.log(result2.head);

  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
