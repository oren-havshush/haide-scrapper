import { chromium } from 'playwright';

const SETUP_SCRIPT = `
(function () {
  try {
    if (document.getElementById('haide-jobs')) return;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', 'https://d-api.bezeq.co.il/api/Adam/GetActiveJobs', false);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.send();
    if (xhr.status !== 200) return;
    var json = JSON.parse(xhr.responseText);
    var jobs = (json && json.data) ? json.data : [];
    if (!jobs.length) return;
    var container = document.createElement('div');
    container.id = 'haide-jobs';
    container.style.display = 'none';
    function add(parent, tag, name, value, attrs) {
      var el = document.createElement(tag);
      el.setAttribute('data-field', name);
      if (attrs) {
        for (var k in attrs) el.setAttribute(k, attrs[k]);
      }
      el.textContent = value == null ? '' : String(value);
      parent.appendChild(el);
    }
    jobs.forEach(function (j) {
      var item = document.createElement('div');
      item.className = 'haide-job';
      add(item, 'span', 'externalJobId', j.order_id);
      add(item, 'span', 'title', j.description || j.tat_profession_name || j.perot_tafked || '');
      add(item, 'span', 'description', j.notes_text || '');
      add(item, 'span', 'location', j.Order_place || j.work_area || j.living_area1 || '');
      add(item, 'span', 'department', j.profession_name || '');
      add(item, 'span', 'publishDate', j.updateDate_ddmmyyyy || '');
      add(item, 'span', 'applicationInfo', j.order_email || j.email_rakaz || '');
      add(item, 'span', 'subProfession', j.tat_profession_name || '');
      add(item, 'span', 'workArea', j.work_area || '');
      add(item, 'span', 'clientName', j.client_name || '');
      add(item, 'span', 'deadlineDate', j.deadline_date || '');
      add(item, 'span', 'manningType', j.manning_type_text || '');
      add(item, 'span', 'recruiter', j.rakaz || '');
      var detailUrl = 'https://www.bezeq.co.il/career/jobs/form/?jobs=' + encodeURIComponent(j.order_id);
      add(item, 'a', 'detailUrl', detailUrl, { href: detailUrl });
      container.appendChild(item);
    });
    document.body.appendChild(container);
  } catch (e) {
    /* swallow */
  }
})();
`;

(async () => {
  const url = process.argv[2];
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
    extraHTTPHeaders: {
      'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await p.waitForTimeout(1500);

  // Run setup script
  await p.evaluate(SETUP_SCRIPT);

  // Wait briefly for any rendering
  await p.waitForTimeout(500);

  const itemSel = '.haide-job';
  const fields: Record<string, { selector: string; attr?: string }> = {
    title:           { selector: '[data-field="title"]' },
    externalJobId:   { selector: '[data-field="externalJobId"]' },
    description:     { selector: '[data-field="description"]' },
    location:        { selector: '[data-field="location"]' },
    department:      { selector: '[data-field="department"]' },
    publishDate:     { selector: '[data-field="publishDate"]' },
    detailUrl:       { selector: 'a[data-field="detailUrl"]', attr: 'href' },
    applicationInfo: { selector: '[data-field="applicationInfo"]' },
    subProfession:   { selector: '[data-field="subProfession"]' },
    workArea:        { selector: '[data-field="workArea"]' },
    clientName:      { selector: '[data-field="clientName"]' },
    deadlineDate:    { selector: '[data-field="deadlineDate"]' },
    manningType:     { selector: '[data-field="manningType"]' },
    recruiter:       { selector: '[data-field="recruiter"]' },
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
        const raw = (f as any).attr ? el.getAttribute((f as any).attr) : (el.textContent || '');
        rec[name] = raw == null ? null : raw.replace(/\s+/g, ' ').trim().slice(0, 100);
      }
      samples.push(rec);
    }
    return { count: items.length, samples };
  }, { itemSel, fields });

  console.log(JSON.stringify(out, null, 2));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
