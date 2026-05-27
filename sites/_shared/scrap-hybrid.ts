import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

// Single source of truth: read the same setupScript we'll PUT to prod.
const SETUP_SCRIPT = fs.readFileSync(path.resolve('.scratch', 'egged-setup.js'), 'utf8');

const _UNUSED_INLINE = `
(async () => {
  try {
    if (document.getElementById('haide-egged-injected')) return;
    const apiUrl = 'https://apb.egged.co.il/api/career/allHeadquartersJobs';
    const listResp = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify({ searchTerm: '', filters: [], requestPage: 0, pageSize: 200 }),
    });
    if (!listResp.ok) throw new Error('list api ' + listResp.status);
    const listData = await listResp.json();
    const jobs = (listData && listData.body && listData.body.items) ? listData.body.items : [];
    if (!jobs.length) throw new Error('no jobs returned by API');

    // Fetch detail HTML in parallel; cap concurrency to avoid hammering the origin.
    async function pMapBatched(arr, mapper, batchSize) {
      const out = new Array(arr.length);
      for (let i = 0; i < arr.length; i += batchSize) {
        const slice = arr.slice(i, i + batchSize);
        const r = await Promise.all(slice.map((x, j) => mapper(x, i + j)));
        for (let k = 0; k < r.length; k++) out[i + k] = r[k];
      }
      return out;
    }
    const detailHtmls = await pMapBatched(jobs, async (j) => {
      try {
        const r = await fetch('/career/headquarters/' + j.jobId, { credentials: 'omit' });
        if (!r.ok) return '';
        return await r.text();
      } catch (e) { return ''; }
    }, 8);

    const container = document.createElement('div');
    container.id = 'haide-egged-injected';
    container.style.display = 'none';

    const parser = new DOMParser();
    function addChild(parent, tag, cls, text) {
      const e = document.createElement(tag);
      e.className = cls;
      e.textContent = text || '';
      parent.appendChild(e);
      return e;
    }
    jobs.forEach((j, i) => {
      const html = detailHtmls[i] || '';
      let description = '', requirements = '';
      if (html) {
        try {
          const doc = parser.parseFromString(html, 'text/html');
          const blocks = doc.querySelectorAll('.muirtl-1ght444-SingleJob-StyledDescription');
          if (blocks.length >= 1) description = (blocks[0].textContent || '').trim();
          if (blocks.length >= 2) requirements = (blocks[1].textContent || '').trim();
          if (!description) {
            const wrapper = doc.querySelector('.muirtl-1gfy7g8-SingleJob-StyledTextContent');
            if (wrapper) description = (wrapper.textContent || '').trim();
          }
        } catch (e) {}
      }

      const row = document.createElement('div');
      row.className = 'haide-egged-job';
      addChild(row, 'span', 'haide-jobid',         String(j.jobId));
      addChild(row, 'h3',   'haide-title',         String(j.jobTitle || ''));
      addChild(row, 'span', 'haide-category',      String((j.categoryName || '').trim()));
      const a = addChild(row, 'a', 'haide-url',    'apply');
      a.setAttribute('href', 'https://www.egged.co.il/career/headquarters/' + j.jobId);
      addChild(row, 'div',  'haide-description',   description);
      addChild(row, 'div',  'haide-requirements',  requirements);
      container.appendChild(row);
    });

    document.body.appendChild(container);
  } catch (e) {
    console.error('haide egged setup failed:', e);
  }
})();
`;

(async () => {
  const url = process.argv[2];
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    extraHTTPHeaders: { 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' },
  });
  const p = await ctx.newPage();

  const t0 = Date.now();
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

  // Run setupScript via evaluate (mirrors what the worker does)
  const setupT0 = Date.now();
  await p.evaluate(SETUP_SCRIPT);
  const setupMs = Date.now() - setupT0;

  // Wait briefly for any final DOM settling
  await p.waitForTimeout(500);

  // Now run the field-mapping selectors on the synthesized DOM
  const ITEM_SEL = '.haide-egged-job';
  const fields = {
    title:         { selector: '.haide-title' },
    department:    { selector: '.haide-category' },
    externalJobId: { selector: '.haide-jobid' },
    detailUrl:     { selector: '.haide-url', attr: 'href' },
    description:   { selector: '.haide-description' },
    requirements:  { selector: '.haide-requirements' },
    skills:        { selector: '.haide-skills' },
  };

  const result = await p.evaluate((args) => {
    const items = document.querySelectorAll(args.itemSel);
    const samples: any[] = [];
    const emptyStats: Record<string, number> = {};
    for (const k of Object.keys(args.fields)) emptyStats[k] = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const rec: any = {};
      for (const [name, f] of Object.entries(args.fields as any)) {
        const el = it.querySelector((f as any).selector);
        if (!el) { rec[name] = null; emptyStats[name]++; continue; }
        const val = (f as any).attr ? el.getAttribute((f as any).attr) : (el.textContent || '').trim();
        rec[name] = val;
        if (!val) emptyStats[name]++;
      }
      if (i < 3 || i === items.length - 1) samples.push({ index: i, ...rec, descLen: (rec.description || '').length, reqsLen: (rec.requirements || '').length });
    }
    return { count: items.length, emptyStats, samples };
  }, { itemSel: ITEM_SEL, fields });

  const totalMs = Date.now() - t0;
  console.log(JSON.stringify({
    timing: { totalMs, setupScriptMs: setupMs },
    ...result,
  }, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
