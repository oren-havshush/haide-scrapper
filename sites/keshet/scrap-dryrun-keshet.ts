import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

(async () => {
  const setupScript = fs.readFileSync(path.resolve('.scratch', 'setup-script-keshet.js'), 'utf8');
  const listingUrl = 'https://jobs.keshet-mediagroup.com/';
  const itemSel = '.job-container';
  const fields = {
    title:         { selector: '.job-title' },
    externalJobId: { selector: '[data-extracted-jobid]', attr: 'data-extracted-jobid' },
    detailUrl:     { selector: '[data-extracted-detailurl]', attr: 'href' },
    publishDate:   { selector: '.job-subtitle span:last-child' },
  } as Record<string, { selector: string; attr?: string }>;

  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const p = await ctx.newPage();
  await p.goto(listingUrl, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await p.waitForTimeout(2000);
  await p.evaluate(setupScript);

  const argsJson = JSON.stringify({ itemSel, fields });
  const listing = await p.evaluate(`(() => {
    const args = ${argsJson};
    const items = document.querySelectorAll(args.itemSel);
    const samples = [];
    for (let i = 0; i < Math.min(5, items.length); i++) {
      const it = items[i];
      const rec = {};
      for (const k of Object.keys(args.fields)) {
        const f = args.fields[k];
        const el = it.querySelector(f.selector);
        if (!el) { rec[k] = null; continue; }
        rec[k] = f.attr ? el.getAttribute(f.attr) : (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
      }
      samples.push(rec);
    }
    return { count: items.length, samples };
  })()`);
  console.log('=== LISTING ===');
  console.log(JSON.stringify(listing, null, 2));

  // Detail-page dry-run on one job
  const sampleDetail = (listing as any).samples[0].detailUrl;
  console.log(`\n=== DETAIL: ${sampleDetail} ===`);
  await p.goto(sampleDetail, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await p.waitForTimeout(2000);
  const detail = await p.evaluate(`(() => {
    const d = document.querySelector('#pos-description');
    const r = document.querySelector('#pos-requirements');
    const h1 = document.querySelector('h1');
    return {
      h1: h1 ? (h1.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120) : null,
      descriptionLen: d ? (d.innerText || '').length : 0,
      descriptionPreview: d ? (d.innerText || '').replace(/\\s+/g, ' ').slice(0, 200) : null,
      requirementsLen: r ? (r.innerText || '').length : 0,
      requirementsPreview: r ? (r.innerText || '').replace(/\\s+/g, ' ').slice(0, 200) : null,
    };
  })()`);
  console.log(JSON.stringify(detail, null, 2));

  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
