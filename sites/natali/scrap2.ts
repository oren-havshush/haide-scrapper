import { chromium } from 'playwright';
(async () => {
  const URL = 'https://www.natali.co.il/%d7%93%d7%a8%d7%95%d7%a9%d7%99%d7%9d/';
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', viewport: { width: 1440, height: 1800 } });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  const r = await p.evaluate(() => {
    const cols = Array.from(document.querySelectorAll('.elementor-col-33:has(a[title="להגשת מועמדות"])'));
    return cols.slice(0, 5).map(col => {
      const heading = col.querySelector('.elementor-heading-title');
      const headingWidget = heading?.closest('.elementor-widget-heading');
      const button = col.querySelector('a[title="להגשת מועמדות"]') as HTMLAnchorElement | null;
      const buttonWidget = button?.closest('.elementor-widget');
      // Check various unique identifiers
      return {
        colDataId: col.getAttribute('data-id'),
        colId: col.id,
        headingWidgetDataId: headingWidget?.getAttribute('data-id'),
        buttonWidgetDataId: buttonWidget?.getAttribute('data-id'),
        buttonText: (button?.textContent || '').trim(),
        title: (heading?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50),
        // Look at button's onclick or other data-* attrs
        buttonAttrs: button ? Array.from(button.attributes).map(a => `${a.name}=${a.value.slice(0, 80)}`) : [],
      };
    });
  });
  console.log(JSON.stringify(r, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
