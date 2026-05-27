import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

(async () => {
  const urls: Array<[string, string]> = [
    ['hebrew', 'https://www.unitask-inc.com/%d7%9e%d7%a4%d7%aa%d7%97-oracle-applications/'],
    ['jb',     'https://www.unitask-inc.com/jb-1314/'],
  ];
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL' });
  const p = await ctx.newPage();

  for (const [label, url] of urls) {
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    const html = await p.content();
    fs.writeFileSync(path.resolve('.scratch', `unitask-detail-${label}.html`), html);

    const info = await p.evaluate(() => {
      const sections = Array.from(document.querySelectorAll('article .elementor > section'));
      const widgets = Array.from(document.querySelectorAll('article .elementor-widget-text-editor'));
      const widgetTexts = widgets.map((w, i) => ({
        idx: i,
        cls: (w.getAttribute('data-id') || '') + ' ' + ((w as HTMLElement).className).split(' ').filter(c => c.startsWith('elementor-widget-')).join(' '),
        text: ((w as HTMLElement).innerText || (w.textContent || '')).replace(/\s+/g, ' ').trim().slice(0, 300),
      }));
      const allElements = Array.from(document.querySelectorAll('article .elementor-element[data-element_type="widget"]')).map((e, i) => ({
        idx: i,
        widgetType: e.getAttribute('data-widget_type'),
        text: ((e as HTMLElement).innerText || (e.textContent || '')).replace(/\s+/g, ' ').trim().slice(0, 200),
      }));

      // Sections breakdown
      const sectionInfo = sections.map((s, i) => ({
        idx: i,
        cls: s.className.slice(0, 100),
        textLen: ((s as HTMLElement).innerText || '').length,
        text: ((s as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200),
      }));

      // Article-level entry
      const article = document.querySelector('article');
      const articleClass = article ? article.className : '';

      return {
        articleClass,
        sectionCount: sections.length,
        widgetTexts,
        allElements,
        sectionInfo,
      };
    });

    console.log(`\n========== ${label.toUpperCase()} (${url}) ==========`);
    console.log(JSON.stringify(info, null, 2));
  }
  await b.close();
})();
