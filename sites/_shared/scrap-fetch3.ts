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

  const reqs: { url: string; method: string; rt: string }[] = [];
  p.on('request', (req) => {
    reqs.push({ url: req.url(), method: req.method(), rt: req.resourceType() });
  });
  const consoleMsgs: string[] = [];
  p.on('console', (m) => consoleMsgs.push(`[${m.type()}] ${m.text()}`));
  p.on('pageerror', (e) => consoleMsgs.push(`[pageerror] ${e.message}`));

  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(6000);
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await p.waitForTimeout(3000);

  const html = await p.content();
  const outPath = path.resolve('.scratch', 'scrap-page3.html');
  fs.writeFileSync(outPath, html);

  // Filter requests: skip static asset noise but keep XHRs, fetches, JSON, and "everything else"
  const interesting = reqs.filter((r) => {
    if (/google|facebook|gtag|doubleclick|nagishli|googletagmanager/i.test(r.url)) return false;
    if (r.rt === 'image' || r.rt === 'font' || r.rt === 'stylesheet') return false;
    return true;
  });

  // Dump first 100 chars of each non-asset request
  const reqSummary = interesting.map((r) => ({ rt: r.rt, method: r.method, url: r.url.slice(0, 200) }));

  console.log(JSON.stringify({
    htmlBytes: html.length,
    requestCount: reqs.length,
    interestingCount: interesting.length,
    interesting: reqSummary,
    consoleMsgs: consoleMsgs.slice(0, 50),
  }, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
