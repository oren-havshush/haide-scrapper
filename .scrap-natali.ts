import { chromium } from 'playwright';
(async () => {
  const URL = 'https://www.natali.co.il/%d7%93%d7%a8%d7%95%d7%a9%d7%99%d7%9d/';
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', viewport: { width: 1440, height: 1800 } });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  const r = await p.evaluate(() => {
    // Find all the apply buttons and decode the popup id
    const buttons = Array.from(document.querySelectorAll('a[title="להגשת מועמדות"]')) as HTMLAnchorElement[];
    const result: any[] = [];
    for (const a of buttons.slice(0, 3)) {
      const href = a.getAttribute('href') || '';
      const settingsMatch = href.match(/settings%3D([^&]+)/);
      let popupId: string | null = null;
      if (settingsMatch) {
        const decoded = decodeURIComponent(settingsMatch[1]);
        try {
          const parsed = JSON.parse(atob(decoded));
          popupId = parsed.id;
        } catch {}
      }
      // Look up corresponding popup in DOM
      const popup = popupId ? document.getElementById(`elementor-popup-modal-${popupId}`) : null;
      result.push({
        popupId,
        popupExists: !!popup,
        popupTextLen: popup ? (popup.textContent || '').length : 0,
        popupTextSnippet: popup ? (popup.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200) : '',
      });
    }
    // Also find all popups present
    const allPopups = Array.from(document.querySelectorAll('[id^="elementor-popup-modal-"]')).map(el => el.id);
    return { result, popupCount: allPopups.length, popupIds: allPopups.slice(0, 15) };
  });
  console.log(JSON.stringify(r, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
