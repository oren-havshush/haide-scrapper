import { chromium } from 'playwright';

(async () => {
  const url = 'https://www.unitask-inc.com/%d7%9e%d7%95%d7%91%d7%99%d7%9c-%d7%aa-%d7%a4%d7%a8%d7%95%d7%99%d7%a7%d7%98%d7%99%d7%9d-%d7%91%d7%aa%d7%97%d7%95%d7%9d-%d7%aa%d7%a9%d7%aa%d7%99%d7%95%d7%aa-it/';
  const b = await chromium.launch({ headless: true });
  const p = await (await b.newContext({ locale: 'he-IL' })).newPage();
  console.log('Navigating:', url);
  const resp = await p.goto(url, { waitUntil: 'domcontentloaded' });
  console.log('Final URL:', p.url());
  console.log('Status:', resp?.status());
  await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

  const info = await p.evaluate(`(() => {
    const article = document.querySelector('article');
    // Walk children of article to see structure
    const children = article ? Array.from(article.children).map(function(c){return {tag: c.tagName.toLowerCase(), cls: (c.className||'').slice(0,120)};}) : [];
    // Try alternative selectors
    const tries = {
      '.entry-content': document.querySelector('article .entry-content'),
      '.elementor': document.querySelector('article .elementor'),
      '.elementor-widget-wrap': document.querySelector('article .elementor-widget-wrap'),
      'article > div': document.querySelector('article > div'),
      'article > div > div': document.querySelector('article > div > div'),
    };
    const out = {};
    Object.keys(tries).forEach(function(k){
      const el = tries[k];
      out[k] = { found: !!el, len: el ? (el.innerText || '').length : 0, preview: el ? ((el.innerText || '').slice(0, 200)) : null };
    });
    return {
      articleChildren: children,
      selectorTries: out,
      headings: Array.from(article ? article.querySelectorAll('h1, h2, h3, h4') : []).map(function(h){return { tag: h.tagName, cls: h.className.slice(0, 80), text: (h.textContent || '').trim() };}),
    };
  })()`);
  console.log(JSON.stringify(info, null, 2));
  await b.close();
})();
