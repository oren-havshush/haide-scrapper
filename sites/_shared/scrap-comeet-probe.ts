import { chromium } from 'playwright';

(async () => {
  const candidates = [
    'https://www.comeet.co/jobs/26.009',
    'https://www.comeet.co/jobs/26.009/',
    'https://www.comeet.co/career-careers-jobs?co=26.009',
    'https://www.comeet.co/api/companies/26.009/positions',  // possible JSON API
  ];
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL' });
  const p = await ctx.newPage();
  for (const url of candidates) {
    try {
      const resp = await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      const text = (await p.content()).slice(0, 400);
      console.log(`${url} -> status=${resp ? resp.status() : '?'} final=${p.url()}`);
      console.log(`  title="${(await p.title()).slice(0, 80)}"`);
      console.log(`  preview=${text.replace(/\s+/g, ' ').slice(0, 300)}`);
    } catch (e) {
      console.log(`${url} -> ERROR ${String(e).slice(0, 200)}`);
    }
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
