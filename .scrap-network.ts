import { chromium } from 'playwright';
(async () => {
  const URL = process.argv[2];
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', viewport: { width: 1440, height: 1800 } });
  const p = await ctx.newPage();
  const requests: any[] = [];
  p.on('response', async (r) => {
    const u = r.url();
    if (/ajax|api|admin-ajax|wp-json|jobs/i.test(u) && r.request().method() !== 'OPTIONS') {
      let bodyPreview = '';
      try {
        const ct = r.headers()['content-type'] || '';
        if (/json|html|text/.test(ct)) {
          const t = await r.text();
          bodyPreview = t.slice(0, 200);
        }
      } catch {}
      requests.push({ url: u, method: r.request().method(), status: r.status(), bodyPreview });
    }
  });
  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(8000);
  console.log(JSON.stringify(requests, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
