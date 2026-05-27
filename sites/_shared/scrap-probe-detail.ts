import { chromium } from 'playwright';

(async () => {
  const url = process.argv[2];
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

  const out = await p.evaluate(() => {
    const det = document.querySelector('.jobDetails');
    const rte = document.querySelector('.jobDetails .mizRteditor');
    const ul  = document.querySelector('.jobDetails ul.orange-squares');
    const h1  = document.querySelector('h1');
    const allRte = document.querySelectorAll('.mizRteditor');
    return {
      hasJobDetails: !!det,
      hasRte: !!rte,
      rteHTMLLength: rte ? (rte as HTMLElement).innerHTML.length : 0,
      rteText: rte ? (rte.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 400) : null,
      hasReqUL: !!ul,
      ulText: ul ? (ul.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 400) : null,
      h1Text: h1 ? (h1.textContent || '').trim().slice(0, 120) : null,
      rteCount: allRte.length,
      bodyClasses: document.body.className,
    };
  });
  console.log(JSON.stringify(out, null, 2));
  await b.close();
})();
