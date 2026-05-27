import { chromium } from 'playwright';

(async () => {
  const parentUrl = 'https://www.ikea.com/il/he/this-is-ikea/work-with-us/jobs-pub70183d80/';
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' },
  });
  const p = await ctx.newPage();

  console.log('1. Loading parent page...');
  await p.goto(parentUrl, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(4000);

  let iframe = p.frames().find(f => f.url().includes('webapp-local/work-with-us'));
  if (!iframe) { console.log('NO IFRAME'); await b.close(); return; }
  console.log('   iframe URL:', iframe.url());

  const iframeBodyLen = await iframe.evaluate(() => document.body.innerHTML.length);
  const iframeTitle = await iframe.evaluate(() => document.title);
  console.log('   iframe title:', iframeTitle, 'body length:', iframeBodyLen);

  // Look for the multi-select wrappers / search button inside the iframe
  const formProbe = await iframe.evaluate(() => {
    const storeSelect = document.querySelector('#search-store-options');
    const fieldSelect = document.querySelector('#search-professionalfield-options');
    const storeButton = document.querySelector('#search-store-button');
    const fieldButton = document.querySelector('#search-professionalfield-button');
    const selectAllButtons = Array.from(document.querySelectorAll('button.select-all')).map(b => ({ text: (b.textContent || '').trim() }));
    const searchButton = document.querySelector('button[name="search-button"]');
    return {
      storeOptions: storeSelect?.querySelectorAll('li[role="option"]').length || 0,
      fieldOptions: fieldSelect?.querySelectorAll('li[role="option"]').length || 0,
      hasStoreButton: !!storeButton,
      hasFieldButton: !!fieldButton,
      selectAllButtonCount: selectAllButtons.length,
      hasSearchButton: !!searchButton,
    };
  });
  console.log('   form probe:', JSON.stringify(formProbe));

  if (!formProbe.hasSearchButton) {
    console.log('FORM NOT PRESENT - iframe is showing 404 or different content. Aborting.');
    await b.close();
    return;
  }

  console.log('2. Expanding store filter and clicking Select All...');
  await iframe.click('#search-store-button');
  await iframe.waitForTimeout(800);
  await iframe.click('#search-store-collapse button.select-all');
  await iframe.waitForTimeout(400);

  console.log('3. Expanding professional field filter and clicking Select All...');
  await iframe.click('#search-professionalfield-button');
  await iframe.waitForTimeout(800);
  await iframe.click('#search-professionalfield-collapse button.select-all');
  await iframe.waitForTimeout(400);

  console.log('4. Clicking search button (will submit and navigate iframe)...');
  await Promise.all([
    p.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {}),
    iframe.click('button[name="search-button"]'),
  ]);
  await p.waitForTimeout(3000);

  iframe = p.frames().find(f => f.url().includes('webapp-local/work-with-us'));
  if (!iframe) { console.log('iframe gone after submit'); await b.close(); return; }
  console.log('   iframe URL after submit:', iframe.url());

  const result = await iframe.evaluate(() => ({
    title: document.title,
    jobCount: document.querySelectorAll('.job-wrapper').length,
    firstTitle: (document.querySelector('.job-wrapper .card-title h2')?.textContent || '').trim().slice(0, 80),
    firstHref: document.querySelector('.job-wrapper a')?.getAttribute('href') || null,
  }));
  console.log('   result:', JSON.stringify(result, null, 2));

  await b.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
