import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

(async () => {
  const url = process.argv[2];
  const setupScript = fs.readFileSync(path.resolve('.scratch', 'elbit-setup.js'), 'utf8');

  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    extraHTTPHeaders: { 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' },
  });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  console.log('--- Evaluating setupScript ---');
  const t0 = Date.now();
  await p.evaluate(setupScript);
  console.log(`setupScript completed in ${Date.now() - t0}ms`);

  // Now read job cards using the same selectors the worker would
  const itemSel = '.haide-job-card';
  const fields = {
    title:         { selector: '[data-haide-title]' },
    externalJobId: { selector: '[data-haide-jobcode]' },
    description:   { selector: '[data-haide-description]' },
    requirements:  { selector: '[data-haide-requirements]' },
    location:      { selector: '[data-haide-location]' },
    department:    { selector: '[data-haide-department]' },
    publishDate:   { selector: '[data-haide-publishdate]' },
  };

  const out = await p.evaluate((args) => {
    const items = document.querySelectorAll(args.itemSel);
    const samples: any[] = [];
    const fieldCounts: Record<string, number> = {};
    for (const f of Object.keys(args.fields)) fieldCounts[f] = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const rec: Record<string, string | null> = {};
      for (const [name, f] of Object.entries(args.fields as any)) {
        const el = it.querySelector((f as any).selector);
        const val = el ? (el.textContent || '').trim() : null;
        rec[name] = val;
        if (val) fieldCounts[name]++;
      }
      if (i < 5) samples.push(rec);
    }
    return { count: items.length, fieldCounts, samples };
  }, { itemSel, fields });

  console.log('itemCount:', out.count);
  console.log('field coverage:', JSON.stringify(out.fieldCounts, null, 2));
  console.log('--- first 5 samples ---');
  for (const s of out.samples) {
    console.log(JSON.stringify({
      title: (s.title || '').slice(0, 80),
      externalJobId: s.externalJobId,
      location: s.location,
      department: s.department,
      publishDate: s.publishDate,
      descriptionLen: (s.description || '').length,
      requirementsLen: (s.requirements || '').length,
      descriptionStart: (s.description || '').slice(0, 100),
    }));
  }

  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
