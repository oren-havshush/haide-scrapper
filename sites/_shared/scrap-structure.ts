import { chromium } from 'playwright';

(async () => {
  const b = await chromium.launch({ headless: true });
  const p = await (await b.newContext({ locale: 'he-IL' })).newPage();
  const url = process.argv[2] || 'https://www.unitask-inc.com/%d7%9e%d7%a4%d7%aa%d7%97-oracle-applications/';
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

  const info = await p.evaluate(`(() => {
    const editors = Array.from(document.querySelectorAll('article .elementor-widget-text-editor'));
    const first = editors[0];
    if (!first) return { error: 'no editors' };
    const parent = first.parentElement;
    const parentSiblings = parent ? Array.from(parent.children).map(function(c){return {
      tag: c.tagName.toLowerCase(),
      cls: (c.className || '').slice(0, 80),
      widgetType: c.getAttribute('data-widget_type') || '',
      textPreview: ((c.innerText || c.textContent || '')).replace(/\\s+/g, ' ').slice(0, 80),
    };}) : [];
    const entryContent = document.querySelector('article .entry-content');
    const colWrap = document.querySelector('article .elementor-column .elementor-widget-wrap');
    const col = colWrap ? Array.from(colWrap.children).map(function(c){return {
      tag: c.tagName.toLowerCase(),
      cls: (c.className||'').slice(0,80),
      widgetType: c.getAttribute('data-widget_type') || '',
      textPreview: ((c.innerText || c.textContent || '')).replace(/\\s+/g, ' ').slice(0, 60),
    };}) : null;
    return {
      parentClass: parent ? parent.className : null,
      parentTag: parent ? parent.tagName.toLowerCase() : null,
      parentSiblings,
      column: col,
      entryContentText: entryContent ? (entryContent.innerText || '').replace(/\\s+/g, ' ').slice(0, 600) : null,
    };
  })()`);
  console.log(JSON.stringify(info, null, 2));
  await b.close();
})();
