import { chromium } from 'playwright';

const URL = 'https://www.ness-tech.co.il/careers/';

(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const p = await ctx.newPage();

  const allReqs = [];
  p.on('request', (req) => {
    const u = req.url();
    if (!u.includes('ness-tech')) return;
    allReqs.push({ method: req.method(), url: u, resourceType: req.resourceType() });
  });

  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await p.waitForSelector('.card-job-container', { timeout: 15000 });
  // Wait extra time for any post-hydration XHRs
  await p.waitForTimeout(5000);

  console.log('=== All XHR/fetch requests to ness-tech.co.il ===');
  const interesting = allReqs.filter(r => r.resourceType === 'xhr' || r.resourceType === 'fetch' || r.url.includes('/api/'));
  console.log(JSON.stringify(interesting, null, 2));

  console.log('\n=== Script URLs (JS bundles) ===');
  const scripts = allReqs.filter(r => r.resourceType === 'script');
  scripts.forEach(s => console.log(' ', s.url));

  // Try a click on a filter/search button to see if that triggers a listing API
  console.log('\n=== Looking for filterable elements on page ===');
  const filters = await p.evaluate(() => {
    return {
      buttons: Array.from(document.querySelectorAll('button')).slice(0, 20).map(b => ({ text: (b.textContent||'').replace(/\s+/g,' ').trim().slice(0, 60), aria: b.getAttribute('aria-label') })),
      inputs: Array.from(document.querySelectorAll('input')).slice(0, 10).map(i => ({ type: i.type, name: i.name, placeholder: i.placeholder, aria: i.getAttribute('aria-label') })),
      selects: Array.from(document.querySelectorAll('select, mat-select, [role="combobox"]')).slice(0, 10).map(s => ({ tag: s.tagName, text: (s.textContent||'').replace(/\s+/g,' ').trim().slice(0, 80) })),
    };
  });
  console.log(JSON.stringify(filters, null, 2));

  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
