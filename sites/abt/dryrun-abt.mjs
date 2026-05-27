import { chromium } from 'playwright';

const URL = process.argv[2];

(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

  const itemSel = '.p-team-content .p-team-item';
  const fields = {
    title:          { selector: '.p-team-item-name' },
    department:     { selector: '.p-team-item-role' },
    description:    { selector: '.p-team-item-desc' },
    applicationInfo:{ selector: '.p-team-item-mail' },
    externalJobId:  { selector: '.p-team-item-name' },
    contactEmail:   { selector: '.p-team-item-mail a', attr: 'href' },
  };

  const out = await p.evaluate((args) => {
    const items = document.querySelectorAll(args.itemSel);
    const samples = [];
    for (let i = 0; i < Math.min(5, items.length); i++) {
      const it = items[i];
      const rec = {};
      for (const [name, f] of Object.entries(args.fields)) {
        const el = it.querySelector(f.selector);
        if (!el) { rec[name] = null; continue; }
        rec[name] = f.attr ? el.getAttribute(f.attr) : (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      }
      samples.push(rec);
    }
    return { count: items.length, samples };
  }, { itemSel, fields });

  console.log(JSON.stringify(out, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
