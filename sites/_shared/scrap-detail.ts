import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

(async () => {
  const url = process.argv[2];
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    extraHTTPHeaders: { 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' },
  });
  const p = await ctx.newPage();

  // Watch for any per-job detail API
  const xhrs: { url: string; method: string; status?: number; bodyPreview?: string }[] = [];
  p.on('response', async (res) => {
    const req = res.request();
    const t = req.resourceType();
    if (t === 'xhr' || t === 'fetch') {
      const u = res.url();
      const item: any = { url: u, method: req.method(), status: res.status() };
      if (/egged\.co\.il/.test(u) && /api|job|career|position/i.test(u)) {
        try { item.bodyPreview = (await res.text()).slice(0, 2000); } catch {}
      }
      xhrs.push(item);
    }
  });

  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(2500);

  const html = await p.content();
  fs.writeFileSync(path.resolve('.scratch', 'egged-detail.html'), html, 'utf8');

  // Capture the main visible text of the body
  const visible = await p.evaluate(() => {
    const main = document.querySelector('main') || document.body;
    return {
      title: document.title,
      mainText: (main as HTMLElement).innerText.slice(0, 4000),
      h1: Array.from(document.querySelectorAll('h1')).map(e => (e as HTMLElement).innerText.trim()),
      h2: Array.from(document.querySelectorAll('h2')).map(e => (e as HTMLElement).innerText.trim()).slice(0, 20),
      h3: Array.from(document.querySelectorAll('h3')).map(e => (e as HTMLElement).innerText.trim()).slice(0, 20),
    };
  });

  console.log(JSON.stringify({
    visible,
    htmlBytes: html.length,
    apiCallsToEgged: xhrs.filter(x => /egged\.co\.il/.test(x.url) && /api|job|career|position/i.test(x.url)),
  }, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
