import { chromium } from 'playwright';

(async () => {
  const url = process.argv[2];
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

  const itemSel = 'nav.accordion ul > li';
  const fields: Record<string, { selector: string; attr?: string }> = {
    title:           { selector: '.s_title h4' },
    description:     { selector: '.s_content .fluid_70' },
    applicationInfo: { selector: 'iframe.sendfile', attr: 'src' },
    externalJobId:   { selector: 'iframe.sendfile', attr: 'src' },
  };

  const out = await p.evaluate((args) => {
    const items = document.querySelectorAll(args.itemSel);
    const samples: Record<string, string | null>[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const rec: Record<string, string | null> = {};
      for (const [name, f] of Object.entries(args.fields as any)) {
        const sel = (f as any).selector;
        const attr = (f as any).attr;
        const el = it.querySelector(sel);
        if (!el) { rec[name] = null; continue; }
        rec[name] = attr ? el.getAttribute(attr) : (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100);
      }
      samples.push(rec);
    }
    return { count: items.length, samples };
  }, { itemSel, fields });

  console.log(JSON.stringify(out, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
