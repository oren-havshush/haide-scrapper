import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const p = await ctx.newPage();
  await p.goto('https://www.ness-tech.co.il/careers/', { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});

  const data = await p.evaluate(async () => {
    const r = await fetch('/careers/api/Careers/GetAllItems', { headers: { 'accept': 'application/json' } });
    return { status: r.status, body: await r.text() };
  });

  console.log('status:', data.status);
  console.log('body length:', data.body.length);

  let parsed = null;
  try { parsed = JSON.parse(data.body); } catch (e) { console.log('not JSON:', e.message); }

  if (parsed) {
    console.log('top-level type:', Array.isArray(parsed) ? `array len=${parsed.length}` : `object keys=${Object.keys(parsed).join(',')}`);
    const list = Array.isArray(parsed) ? parsed : (parsed.data || parsed.items || parsed.orders || parsed.result || []);
    console.log('list length:', list.length);
    if (list.length > 0) {
      console.log('\nfirst entry keys:', Object.keys(list[0]).join(', '));
      console.log('\nfirst 3 entries:');
      for (const it of list.slice(0, 3)) {
        console.log(JSON.stringify(it, null, 2).slice(0, 600));
        console.log('---');
      }
    }
  }

  fs.writeFileSync(path.join(os.tmpdir(), 'ness-getallitems.json'), data.body);
  console.log('\nfull body saved to:', path.join(os.tmpdir(), 'ness-getallitems.json'));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
