import { chromium } from 'playwright';

(async () => {
  const urls = [
    'https://www.tikshoov.co.il/come-work-with-us/careers-list/?areaID=&jobType=',
    'https://www.tikshoov.co.il/come-work-with-us/careers-list/',
    'https://www.tikshoov.co.il/come-work-with-us/careers-list',
    'https://www.tikshoov.co.il/come-work-with-us/',
  ];
  const b = await chromium.launch({ headless: true });
  for (const url of urls) {
    const ctx = await b.newContext({ locale: 'he-IL' });
    const p = await ctx.newPage();
    try {
      const resp = await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await p.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
      const finalUrl = p.url();
      const count = await p.evaluate(() => document.querySelectorAll('.jobBox-wrapper').length);
      const status = resp?.status();
      console.log(JSON.stringify({ input: url, finalUrl, status, jobBoxCount: count }));
    } catch (e: any) {
      console.log(JSON.stringify({ input: url, error: String(e.message || e) }));
    }
    await ctx.close();
  }
  await b.close();
})();
