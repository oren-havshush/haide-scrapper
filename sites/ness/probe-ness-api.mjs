import { chromium } from 'playwright';

const BASE = 'https://www.ness-tech.co.il/careers';
const candidates = [
  `${BASE}/api/Careers/GetOrders`,
  `${BASE}/api/Careers/GetOrders/`,
  `${BASE}/api/Careers/GetAllOrders`,
  `${BASE}/api/Careers/GetAllOrders/`,
  `${BASE}/api/Careers/GetCareers`,
  `${BASE}/api/Careers/GetCareers/`,
  `${BASE}/api/Careers/Search`,
  `${BASE}/api/Careers/SearchOrders`,
  `${BASE}/api/Careers/SearchOrders/`,
  `${BASE}/api/Careers/SearchOrders?count=10`,
];

(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const p = await ctx.newPage();
  // Warm up cookies by visiting the listing first
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

  for (const u of candidates) {
    try {
      const r = await p.request.get(u, { headers: { 'accept': 'application/json' } });
      const ct = (r.headers()['content-type'] || '').toLowerCase();
      const text = await r.text();
      const isJson = ct.includes('json');
      const preview = isJson ? text.slice(0, 300) : `(${ct}, ${text.length} bytes)`;
      console.log(`[${r.status()}] ${ct.padEnd(45)} ${u}`);
      if (isJson || r.status() === 200) console.log(`    ${preview}`);
    } catch (e) {
      console.log(`[ERR] ${u}: ${e.message}`);
    }
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
