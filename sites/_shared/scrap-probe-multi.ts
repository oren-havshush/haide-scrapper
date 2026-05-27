import { chromium } from 'playwright';

const urls = [
  'https://www.mizrahi-tefahot.co.il/about-mizrahi-tefahot-he/career/open-jobs/mizrahiliveteler/',
  'https://www.mizrahi-tefahot.co.il/about-mizrahi-tefahot-he/career/open-jobs/business-economist/',
  'https://www.mizrahi-tefahot.co.il/about-mizrahi-tefahot-he/career/open-jobs/operation-officer-management/',
  'https://www.mizrahi-tefahot.co.il/about-mizrahi-tefahot-he/career/open-jobs/customer-tel-aviv/',
  'https://www.mizrahi-tefahot.co.il/about-mizrahi-tefahot-he/career/open-jobs/lodseller/',
];

(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  for (const url of urls) {
    const p = await ctx.newPage();
    try {
      await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await p.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
      const r = await p.evaluate(() => {
        const rte = document.querySelector('.jobDetails .mizRteditor');
        const ul  = document.querySelector('.jobDetails ul.orange-squares');
        return {
          rteLen: rte ? (rte.textContent || '').trim().length : 0,
          ulLen: ul ? (ul.textContent || '').trim().length : 0,
          rteSample: rte ? (rte.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) : null,
        };
      });
      console.log(url.split('/').slice(-2, -1)[0], '->', JSON.stringify(r));
    } catch (e: any) {
      console.log(url.split('/').slice(-2, -1)[0], '-> ERR', e.message?.split('\n')[0]);
    } finally {
      await p.close();
    }
  }
  await b.close();
})();
