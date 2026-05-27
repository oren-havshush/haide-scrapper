import { chromium } from 'playwright';

(async () => {
  const url = process.argv[2];
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    extraHTTPHeaders: { 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' },
  });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

  // Mirror the setupScript that will be saved in the site config.
  const setupScript = `(function () {
  try {
    var items = document.querySelectorAll('[class*="Jobs_JobContainer__"]');
    items.forEach(function (it) {
      var share = it.querySelector('a[class*="Jobs_ShareOnWhatsapp__"]');
      var href = share && share.getAttribute('href');
      if (!href) return;
      var m = href.match(/yekev\\.co\\.il\\/job\\/(\\d+)/);
      if (!m) return;
      var jobId = m[1];
      var detailUrl = 'https://yekev.co.il/job/' + jobId;
      if (!it.querySelector('[data-extracted-job-id]')) {
        var s1 = document.createElement('span');
        s1.setAttribute('data-extracted-job-id', '1');
        s1.style.display = 'none';
        s1.textContent = jobId;
        it.appendChild(s1);
      }
      if (!it.querySelector('[data-extracted-detail-url]')) {
        var s2 = document.createElement('span');
        s2.setAttribute('data-extracted-detail-url', '1');
        s2.style.display = 'none';
        s2.textContent = detailUrl;
        it.appendChild(s2);
      }
    });
  } catch (e) {}
})();`;

  await p.evaluate(setupScript);

  const itemSel = '[class*="Jobs_JobContainer__"]';
  const fields: Record<string, { selector: string; attr?: string }> = {
    title:           { selector: '[class*="Jobs_Title__"] h1' },
    description:     { selector: '[class*="Jobs_Description__"] [class*="Jobs_BodyText__"]' },
    requirements:    { selector: '[class*="Jobs_Requirements__"] [class*="Jobs_BodyText__"]' },
    externalJobId:   { selector: '[data-extracted-job-id]' },
    detailUrl:       { selector: '[data-extracted-detail-url]' },
    applicationInfo: { selector: 'a[class*="Jobs_ShareOnWhatsapp__"]', attr: 'href' },
  };

  const out = await p.evaluate((args) => {
    const items = document.querySelectorAll(args.itemSel);
    const samples: Record<string, string | null>[] = [];
    for (let i = 0; i < Math.min(3, items.length); i++) {
      const it = items[i];
      const rec: Record<string, string | null> = {};
      for (const [name, f] of Object.entries(args.fields as any)) {
        const el = it.querySelector((f as any).selector);
        if (!el) { rec[name] = null; continue; }
        rec[name] = (f as any).attr
          ? el.getAttribute((f as any).attr)
          : (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      }
      samples.push(rec);
    }
    return { count: items.length, samples };
  }, { itemSel, fields });

  console.log(JSON.stringify(out, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
