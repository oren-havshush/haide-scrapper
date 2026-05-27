import { chromium } from 'playwright';

(async () => {
  const url = process.argv[2];
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

  const urlBefore = p.url();
  console.log('URL before:', urlBefore);

  const before = await p.evaluate(() => {
    const item = document.querySelector('.job.filterItem');
    return {
      hasJobDetails: !!item?.querySelector('.jobDetails'),
      childTags: item ? Array.from(item.children).map(c => `${c.tagName}.${c.className}`) : [],
    };
  });
  console.log('Before click:', JSON.stringify(before, null, 2));

  await p.locator('.job.filterItem a.toggler').first().click();

  await p.waitForTimeout(2000);

  const urlAfter = p.url();
  console.log('URL after:', urlAfter);

  const after = await p.evaluate(() => {
    const item = document.querySelector('.job.filterItem');
    const details = item?.querySelector('.jobDetails');
    const rte = details?.querySelector('.mizRteditor');
    return {
      hasJobDetails: !!details,
      detailsClass: details?.className || null,
      detailsHTMLLength: details ? (details as HTMLElement).innerHTML.length : 0,
      rteText: rte ? (rte.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200) : null,
      childTags: item ? Array.from(item.children).map(c => `${c.tagName}.${c.className}`) : [],
    };
  });
  console.log('After click:', JSON.stringify(after, null, 2));

  await b.close();
})();
