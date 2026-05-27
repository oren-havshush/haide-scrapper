import { chromium } from 'playwright';

(async () => {
  const urls = [
    'https://www.unitask-inc.com/%d7%9e%d7%a4%d7%aa%d7%97-oracle-applications/',     // no JB
    'https://www.unitask-inc.com/%d7%91%d7%95%d7%93%d7%a7-%d7%aa-%d7%aa%d7%95%d7%9b%d7%a0%d7%94/',  // JB-2094
    'https://www.unitask-inc.com/jb-1314/',
    'https://www.unitask-inc.com/jb-1506/',
  ];
  const b = await chromium.launch({ headless: true });
  const p = await (await b.newContext({ locale: 'he-IL' })).newPage();
  for (const url of urls) {
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    const info = await p.evaluate(`(() => {
      const selectors = [
        'article h1.elementor-heading-title',
        'article h2.elementor-heading-title',
        'article h3.elementor-heading-title',
        'article h4.elementor-heading-title',
        'article .elementor-widget-heading h1, article .elementor-widget-heading h2, article .elementor-widget-heading h3, article .elementor-widget-heading h4',
      ];
      const out = {};
      selectors.forEach(function(sel){
        const els = Array.from(document.querySelectorAll(sel));
        out[sel] = els.map(function(e){return (e.textContent || '').replace(/\\s+/g,' ').trim();});
      });
      // also: count of location <p><strong>
      const locParas = Array.from(document.querySelectorAll('article p')).filter(function(p){
        const s = p.querySelector('strong');
        return s && /\\u05de\\u05d9\\u05e7\\u05d5\\u05dd\\s*\\u05d2\\u05d9?\\u05d0\\u05d5\\u05d2\\u05e8\\u05e4\\u05d9/.test(s.textContent || '');
      });
      out['locationParaCount'] = locParas.length;
      out['locationParaText'] = locParas.map(function(p){return (p.textContent || '').replace(/\\s+/g,' ').trim();});
      return out;
    })()`);
    console.log(url);
    console.log(JSON.stringify(info, null, 2));
  }
  await b.close();
})();
