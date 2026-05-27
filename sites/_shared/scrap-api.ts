import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

(async () => {
  const url = process.argv[2];
  const apiUrl = 'https://apb.egged.co.il/api/career/allHeadquartersJobs';
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    extraHTTPHeaders: { 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' },
  });
  const p = await ctx.newPage();

  let req: any = null;
  let resp: any = null;

  p.on('request', (r) => {
    if (r.url() === apiUrl) {
      req = {
        method: r.method(),
        postData: r.postData(),
        headers: r.headers(),
      };
    }
  });
  p.on('response', async (res) => {
    if (res.url() === apiUrl) {
      try {
        const text = await res.text();
        try { resp = JSON.parse(text); }
        catch { resp = { _raw: text.slice(0, 5000) }; }
      } catch (e) {
        resp = { _error: String(e) };
      }
    }
  });

  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // Hard cap on networkidle wait — page has long-running trackers
  await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  // Specifically wait for the API response
  const start = Date.now();
  while (!resp && Date.now() - start < 15000) {
    await p.waitForTimeout(500);
  }

  // Save full response for inspection
  if (resp) {
    fs.writeFileSync(path.resolve('.scratch', 'egged-api-resp.json'), JSON.stringify(resp, null, 2), 'utf8');
  }

  // Build a compact summary
  let summary: any;
  if (resp == null) {
    summary = { error: 'No response captured' };
  } else if (Array.isArray(resp)) {
    summary = { isArray: true, length: resp.length, sample0: resp[0], sample1: resp[1], keysOfSample0: resp[0] ? Object.keys(resp[0]) : [] };
  } else if (typeof resp === 'object') {
    const keys = Object.keys(resp);
    summary = { keys, sample: {} };
    for (const k of keys) {
      const v = resp[k];
      if (Array.isArray(v)) {
        summary.sample[k] = { array: true, length: v.length, sample0: v[0], keysOfSample0: v[0] ? Object.keys(v[0]) : [] };
      } else {
        summary.sample[k] = { type: typeof v, value: typeof v === 'string' ? v.slice(0, 200) : v };
      }
    }
  }

  console.log(JSON.stringify({ request: req, responseSummary: summary }, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
