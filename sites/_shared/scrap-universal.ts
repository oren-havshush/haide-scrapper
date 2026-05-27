import { chromium } from 'playwright';

(async () => {
  const urls = [
    // Elementor pages
    'https://www.unitask-inc.com/%d7%9e%d7%a4%d7%aa%d7%97-oracle-applications/',
    'https://www.unitask-inc.com/%d7%91%d7%95%d7%93%d7%a7-%d7%aa-%d7%aa%d7%95%d7%9b%d7%a0%d7%94/',
    'https://www.unitask-inc.com/jb-1314/',
    'https://www.unitask-inc.com/jb-1506/',
    // Non-Elementor page (the broken one)
    'https://www.unitask-inc.com/%d7%9e%d7%95%d7%91%d7%99%d7%9c-%d7%aa-%d7%a4%d7%a8%d7%95%d7%99%d7%a7%d7%98%d7%99%d7%9d-%d7%91%d7%aa%d7%97%d7%95%d7%9d-%d7%aa%d7%a9%d7%aa%d7%99%d7%95%d7%aa-it/',
  ];
  const b = await chromium.launch({ headless: true });
  const p = await (await b.newContext({ locale: 'he-IL' })).newPage();
  for (const url of urls) {
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    const r = await p.evaluate(`(() => {
      const entry = document.querySelector('article .entry-content');
      const h2s = Array.from(document.querySelectorAll('article h2')).map(function(h){return {cls: h.className.slice(0,60), text: (h.textContent || '').trim()};});
      const allHeadings = Array.from(document.querySelectorAll('article h1, article h2, article h3, article h4, article h5, article h6')).map(function(h){return {tag: h.tagName, cls: h.className.slice(0,40), text: (h.textContent || '').trim()};});
      return {
        entryLen: entry ? (entry.innerText || '').length : 0,
        entryPreview: entry ? ((entry.innerText || '').replace(/\\s+/g,' ').slice(0, 300)) : null,
        h2s: h2s,
        allHeadings: allHeadings,
      };
    })()`);
    console.log(url);
    console.log(JSON.stringify(r, null, 2));
    console.log('---');
  }
  await b.close();
})();
