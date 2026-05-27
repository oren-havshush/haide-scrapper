import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

(async () => {
  const setupScript = fs.readFileSync(path.resolve('.scratch', 'setup-script.js'), 'utf8');
  const urls = [
    'https://www.unitask-inc.com/%d7%9e%d7%a4%d7%aa%d7%97-oracle-applications/',     // no JB heading expected
    'https://www.unitask-inc.com/%d7%91%d7%95%d7%93%d7%a7-%d7%aa-%d7%aa%d7%95%d7%9b%d7%a0%d7%94/',   // JB-2094 expected
    'https://www.unitask-inc.com/jb-1506/',  // reversed format "1506-JB" expected
    'https://www.unitask-inc.com/jb-1314/',  // normal JB-1314 expected
  ];
  const b = await chromium.launch({ headless: true });
  const p = await (await b.newContext({ locale: 'he-IL' })).newPage();

  for (const url of urls) {
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await p.evaluate(setupScript);
    const result = await p.evaluate(`(() => {
      const art = document.querySelector('article');
      if (!art) return { error: 'no article' };
      return {
        setupRan: art.querySelector('[data-setup-ran]') ? '1' : null,
        jobId: (art.querySelector('[data-extracted-jobid]') || {}).getAttribute ? art.querySelector('[data-extracted-jobid]').getAttribute('data-extracted-jobid') : null,
        location: (art.querySelector('[data-extracted-location]') || {}).getAttribute ? art.querySelector('[data-extracted-location]').getAttribute('data-extracted-location') : null,
        setupErr: (art.querySelector('[data-setup-err]') || {}).getAttribute ? art.querySelector('[data-setup-err]').getAttribute('data-setup-err') : null,
        descWrapLen: (function(){
          const w = art.querySelector('.elementor-widget-wrap');
          return w ? ((w.innerText || '').length) : 0;
        })()
      };
    })()`);
    console.log(url);
    console.log('  ->', JSON.stringify(result));
  }
  await b.close();
})();
