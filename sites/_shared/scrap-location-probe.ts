import { chromium } from 'playwright';

(async () => {
  const urls = [
    'https://www.unitask-inc.com/%d7%9e%d7%a4%d7%aa%d7%97-oracle-applications/',
    'https://www.unitask-inc.com/%d7%91%d7%95%d7%93%d7%a7-%d7%aa-%d7%aa%d7%95%d7%9b%d7%a0%d7%94/',
    'https://www.unitask-inc.com/jb-1314/',
  ];
  const b = await chromium.launch({ headless: true });
  const p = await (await b.newContext({ locale: 'he-IL' })).newPage();
  for (const url of urls) {
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    const r = await p.evaluate(`(() => {
      const tries = {
        'p:has(strong)': 'article p:has(strong)',
        'p_has_strong_first': 'article p:has(strong):first-of-type',
        // last text-editor widget (location is typically last)
        'last_textedit_p': 'article .elementor-widget-text-editor:last-of-type p',
        // nth-of-type with class
        'nth_textedit_3': 'article .elementor-widget-wrap > :nth-child(3 of .elementor-widget-text-editor) p',
      };
      const out = {};
      Object.keys(tries).forEach(function(k){
        try {
          const els = Array.from(document.querySelectorAll(tries[k]));
          out[k] = { count: els.length, texts: els.map(function(e){return (e.textContent || '').replace(/\\s+/g,' ').trim();}) };
        } catch (e) { out[k] = { error: String(e).slice(0, 100) }; }
      });
      return out;
    })()`);
    console.log(url);
    console.log(JSON.stringify(r, null, 2));
  }
  await b.close();
})();
