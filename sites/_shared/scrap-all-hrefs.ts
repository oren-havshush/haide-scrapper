import { chromium } from 'playwright';

(async () => {
  const b = await chromium.launch({ headless: true });
  const p = await (await b.newContext({ locale: 'he-IL' })).newPage();
  await p.goto('https://www.unitask-inc.com/career/jobs-2/', { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

  // Click through pages to collect all hrefs
  let pageNum = 1;
  const allHrefs: string[] = [];
  while (true) {
    const hrefs = await p.evaluate(`Array.from(document.querySelectorAll('article.elementor-post a.elementor-post__read-more')).map(function(a){return a.getAttribute('href');})`) as string[];
    allHrefs.push(...hrefs);
    const next = await p.$('span.page-numbers.current + a.page-numbers');
    if (!next || pageNum >= 5) break;
    await next.click();
    await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));
    pageNum++;
  }

  const jbUrls = allHrefs.filter(h => /\/jb-\d+\/?$/i.test(h || ''));
  const hebrewUrls = allHrefs.filter(h => !/\/jb-\d+\/?$/i.test(h || ''));
  console.log(JSON.stringify({
    pagesVisited: pageNum,
    total: allHrefs.length,
    jbUrlCount: jbUrls.length,
    hebrewUrlCount: hebrewUrls.length,
    jbSample: jbUrls.slice(0, 5),
    hebrewSample: hebrewUrls.slice(0, 3),
  }, null, 2));

  await b.close();
})();
