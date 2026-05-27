import { chromium } from 'playwright';

(async () => {
  const parentUrl = 'https://www.ikea.com/il/he/this-is-ikea/work-with-us/jobs-pub70183d80/';
  const iframeUrl = 'https://www.ikea.com/il/he/webapp-local/work-with-us/';
  const searchResultsUrl = 'https://www.ikea.com/il/he/webapp-local/work-with-us/job/search-results?Search%5Bstore%5D=&Search%5BprofessionalField%5D=&search-button=';

  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' },
  });
  const p = await ctx.newPage();

  console.log('--- Step 1: Load parent IKEA page (which has the iframe) ---');
  const r1 = await p.goto(parentUrl, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await p.waitForTimeout(2000);
  console.log(JSON.stringify({ status: r1?.status(), finalUrl: p.url(), title: await p.title() }, null, 2));

  // The iframe should now be loaded inside the parent. Check it.
  const frameInfo = p.frames().map(f => ({ url: f.url(), name: f.name() }));
  console.log('frames after parent load:', JSON.stringify(frameInfo, null, 2));

  // Now, from this same context (with cookies set), try fetching the search-results URL directly.
  console.log('--- Step 2: Navigate same page to search-results ---');
  const r2 = await p.goto(searchResultsUrl, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await p.waitForTimeout(1500);
  const count2 = await p.evaluate(() => document.querySelectorAll('.job-wrapper').length);
  console.log(JSON.stringify({ status: r2?.status(), finalUrl: p.url(), title: await p.title(), jobCount: count2 }, null, 2));

  // Try Step 3: switch focus to the iframe inside the parent page.
  console.log('--- Step 3: Reload parent and click search button INSIDE iframe ---');
  await p.goto(parentUrl, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await p.waitForTimeout(3000);
  const iframeFrame = p.frames().find(f => f.url().includes('webapp-local/work-with-us'));
  if (!iframeFrame) {
    console.log('iframe NOT FOUND');
  } else {
    console.log('iframe URL:', iframeFrame.url());
    // Try clicking search button inside iframe
    try {
      await iframeFrame.waitForSelector('button[name="search-button"]', { timeout: 10000 });
      await iframeFrame.click('button[name="search-button"]');
      await p.waitForTimeout(5000);
      // After click, the iframe should have new URL with search-results
      const iframeAfter = p.frames().find(f => f.url().includes('webapp-local/work-with-us'));
      console.log('iframe after click URL:', iframeAfter?.url());
      const count3 = iframeAfter ? await iframeAfter.evaluate(() => document.querySelectorAll('.job-wrapper').length) : 0;
      console.log('jobCount in iframe after click:', count3);
    } catch (e: any) {
      console.log('click step error:', e.message);
    }
  }

  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
