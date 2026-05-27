import { chromium } from 'playwright';
import * as fs from 'fs';

(async () => {
  const html = fs.readFileSync(process.argv[2], 'utf8');
  const fullHtml = `<!doctype html><html><head><meta charset="utf-8"></head>${html}</html>`;

  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL' });
  const p = await ctx.newPage();
  await p.setContent(fullHtml, { waitUntil: 'domcontentloaded' });

  const rowAnalysis = await p.evaluate(() => {
    const name = document.querySelector('[data-mnr-bo="position-name-0"]') as HTMLElement | null;
    const button = document.querySelector('[data-mnr-bo="details-button-0"]') as HTMLElement | null;
    const typeText = document.querySelector('[data-mnr-bo="position-type-text-0"]') as HTMLElement | null;
    const type = document.querySelector('[data-mnr-bo="position-type-0"]') as HTMLElement | null;
    if (!name || !button) return { error: 'missing position-name-0 or details-button-0' };

    const ancestors = (el: Element): Element[] => {
      const out: Element[] = [];
      let cur: Element | null = el;
      while (cur) { out.push(cur); cur = cur.parentElement; }
      return out;
    };
    const aAnc = ancestors(name);
    const bAnc = new Set(ancestors(button));
    const lca = aAnc.find(e => bAnc.has(e)) as Element;

    const describe = (el: Element | null) => {
      if (!el) return null;
      const cls = Array.from(el.classList).join(' ');
      const bo = el.getAttribute('data-mnr-bo') || '';
      return { tag: el.tagName, class: cls, bo, outerStart: (el as HTMLElement).outerHTML.slice(0, 280) };
    };

    const chainUp: any[] = [];
    let cur: Element | null = name;
    let safety = 0;
    while (cur && cur !== lca.parentElement && safety < 15) {
      chainUp.push(describe(cur));
      cur = cur.parentElement;
      safety++;
    }

    const lcaParent = lca.parentElement;
    const lcaParentChildCount = lcaParent ? lcaParent.children.length : 0;

    const probes = [
      'ul li[class*="item-grid"]',
      'li[class*="item-grid"]',
      lcaParent ? lcaParent.tagName + ' > ' + lca.tagName : '',
    ].filter(Boolean) as string[];
    const probeCounts = probes.map(sel => {
      try { return { sel, n: document.querySelectorAll(sel).length }; }
      catch (e: any) { return { sel, n: -1, err: e.message }; }
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

  console.log(JSON.stringify(rowAnalysis, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
