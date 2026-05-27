import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

(async () => {
  const url = 'https://elbitsystemscareer.com/jobs/';
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    extraHTTPHeaders: { 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' },
  });
  const p = await ctx.newPage();

  const allReqs: { url: string; method: string; rt: string; status?: number; ct?: string; bodySize?: number; isHebrew?: boolean }[] = [];
  p.on('response', async (resp) => {
    const u = resp.url();
    const ct = resp.headers()['content-type'] || '';
    let bodySize = 0;
    let isHebrew = false;
    try {
      const buf = await resp.body();
      bodySize = buf.length;
      const txt = buf.toString('utf8');
      // Look for Hebrew chars near our known city-ID
      if (/\u05D0-\u05EA/.test(txt) && /992|רחובות/.test(txt)) {
        isHebrew = true;
      }
    } catch {}
    allReqs.push({ url: u, method: resp.request().method(), rt: resp.request().resourceType(), status: resp.status(), ct, bodySize, isHebrew });
  });

  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForSelector('.MuiCard-root', { timeout: 25000 });
  await p.waitForTimeout(5000);

  // Now open the city/location filter dropdown — that might trigger a city-list fetch
  try {
    const filterButton = await p.$('text=/חיפוש לפי מיקום|מיקום|location/i');
    if (filterButton) {
      console.log('clicking filter ...');
      await filterButton.click().catch(() => {});
      await p.waitForTimeout(3000);
    }
  } catch {}

  // Read the city name shown on the first card
  const firstCardText = await p.evaluate(() => {
    const c = document.querySelector('.MuiCard-root');
    return c ? (c as HTMLElement).innerText : null;
  });
  console.log('first card text:', firstCardText);

  // Try to probe niloo with alternative commands
  const probes = ['get-cities', 'get-locations', 'get-meta', 'get-config', 'get-areas', 'cities', 'meta', 'locations'];
  for (const cmd of probes) {
    const result = await p.evaluate(async (cmd) => {
      try {
        const r = await fetch('https://niloo-server.herokuapp.com/actions-elbit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cmd }),
        });
        const txt = await r.text();
        return { status: r.status, len: txt.length, head: txt.slice(0, 300) };
      } catch (e: any) {
        return { error: String(e?.message || e) };
      }
    }, cmd);
    console.log(`probe ${cmd}:`, JSON.stringify(result));
  }

  console.log('--- all responses with status 2xx + content-type json or that contain Hebrew+992 ---');
  const interesting = allReqs.filter((r) => {
    if ((r.status || 0) >= 400) return false;
    if (r.isHebrew) return true;
    if (/json/i.test(r.ct || '')) return true;
    return false;
  });
  for (const r of interesting) {
    console.log(`  ${r.method} ${r.status} bodyBytes=${r.bodySize} hebrew=${r.isHebrew} ct=${r.ct} url=${r.url.slice(0, 200)}`);
  }

  fs.writeFileSync(path.resolve('.scratch', 'probe-cities-allreqs.json'), JSON.stringify(allReqs, null, 2));
  console.log(`(full request log dumped to .scratch/probe-cities-allreqs.json — ${allReqs.length} entries)`);

  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
