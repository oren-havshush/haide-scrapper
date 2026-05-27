import { chromium } from 'playwright';
import * as fs from 'fs';

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

  // Capture full responses for the get-jobs API
  const apiBodies: any[] = [];
  p.on('response', async (resp) => {
    const u = resp.url();
    if (/\/api\/job-positions\/get-jobs/i.test(u)) {
      try {
        const text = await resp.text();
        apiBodies.push({ url: u, status: resp.status(), len: text.length, body: text });
      } catch (e) { /* ignore */ }
    }
  });

  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForSelector('.accordion-item', { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(3000);

  console.log('=== Initial GET responses ===');
  for (const r of apiBodies) {
    console.log(`${r.status} ${r.url}  (${r.len} bytes)`);
    console.log('first 500 chars:', r.body.slice(0, 500));
    fs.writeFileSync(`.scratch/assuta-api-${r.len}.json`, r.body);
  }

  // Now try the API directly with various param combos
  console.log('\n=== Direct API tests (in-page fetch, uses same origin) ===');
  const tests = [
    '',
    '?page=1',
    '?page=2',
    '?pageSize=100',
    '?pageSize=500',
    '?page=1&pageSize=500',
    '?limit=500',
    '?from=0&to=500',
  ];
  for (const q of tests) {
    const r = await p.evaluate(async (q) => {
      try {
        const resp = await fetch('/api/job-positions/get-jobs' + q, { credentials: 'same-origin' });
        const ct = resp.headers.get('content-type') || '';
        const text = await resp.text();
        let parsed: any = null;
        let n: number | null = null;
        try { parsed = JSON.parse(text); } catch { /* */ }
        if (parsed) {
          if (Array.isArray(parsed)) n = parsed.length;
          else if (parsed.jobs && Array.isArray(parsed.jobs)) n = parsed.jobs.length;
          else if (parsed.data && Array.isArray(parsed.data)) n = parsed.data.length;
          else if (parsed.items && Array.isArray(parsed.items)) n = parsed.items.length;
          else if (parsed.results && Array.isArray(parsed.results)) n = parsed.results.length;
        }
        return { status: resp.status, ct, len: text.length, count: n, head: text.slice(0, 250) };
      } catch (e: any) { return { error: String(e) }; }
    }, q);
    console.log(`q="${q}" -> status=${r.status} ct=${r.ct} len=${r.len} arrayLen=${r.count}`);
    if (r.error) console.log('  ERROR:', r.error);
    if (r.head) console.log('  head:', r.head.slice(0, 200));
  }

  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
