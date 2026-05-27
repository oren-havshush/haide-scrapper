import { chromium } from 'playwright';

const URL = 'https://www.ness-tech.co.il/careers/';

(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await p.waitForSelector('.card-job-container', { timeout: 15000 });
  await p.waitForTimeout(1500);

  const out = await p.evaluate(() => {
    const cards = document.querySelectorAll('.card-job-container');
    const total = cards.length;
    const samples = [];
    for (let i = 0; i < Math.min(3, cards.length); i++) {
      const c = cards[i];
      samples.push({
        idx: i,
        outerHTML_first_2500: c.outerHTML.slice(0, 2500),
        text: (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 400),
      });
    }
    const tagCounts = {};
    cards[0]?.querySelectorAll('*').forEach(el => {
      const k = el.tagName + (el.className ? '.' + (typeof el.className === 'string' ? el.className.split(/\s+/).slice(0, 3).join('.') : '') : '');
      tagCounts[k] = (tagCounts[k] || 0) + 1;
    });
    return { total, samples, firstCardTagCounts: tagCounts };
  });

  console.log(JSON.stringify(out, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
