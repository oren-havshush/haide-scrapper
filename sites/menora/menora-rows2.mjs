import { chromium } from 'playwright';
import * as fs from 'fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const fullHtml = `<!doctype html><html><head><meta charset="utf-8"></head>${html}</html>`;

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ locale: 'he-IL' });
const p = await ctx.newPage();
await p.setContent(fullHtml, { waitUntil: 'domcontentloaded' });

const out = await p.evaluate(() => {
  // Find the LCA of position-name-0, details-button-0, AND position-type-text-0.
  const a = document.querySelector('[data-mnr-bo="position-name-0"]');
  const c = document.querySelector('[data-mnr-bo="position-type-text-0"]');
  if (!a || !c) return { error: 'missing one of the markers' };

  const ancSet = new Set();
  let cur = a;
  while (cur) { ancSet.add(cur); cur = cur.parentElement; }
  let lca = c;
  while (lca && !ancSet.has(lca)) lca = lca.parentElement;

  const describe = (el) => {
    if (!el) return null;
    return {
      tag: el.tagName,
      cls: Array.from(el.classList).join(' '),
      bo: el.getAttribute('data-mnr-bo') || '',
      id: el.id || '',
      childCount: el.children.length,
      outerStart: el.outerHTML.slice(0, 500),
    };
  };

  // For each job 0..N find its LCA and report a stable, unique selector for it.
  const rowLCAs = [];
  for (let i = 0; i < 8; i++) {
    const n = document.querySelector(`[data-mnr-bo="position-name-${i}"]`);
    const t = document.querySelector(`[data-mnr-bo="position-type-text-${i}"]`);
    if (!n || !t) continue;
    const aset = new Set();
    let p = n;
    while (p) { aset.add(p); p = p.parentElement; }
    let l = t;
    while (l && !aset.has(l)) l = l.parentElement;
    rowLCAs.push({ i, lca: describe(l) });
  }

  // Test some candidate itemSelectors against the page.
  const probes = [
    '[id="positionsListing"] > div',
    'div:has(> div > [data-mnr-bo^="position-name-"])',
    'div:has(> [data-mnr-bo^="position-name-"])',
    '*:has(> [data-mnr-bo^="position-name-"])',
    '*:has([data-mnr-bo^="position-name-"]):has([data-mnr-bo^="position-type-text-"])',
    'div.flexRowFilter',
    '[id^="position-name"]',
  ];
  const probeCounts = probes.map((sel) => {
    try { return { sel, n: document.querySelectorAll(sel).length }; }
    catch (e) { return { sel, n: -1, err: e.message }; }
  });

  return { lcaOfNameAndType: describe(lca), rowLCAs, probeCounts };
});

console.log(JSON.stringify(out, null, 2));
await b.close();
