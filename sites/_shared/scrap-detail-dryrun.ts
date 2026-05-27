import { chromium } from 'playwright';

(async () => {
  const urls = [
    'https://www.rapyd.net/company/careers/positions/ai-productivity-implementation-specialist-tel-aviv-israel/',
    'https://www.rapyd.net/company/careers/positions/customer-delivery-manager-tel-aviv-israel/',
    'https://www.rapyd.net/company/careers/positions/it-support-team-lead-tel-aviv-israel/',
  ];
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    locale: 'en-US',
    timezoneId: 'Asia/Jerusalem',
    extraHTTPHeaders: { 'accept-language': 'en-US,en;q=0.9' },
  });

  const fields: Record<string, { selector: string; attr?: string }> = {
    title:         { selector: 'h1' },
    description:   { selector: '.single-career-position__main .job-details:nth-of-type(1)' },
    requirements:  { selector: '.single-career-position__main .job-details:nth-of-type(2)' },
    publishDate:   { selector: 'meta[property="article:published_time"]', attr: 'content' },
  };

  const all: any[] = [];
  for (const url of urls) {
    const p = await ctx.newPage();
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await p.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
    await p.waitForTimeout(1500);

    const rec = await p.evaluate((args) => {
      const out: Record<string, string | null> = {};
      for (const [name, f] of Object.entries(args.fields as any)) {
        const el = document.querySelector((f as any).selector);
        if (!el) { out[name] = null; continue; }
        out[name] = (f as any).attr ? el.getAttribute((f as any).attr) : (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      }
      return out;
    }, { fields });
    all.push({ url, ...rec });
    await p.close();
  }
  console.log(JSON.stringify(all, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
