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
  await p.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await p.waitForTimeout(2000);

  const info = await p.evaluate(() => {
    const all = document.querySelectorAll('.job-wrapper');
    const visible = Array.from(all).filter(el => (el as HTMLElement).style.display !== 'none');
    const hidden = Array.from(all).filter(el => (el as HTMLElement).style.display === 'none');
    const pager = document.querySelector('.pager');
    const pagerLinks = pager ? Array.from(pager.querySelectorAll('a,li')).map(a => ({
      tag: a.tagName, text: (a.textContent || '').trim().slice(0, 40), href: (a as HTMLAnchorElement).href || null, cls: a.className,
    })) : [];
    return {
      total: all.length,
      visible: visible.length,
      hidden: hidden.length,
      pagerHTML: pager ? (pager as HTMLElement).outerHTML.slice(0, 2000) : null,
      pagerLinks,
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
