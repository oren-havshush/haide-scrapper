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
  await p.goto(url, { waitUntil: 'domcontentloaded' });

  const counts: Record<string, number> = {};
  for (let i = 0; i < 8; i++) {
    counts['t' + i] = await p.evaluate(() => document.querySelectorAll('.jobBox-wrapper').length);
    await p.waitForTimeout(500);
  }
  await p.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  const final = await p.evaluate(() => document.querySelectorAll('.jobBox-wrapper').length);

  const peek = await p.evaluate(() => {
    const first = document.querySelector('.jobBox-wrapper');
    if (!first) return null;
    const t = first.querySelector('h3.job-title');
    const id = first.querySelector('textarea');
    const a = first.querySelector('a');
    return {
      titleText: (t?.textContent || '').slice(0, 80),
      idText: (id?.textContent || '').slice(0, 20),
      hrefAttr: a?.getAttribute('href') || null,
    };
  });

  console.log(JSON.stringify({ counts, final, peek }, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
