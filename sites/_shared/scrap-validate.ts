import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

(async () => {
  const setupScript = fs.readFileSync(path.resolve('.scratch', 'setup-script.js'), 'utf8');

  const detailUrls = [
    'https://www.unitask-inc.com/%d7%9e%d7%a4%d7%aa%d7%97-oracle-applications/',
    'https://www.unitask-inc.com/jb-1314/',
    'https://www.unitask-inc.com/%d7%9e%d7%a4%d7%aa%d7%97-%d7%aa-oracle-applications/',
  ];
  const listingUrl = 'https://www.unitask-inc.com/career/jobs-2/';

  const b = await chromium.launch({ headless: true });
  const p = await (await b.newContext({ locale: 'he-IL' })).newPage();

  // Listing test
  await p.goto(listingUrl, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await p.evaluate(setupScript);

  const listing = await p.evaluate(`(() => {
    const arts = Array.from(document.querySelectorAll('article.elementor-post'));
    return arts.slice(0, 10).map(function(a){
      const link = a.querySelector('a.elementor-post__read-more');
      const href = link ? link.getAttribute('href') : null;
      const title = (a.querySelector('h3.elementor-post__title') || {}).textContent || '';
      const idMarker = a.querySelector('[data-extracted-jobid]');
      const jobId = idMarker ? idMarker.getAttribute('data-extracted-jobid') : null;
      return { title: title.trim().slice(0,60), href: href, jobId: jobId };
    });
  })()`);
  console.log('\n=== LISTING (first 10 items with extracted job IDs) ===');
  console.log(JSON.stringify(listing, null, 2));

  // Detail tests
  for (const url of detailUrls) {
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    const out = await p.evaluate(`(() => {
      const wrap = document.querySelector('article .elementor-widget-wrap');
      const wrapText = wrap ? (wrap.innerText || '').replace(/\\s+/g, ' ').trim() : null;
      const wrapLen = wrapText ? wrapText.length : 0;
      const title = document.querySelector('h1') ? document.querySelector('h1').textContent : null;
      return { title: title ? title.trim().slice(0,80) : null, wrapLen: wrapLen, wrapPreview: wrapText ? wrapText.slice(0, 800) : null };
    })()`);
    console.log(`\n=== DETAIL: ${url} ===`);
    console.log(JSON.stringify(out, null, 2));
  }

  await b.close();
})();
