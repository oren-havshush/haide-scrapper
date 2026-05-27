import { chromium } from 'playwright';

(async () => {
  const url = 'https://www.ikea.com/il/he/webapp-local/work-with-us/job/job-details?id=1832';
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    extraHTTPHeaders: { 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' },
  });
  const p = await ctx.newPage();

  // Fresh navigation, no prior context
  const resp = await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await p.waitForTimeout(1500);

  const title = await p.title();
  const finalUrl = p.url();
  const status = resp?.status();
  const bodyLen = (await p.content()).length;
  const hasYii2 = await p.evaluate(() => !!document.querySelector('article.job-details .card-body'));
  const has404 = await p.evaluate(() => !!document.querySelector('.hnf-typography-heading-l'));
  const cardBodyText = await p.evaluate(() => {
    const el = document.querySelector('article.job-details .card-body');
    return el ? (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200) : null;
  });
  console.log(JSON.stringify({ status, finalUrl, title, bodyLen, hasYii2, has404, cardBodyText }, null, 2));

  // Now try as if a referer-less worker visit, but with realistic UA
  await p.context().clearCookies();
  const url2 = 'https://www.ikea.com/il/he/webapp-local/work-with-us/job/job-details/?id=1180';
  const resp2 = await p.goto(url2, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1500);
  const cardBodyText2 = await p.evaluate(() => {
    const el = document.querySelector('article.job-details .card-body');
    return el ? (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200) : null;
  });
  console.log(JSON.stringify({
    pass: 2, status: resp2?.status(), finalUrl: p.url(), bodyLen: (await p.content()).length, cardBodyText: cardBodyText2,
  }, null, 2));

  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
