import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

(async () => {
  const url = process.argv[2] || 'https://www.unitask-inc.com/jb-1314/';
  const setupScript = fs.readFileSync(path.resolve('.scratch', 'stored-setupScript.js'), 'utf-8');

  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL' });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

  await p.evaluate(setupScript);

  const result = await p.evaluate(() => {
    const el = document.querySelector('[data-extracted-location]');
    return {
      hasSpan: !!el,
      spanText: el ? el.textContent : null,
      pInPage: document.querySelectorAll('.elementor-widget-text-editor p').length,
      strongTexts: Array.from(document.querySelectorAll('.elementor-widget-text-editor p strong')).map(s => s.textContent),
    };
  });
  console.log(JSON.stringify(result, null, 2));
  await b.close();
})();
