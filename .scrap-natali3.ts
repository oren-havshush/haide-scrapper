import { chromium } from 'playwright';
(async () => {
  const URL = 'https://www.natali.co.il/%d7%93%d7%a8%d7%95%d7%a9%d7%99%d7%9d/';
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', viewport: { width: 1440, height: 1800 } });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  // Click first apply button to see if popup loads with id-encoded data
  const buttons = await p.$$('a[title="להגשת מועמדות"]');
  if (buttons.length > 0) {
    await buttons[0].click();
    await p.waitForTimeout(3000);
    await p.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  }
  const r = await p.evaluate(() => {
    const popups = Array.from(document.querySelectorAll('[id^="elementor-popup-modal-"]')).map(el => ({
      id: el.id,
      visible: (el as HTMLElement).offsetParent !== null,
      textLen: (el.textContent || '').length,
      textSnippet: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
    }));
    return { popupCount: popups.length, popups };
  });
  console.log(JSON.stringify(r, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
