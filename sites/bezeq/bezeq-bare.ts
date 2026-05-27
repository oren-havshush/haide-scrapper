import { chromium } from 'playwright';

(async () => {
  const url = process.argv[2];
  const b = await chromium.launch({ headless: true });
  // Bare context - no UA, no extra headers - what a vanilla worker might do
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  try {
    const resp = await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('status:', resp?.status());
    console.log('title:', await p.title());
  } catch (e) {
    console.log('NAV ERROR:', (e as Error).message);
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
