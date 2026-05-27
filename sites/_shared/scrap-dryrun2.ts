import { chromium } from 'playwright';

const SETUP_SCRIPT = `
(function () {
  try {
    var items = document.querySelectorAll('.accordion_item');
    items.forEach(function (el) {
      // Strip <noscript> nodes inside the tag list so textContent stays clean.
      el.querySelectorAll('.career-tag-list noscript').forEach(function (n) { n.remove(); });

      var lis = el.querySelectorAll('.career-tag-list > li');
      if (lis.length >= 1 && !el.querySelector('[data-extracted-jobtype]')) {
        var s1 = document.createElement('span');
        s1.setAttribute('data-extracted-jobtype', '1');
        s1.style.display = 'none';
        s1.textContent = (lis[0].textContent || '').replace(/\\s+/g, ' ').trim();
        el.appendChild(s1);
      }
      if (lis.length >= 2 && !el.querySelector('[data-extracted-location]')) {
        var s2 = document.createElement('span');
        s2.setAttribute('data-extracted-location', '1');
        s2.style.display = 'none';
        s2.textContent = (lis[1].textContent || '').replace(/\\s+/g, ' ').trim();
        el.appendChild(s2);
      }
    });
  } catch (e) {}
})();
`;

(async () => {
  const url = process.argv[2];
  const b = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });
  const ctx = await b.newContext({
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
    extraHTTPHeaders: { 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' },
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(1500);

  await p.evaluate(SETUP_SCRIPT);

  const itemSel = '.accordion_item';
  const fields: Record<string, { selector: string; attr?: string }> = {
    title:           { selector: '.job_title' },
    location:        { selector: '[data-extracted-location]' },
    jobType:         { selector: '[data-extracted-jobtype]' },
    externalJobId:   { selector: '.send-resume', attr: 'data-job_id' },
    description:     { selector: '.accordion_content .content' },
    requirements:    { selector: '.accordion_content .drishot' },
    detailUrl:       { selector: '.copylink', attr: 'data-url' },
    applicationInfo: { selector: '.send-resume', attr: 'data-cv_send_email' },
  };

  const out = await p.evaluate((args) => {
    const items = document.querySelectorAll(args.itemSel);
    const samples: Record<string, string | null>[] = [];
    const sampleIdx = [0, 1, 2, Math.min(5, items.length - 1), items.length - 1];
    let allTitlesNonEmpty = true;
    for (let i = 0; i < items.length; i++) {
      const t = items[i].querySelector('.job_title');
      if (!t || !(t.textContent || '').trim()) { allTitlesNonEmpty = false; break; }
    }
    for (const i of sampleIdx) {
      if (i < 0 || i >= items.length) continue;
      const it = items[i];
      const rec: Record<string, string | null> = { _index: String(i) };
      for (const [name, f] of Object.entries(args.fields as any)) {
        const el = it.querySelector((f as any).selector);
        if (!el) { rec[name] = null; continue; }
        rec[name] = (f as any).attr
          ? el.getAttribute((f as any).attr)
          : (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      }
      samples.push(rec);
    }
    return { count: items.length, allTitlesNonEmpty, samples };
  }, { itemSel, fields });

  console.log(JSON.stringify(out, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
