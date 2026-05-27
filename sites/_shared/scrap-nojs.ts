import { chromium } from 'playwright';

(async () => {
  const url = 'https://www.tikshoov.co.il/come-work-with-us/careers-list/?areaID=&jobType=';
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', javaScriptEnabled: false });
  const p = await ctx.newPage();
  const resp = await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  const count = await p.evaluate(() => document.querySelectorAll('.jobBox-wrapper').length);
  const title = await p.evaluate(() => {
    const t = document.querySelector('.jobBox-wrapper h3.job-title');
    return t ? (t.textContent || '').slice(0, 80) : null;
  });
  console.log(JSON.stringify({ status: resp?.status(), count, title }));
  await b.close();
})();
