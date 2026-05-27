import { chromium } from 'playwright';
import * as fs from 'fs';

(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const p = await ctx.newPage();
  await p.goto('https://www.bezeq.co.il/career_new/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

  // Fetch jobs API from page context (same-origin policy will use bezeq.co.il as referer; CORS proven to work since the page itself does this)
  const result = await p.evaluate(async () => {
    try {
      const r = await fetch('https://d-api.bezeq.co.il/api/Adam/GetActiveJobs', {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      const ct = r.headers.get('content-type') || '';
      const text = await r.text();
      let json: any = null;
      try { json = JSON.parse(text); } catch {}
      const len = Array.isArray(json) ? json.length : (json?.length ?? json?.data?.length ?? null);
      const sampleKeys = (Array.isArray(json) && json[0]) ? Object.keys(json[0]) : (json?.data?.[0] ? Object.keys(json.data[0]) : []);
      const sample = (Array.isArray(json) && json[0]) ? json[0] : (json?.data?.[0] || null);
      return { status: r.status, ct, textLen: text.length, jobCount: len, sampleKeys, sample, head: text.slice(0, 600) };
    } catch (e: any) { return { error: String(e?.message || e) }; }
  });
  console.log('API STATUS:', result.status, 'CT:', result.ct, 'TEXT-LEN:', result.textLen);
  console.log('JOB COUNT:', result.jobCount);
  console.log('SAMPLE KEYS:', result.sampleKeys);
  console.log('\nFIRST JOB:');
  console.log(JSON.stringify(result.sample, null, 2));
  fs.writeFileSync('.scratch/bezeq-jobs-api-head.json', result.head);

  // Also probe Areas + Professions
  const areas = await p.evaluate(async () => {
    const r = await fetch('https://d-api.bezeq.co.il/api/Adam/ActiveAreas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    return { status: r.status, body: (await r.text()).slice(0, 500) };
  });
  console.log('\nAreas POST status:', areas.status, 'body head:', areas.body);

  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
