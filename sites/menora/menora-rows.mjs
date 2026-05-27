import { chromium } from 'playwright';
import * as fs from 'fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const fullHtml = `<!doctype html><html><head><meta charset="utf-8"></head>${html}</html>`;

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ locale: 'he-IL' });
const p = await ctx.newPage();
await p.setContent(fullHtml, { waitUntil: 'domcontentloaded' });

const out = await p.evaluate(() => {
  const name = document.querySelector('[data-mnr-bo="position-name-0"]');
  const button = document.querySelector('[data-mnr-bo="details-button-0"]');
  const typeText = document.querySelector('[data-mnr-bo="position-type-text-0"]');
  const type = document.querySelector('[data-mnr-bo="position-type-0"]');
  if (!name || !button) return { error: 'missing position-name-0 or details-button-0' };

  const ancestors = (el) => {
    const acc = [];
    let cur = el;
    while (cur) { acc.push(cur); cur = cur.parentElement; }
    return acc;
  };
  const aAnc = ancestors(name);
  const bAnc = new Set(ancestors(button));
  const lca = aAnc.find((e) => bAnc.has(e));

  const describe = (el) => {
    if (!el) return null;
    return {
      tag: el.tagName,
      cls: Array.from(el.classList).join(' '),
      bo: el.getAttribute('data-mnr-bo') || '',
      outerStart: el.outerHTML.slice(0, 320),
    };
  };

  const chainUp = [];
  let cur = name;
  let i = 0;
  while (cur && cur !== lca.parentElement && i < 15) {
    chainUp.push(describe(cur));
    cur = cur.parentElement;
    i++;
  }

  const lcaParent = lca.parentElement;
  const lcaParentChildCount = lcaParent ? lcaParent.children.length : 0;

  const probes = [
    'ul li[class*="item-grid"]',
    'li[class*="item-grid"]',
    lcaParent ? lcaParent.tagName + ' > ' + lca.tagName : '',
  ].filter(Boolean);
  const probeCounts = probes.map((sel) => {
    try { return { sel, n: document.querySelectorAll(sel).length }; }
    catch (e) { return { sel, n: -1, err: e.message }; }
  });

  return {
    lca: describe(lca),
    lcaParent: describe(lcaParent),
    lcaParentChildCount,
    chainUp,
    probeCounts,
    name: describe(name),
    button: describe(button),
    typeText: describe(typeText),
    type: describe(type),
  };
});

console.log(JSON.stringify(out, null, 2));
await b.close();
