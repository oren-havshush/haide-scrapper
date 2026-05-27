import { chromium } from 'playwright';
import * as fs from 'fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const fullHtml = `<!doctype html><html><head><meta charset="utf-8"></head>${html}</html>`;

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ locale: 'he-IL' });
const p = await ctx.newPage();
await p.setContent(fullHtml, { waitUntil: 'domcontentloaded' });

const out = await p.evaluate(() => {
  const itemSel = 'div:has(> div > [data-mnr-bo^="position-name-"]):has(> [data-mnr-bo^="position-type-text-"])';
  const items = document.querySelectorAll(itemSel);
  const seen = new Set();
  const samples = [];
  let emptyTitle = 0;
  let emptyDept = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const title = (it.querySelector('[data-mnr-bo^="position-name-"]')?.textContent || '').trim();
    const dept = (it.querySelector('.position-type-text')?.textContent || '').trim();
    if (!title) emptyTitle++;
    if (!dept) emptyDept++;
    seen.add(title + '|' + dept);
    if (i < 3 || i === Math.floor(items.length / 2) || i === items.length - 1) {
      samples.push({ i, title: title.slice(0, 60), dept });
    }
  }
  return { nItems: items.length, nUnique: seen.size, emptyTitle, emptyDept, samples };
});

console.log(JSON.stringify(out, null, 2));
await b.close();
