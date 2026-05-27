import { chromium } from 'playwright';

(async () => {
  const url = 'https://www.unitask-inc.com/career/jobs-2/';
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL' });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

  const allTitles: string[] = [];
  for (let pg = 1; pg <= 5; pg++) {
    await p.waitForSelector('article.elementor-post', { timeout: 10000 }).catch(() => {});
    const titles: string[] = await p.evaluate(() =>
      Array.from(document.querySelectorAll('article.elementor-post h3.elementor-post__title')).map(
        (t) => (t.textContent || '').replace(/\s+/g, ' ').trim()
      )
    );
    console.log(`page ${pg}: ${titles.length} jobs, first="${titles[0]}"`);
    allTitles.push(...titles);

    const hasNext = await p.evaluate(() => !!document.querySelector('span.page-numbers.current + a.page-numbers'));
    if (!hasNext) {
      console.log('no next link; stopping');
      break;
    }
    await Promise.all([
      p.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
      p.click('span.page-numbers.current + a.page-numbers'),
    ]);
    await p.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
  }

  console.log(`total titles across pages: ${allTitles.length}`);
  console.log(`unique titles: ${new Set(allTitles).size}`);
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
