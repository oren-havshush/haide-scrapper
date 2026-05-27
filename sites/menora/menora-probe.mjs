import { chromium } from 'playwright';
import * as fs from 'fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const fullHtml = `<!doctype html><html><head><meta charset="utf-8"></head>${html}</html>`;

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ locale: 'he-IL' });
const p = await ctx.newPage();
await p.setContent(fullHtml, { waitUntil: 'domcontentloaded' });

const out = await p.evaluate(() => {
  const selectors = [
    'div.flexRowFilter:has([data-mnr-bo^="position-name-"])',
    'div[style="padding-bottom:13px"]',
    'div[style*="padding-bottom"]:has([data-mnr-bo^="position-name-"])',
    'div:has(> .flexRowFilter):has(> .position-type)',
    'div:has(> div > [data-mnr-bo^="position-name-"]):has(> [data-mnr-bo^="position-type-text-"])',
    '[data-mnr-bo^="position-name-"]',
    '[data-mnr-bo^="details-button-"]',
    '[data-mnr-bo^="position-type-text-"]',
  ];
  const results = selectors.map((sel) => {
    try {
      const els = document.querySelectorAll(sel);
      const samples = [];
      for (let i = 0; i < Math.min(2, els.length); i++) {
        samples.push((els[i].textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100));
      }
      return { sel, n: els.length, samples };
    } catch (e) {
      return { sel, n: -1, err: e.message };
    }
  });

  // For each of 8 jobs, sample what we'd extract using a working item selector.
  // The row is `div:has(> div > [data-mnr-bo^="position-name-"]):has(> [data-mnr-bo^="position-type-text-"])`
  const itemSel = 'div:has(> div > [data-mnr-bo^="position-name-"]):has(> [data-mnr-bo^="position-type-text-"])';
  const items = document.querySelectorAll(itemSel);
  const fieldProbes = [];
  for (let i = 0; i < Math.min(8, items.length); i++) {
    const it = items[i];
    const title = it.querySelector('[data-mnr-bo^="position-name-"]');
    const dept = it.querySelector('[data-mnr-bo^="position-type-"]:not([data-mnr-bo*="text"])');
    const btn = it.querySelector('[data-mnr-bo^="details-button-"]');
    const link = it.querySelector('a[href]');
    fieldProbes.push({
      i,
      title: title ? (title.textContent || '').trim().slice(0, 60) : null,
      department: dept ? (dept.textContent || '').trim().slice(0, 60) : null,
      btnText: btn ? (btn.textContent || '').trim().slice(0, 30) : null,
      btnAria: btn ? btn.getAttribute('aria-label') : null,
      btnOnClick: btn ? btn.getAttribute('onclick') : null,
      btnHasHref: !!link,
      linkHref: link ? link.getAttribute('href') : null,
      btnOuter: btn ? btn.outerHTML.slice(0, 250) : null,
    });
  }

  return { results, fieldProbes, itemSel };
});

console.log(JSON.stringify(out, null, 2));
await b.close();
