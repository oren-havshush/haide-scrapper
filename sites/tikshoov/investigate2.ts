import { chromium } from 'playwright';
import * as fs from 'fs';

const URL = 'https://www.tikshoov.co.il/come-work-with-us/careers-list/?areaID=&jobType=';
const DETAIL = 'https://www.tikshoov.co.il/come-work-with-us/careers-list/?jobID=5108&jobType=';

(async () => {
  const b = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      '--lang=he-IL',
    ],
  });
  const ctx = await b.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    extraHTTPHeaders: { 'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' },
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'languages', { get: () => ['he-IL', 'he', 'en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  });

  const p = await ctx.newPage();

  // Test listing
  console.log('=== LISTING (worker UA) ===');
  const resp = await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log('listing http status:', resp?.status());
  await p.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await p.waitForTimeout(2000);
  const listingHtml = await p.content();
  fs.writeFileSync('/tmp/scrap-tikshoov-listing-workerUA.html', listingHtml);

  const listingProbe = await p.evaluate(() => ({
    title: document.title,
    bodyTextFirst200: (document.body?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
    jobBoxWrapperCount: document.querySelectorAll('.jobBox-wrapper').length,
    resultsViewPresent: !!document.querySelector('#ResultsView'),
    titleCount: document.querySelectorAll('h3.job-title').length,
    hasIncapsulaChallenge: /incapsula|imperva|challenge|just a moment/i.test(document.documentElement.outerHTML),
    htmlBytes: document.documentElement.outerHTML.length,
    firstThreeItems: Array.from(document.querySelectorAll('.jobBox-wrapper')).slice(0, 3).map((el) => {
      const a = el.querySelector('a');
      const t = el.querySelector('h3.job-title');
      const jid = el.querySelector('textarea#jobID');
      return {
        firstAHref: a?.getAttribute('href') || null,
        firstATag: a?.tagName,
        title: (t?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
        jobID: jid?.textContent?.trim() || null,
      };
    }),
  }));
  console.log(JSON.stringify(listingProbe, null, 2));

  // Test detail page
  console.log('\n=== DETAIL (worker UA) ===');
  const dresp = await p.goto(DETAIL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log('detail http status:', dresp?.status());
  await p.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await p.waitForTimeout(2000);
  const detailHtml = await p.content();
  fs.writeFileSync('/tmp/scrap-tikshoov-detail-workerUA.html', detailHtml);

  const detailProbe = await p.evaluate(() => {
    const out: any = {};
    out.title = document.title;
    out.htmlBytes = document.documentElement.outerHTML.length;

    const sel = (s: string) => {
      const el = document.querySelector(s);
      if (!el) return null;
      return (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    };
    out.title_h3 = sel('h3.job-title');
    out.location_field = sel('.vacancy-location .field-value');
    out.description_p = sel('.vacancy-text p');
    out.jobID_textarea = sel('textarea#jobID');

    // Look for any "vacancy" / job-detail-like containers
    const vacEls = Array.from(document.querySelectorAll('[class*="vacancy"]'));
    out.vacancyClasses = [...new Set(vacEls.slice(0, 30).map((e) => (e as HTMLElement).className))];

    out.hasIncapsulaChallenge = /incapsula|imperva|challenge|just a moment/i.test(document.documentElement.outerHTML);
    return out;
  });
  console.log(JSON.stringify(detailProbe, null, 2));

  await b.close();
})().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
