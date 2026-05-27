import { chromium } from 'playwright';
(async () => {
  const URL = process.argv[2];
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', viewport: { width: 1440, height: 1800 } });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  const r = await p.evaluate(() => ({
    jobToggle: document.querySelectorAll('.jobsApplication_toggle').length,
    swiperSlide: document.querySelectorAll('.jobsApplication .swiper-slide').length,
    jobsList: document.querySelectorAll('.jobsApplication').length,
  }));
  console.log(JSON.stringify(r, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
