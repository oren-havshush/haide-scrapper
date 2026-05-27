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
  await p.goto(parentUrl, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(4000);

  const iframe = p.frames().find(f => f.url().includes('webapp-local/work-with-us'));
  if (!iframe) {
    console.log('NO IFRAME');
    await b.close();
    return;
  }
  console.log('iframe URL:', iframe.url());
  const info = await iframe.evaluate(() => {
    const allButtons = Array.from(document.querySelectorAll('button')).map(b => ({ name: b.name, text: (b.textContent || '').trim(), type: b.type }));
    const forms = Array.from(document.querySelectorAll('form')).map(f => ({ action: f.action, method: f.method, id: f.id }));
    return {
      title: document.title,
      bodyLength: document.body?.innerHTML.length,
      jobWrapperCount: document.querySelectorAll('.job-wrapper').length,
      forms,
      buttons: allButtons,
      h1Text: (document.querySelector('h1')?.textContent || '').trim(),
      h2Texts: Array.from(document.querySelectorAll('h2')).slice(0, 5).map(h => (h.textContent || '').trim()),
    };
  });
  console.log(JSON.stringify(info, null, 2));

  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
