import { chromium } from 'playwright';
import * as fs from 'fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const fullHtml = `<!doctype html><html><head><meta charset="utf-8"></head>${html}</html>`;

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ locale: 'he-IL' });
const p = await ctx.newPage();
await p.setContent(fullHtml, { waitUntil: 'domcontentloaded' });

const out = await p.evaluate(() => {
  // For the first job row, dump the inner HTML of its grandparent (the "row" div)
  // and also walk further up to see if there's a sibling .expand or .description.
  const itemSel = 'div:has(> div > [data-mnr-bo^="position-name-"]):has(> [data-mnr-bo^="position-type-text-"])';
  const items = document.querySelectorAll(itemSel);
  if (!items.length) return { error: 'no items found' };
  const first = items[0];

  // Look for sibling description / expand panels
  const parent = first.parentElement;
  const siblings = parent ? Array.from(parent.children) : [];
  const idxInParent = siblings.indexOf(first);

  // Check the first item's full outerHTML to see all descendant fields
  return {
    nItems: items.length,
    firstOuter: first.outerHTML.slice(0, 2000),
    parentTag: parent ? parent.tagName : null,
    parentClass: parent ? Array.from(parent.classList).join(' ') : null,
    parentChildCount: siblings.length,
    idxInParent,
    siblingAt0: siblings[0] ? siblings[0].outerHTML.slice(0, 400) : null,
    siblingAt1: siblings[1] ? siblings[1].outerHTML.slice(0, 400) : null,
    siblingAt2: siblings[2] ? siblings[2].outerHTML.slice(0, 400) : null,
    // descendant scan for likely description hooks
    descScan: {
      anchorsInside: first.querySelectorAll('a[href]').length,
      pInside: first.querySelectorAll('p').length,
      h2Inside: first.querySelectorAll('h2, h3').length,
      hiddenDescInside: !!first.querySelector('[hidden], [aria-hidden="true"], .description, .desc, [class*="desc"]'),
    },
  };
});

console.log(JSON.stringify(out, null, 2));
await b.close();
