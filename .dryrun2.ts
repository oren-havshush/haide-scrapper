import { chromium } from 'playwright';
type FieldMap = Record<string, { selector: string; attr?: string }>;
async function dryRun(opts: { url: string; itemSel?: string; listingFields?: FieldMap; waitForSelector?: string }) {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    locale: 'he-IL', timezoneId: 'Asia/Jerusalem',
    viewport: { width: 1440, height: 1800 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const p = await ctx.newPage();
  await p.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (opts.waitForSelector) {
    await p.waitForSelector(opts.waitForSelector, { timeout: 20000 }).catch(() => {});
  }
  await p.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(1500);
  if (opts.itemSel && opts.listingFields) {
    const listing = await p.evaluate((args) => {
      const items = document.querySelectorAll(args.itemSel);
      const samples: any[] = [];
      for (let i = 0; i < Math.min(5, items.length); i++) {
        const it = items[i];
        const rec: Record<string, string | null> = {};
        for (const [name, f] of Object.entries(args.fields as any)) {
          const sel = (f as any).selector;
          const el = it.querySelector(sel);
          if (!el) { rec[name] = null; continue; }
          rec[name] = (f as any).attr ? el.getAttribute((f as any).attr) : (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100);
        }
        samples.push(rec);
      }
      return { count: items.length, samples };
    }, { itemSel: opts.itemSel, fields: opts.listingFields });
    console.log('LISTING:', JSON.stringify(listing, null, 2));
  }
  await b.close();
}
const opts = JSON.parse(process.argv[2]);
dryRun(opts).catch(e => { console.error(e); process.exit(1); });
