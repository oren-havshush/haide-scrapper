import { chromium } from 'playwright';

const SETUP_SCRIPT = `
(function () {
  return (async function () {
    try {
      var resp = await fetch('/api/job-positions/get-jobs', { credentials: 'same-origin' });
      if (!resp.ok) return -2;
      var data = await resp.json();
      var positions = (data && data.positions) || [];
      // The page renders into an .accordion (#jobsAccordion). Find it; if absent, create a container.
      var container = document.querySelector('#jobsAccordion') ||
                      document.querySelector('[class*="JobsAccordion_itemsContainer"]') ||
                      document.querySelector('.accordion');
      if (!container) {
        container = document.createElement('div');
        container.id = 'jobsAccordion';
        document.body.appendChild(container);
      }
      // Clear existing accordion-items
      container.querySelectorAll('.accordion-item').forEach(function (el) { el.remove(); });

      positions.forEach(function (j) {
        var areas = [j.living_area1, j.living_area2, j.living_area3, j.living_area4, j.living_area5, j.living_area6]
          .filter(function (a) { return a && String(a).trim(); }).join(', ');
        var dept = j.client_name || j.name_snif || j.client_parent_name || '';
        var jobId = j.order_id != null ? String(j.order_id) : '';
        var item = document.createElement('div');
        item.className = 'accordion-item';
        item.innerHTML =
          '<span data-extracted-title style="display:none"></span>' +
          '<span data-extracted-location style="display:none"></span>' +
          '<span data-extracted-profession style="display:none"></span>' +
          '<span data-extracted-department style="display:none"></span>' +
          '<span data-extracted-jobid style="display:none"></span>' +
          '<span data-extracted-pubdate style="display:none"></span>' +
          '<a data-extracted-detailurl style="display:none"></a>' +
          '<div data-extracted-description style="display:none"></div>';
        item.querySelector('[data-extracted-title]').textContent = j.description || '';
        item.querySelector('[data-extracted-location]').textContent = areas || (j.work_area || '');
        item.querySelector('[data-extracted-profession]').textContent = j.profession_name || j.category_name || '';
        item.querySelector('[data-extracted-department]').textContent = dept;
        item.querySelector('[data-extracted-jobid]').textContent = jobId;
        item.querySelector('[data-extracted-pubdate]').textContent = j.orderDate_ddmmyyyy || j.start_advertising_date || '';
        var a = item.querySelector('[data-extracted-detailurl]');
        a.setAttribute('href', jobId ? ('/jobs/search/position/' + jobId) : '');
        item.querySelector('[data-extracted-description]').textContent = j.notes_text || j.notes || '';
        container.appendChild(item);
      });
    } catch (e) { return -1; }
    return document.querySelectorAll('.accordion-item [data-extracted-jobid]').length;
  })();
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
  await p.waitForSelector('.accordion-item', { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(1500);

  const before = await p.evaluate(() => document.querySelectorAll('.accordion-item').length);
  console.log('before setupScript:', before);

  const t0 = Date.now();
  const count = await p.evaluate(SETUP_SCRIPT);
  console.log('setupScript ->', count, 'in', Date.now() - t0, 'ms');

  // Run the actual field-mapping dry-run against the injected items
  const itemSel = '.accordion-item';
  const fields: Record<string, { selector: string; attr?: string }> = {
    title:         { selector: '[data-extracted-title]' },
    location:      { selector: '[data-extracted-location]' },
    profession:    { selector: '[data-extracted-profession]' },
    department:    { selector: '[data-extracted-department]' },
    externalJobId: { selector: '[data-extracted-jobid]' },
    publishDate:   { selector: '[data-extracted-pubdate]' },
    detailUrl:     { selector: '[data-extracted-detailurl]', attr: 'href' },
    description:   { selector: '[data-extracted-description]' },
  };

  const out = await p.evaluate((args) => {
    const items = document.querySelectorAll(args.itemSel);
    const samples: any[] = [];
    const indices = [0, 1, 50, 100, 150, items.length - 1];
    for (const i of indices) {
      if (i < 0 || i >= items.length) continue;
      const it = items[i];
      const rec: any = { _i: i };
      for (const [name, f] of Object.entries(args.fields)) {
        const el = it.querySelector((f as any).selector);
        if (!el) { rec[name] = null; continue; }
        rec[name] = (f as any).attr ? el.getAttribute((f as any).attr) : ((el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120));
      }
      samples.push(rec);
    }
    let allTitlesNonEmpty = true;
    let allJobIdsNonEmpty = true;
    for (let i = 0; i < items.length; i++) {
      const t = items[i].querySelector('[data-extracted-title]');
      const id = items[i].querySelector('[data-extracted-jobid]');
      if (!t || !(t.textContent || '').trim()) allTitlesNonEmpty = false;
      if (!id || !(id.textContent || '').trim()) allJobIdsNonEmpty = false;
    }
    return { count: items.length, allTitlesNonEmpty, allJobIdsNonEmpty, samples };
  }, { itemSel, fields });

  console.log(JSON.stringify(out, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
