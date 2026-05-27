import { chromium } from 'playwright';

(async () => {
  const url = process.argv[2];
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    extraHTTPHeaders: { 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' },
  });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(2000);

  const ITEM_SEL = '.muirtl-nbpp0o-JobItem-StyeldJobItem';
  const initialCount = await p.evaluate((sel) => document.querySelectorAll(sel).length, ITEM_SEL);

  // Find the "משרות נוספות" button info
  const buttonInfo = await p.evaluate(() => {
    const all = Array.from(document.querySelectorAll('button, a'));
    const candidates = all
      .filter((el) => /משרות נוספות|נוספות|נוספים/.test(((el as HTMLElement).innerText || '').trim()))
      .map((el) => ({
        tag: el.tagName,
        text: ((el as HTMLElement).innerText || '').trim(),
        className: (el as HTMLElement).className,
        outerHtml: (el as HTMLElement).outerHTML.slice(0, 400),
      }));
    return candidates;
  });

  // Click the button repeatedly until count stops growing or it disappears
  const history: { iter: number; count: number; clicked: boolean }[] = [
    { iter: 0, count: initialCount, clicked: false },
  ];
  let prev = initialCount;
  for (let i = 1; i <= 15; i++) {
    const clicked = await p.evaluate(() => {
      const all = Array.from(document.querySelectorAll('button, a'));
      const target = all.find((el) => /משרות נוספות|נוספות|נוספים/.test(((el as HTMLElement).innerText || '').trim()));
      if (!target) return false;
      // Scroll into view first
      (target as HTMLElement).scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'center' });
      (target as HTMLElement).click();
      return true;
    });
    await p.waitForTimeout(2000);
    const count = await p.evaluate((sel) => document.querySelectorAll(sel).length, ITEM_SEL);
    history.push({ iter: i, count, clicked });
    if (!clicked) break;
    if (count === prev) break;
    prev = count;
  }

  // Also check via universal selector "any button text content"
  const finalCount = await p.evaluate((sel) => document.querySelectorAll(sel).length, ITEM_SEL);

  // Snapshot the page text totals after loading
  const totalsMatch = await p.evaluate(() => {
    const bodyText = document.body.innerText || '';
    const re = /\d+\s*משרות/g;
    return Array.from(bodyText.matchAll(re)).map((m) => m[0]);
  });

  console.log(JSON.stringify({
    initialCount,
    finalCount,
    history,
    buttonInfo,
    totalsAfterLoad: totalsMatch,
  }, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
