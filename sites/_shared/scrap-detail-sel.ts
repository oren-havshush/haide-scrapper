import { chromium } from 'playwright';

(async () => {
  const url = process.argv[2];
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    extraHTTPHeaders: { 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' },
  });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(2000);

  const dump = await p.evaluate(() => {
    const out: any = {};

    // 1) Page <h2> = title
    const h2 = document.querySelector('h2');
    if (h2) {
      out.h2 = { text: (h2 as HTMLElement).innerText.trim(), className: (h2 as HTMLElement).className, parentTag: h2.parentElement?.tagName, parentClass: h2.parentElement?.className };
    }

    // 2) The "תחום:" line element
    const fields = ['תחום:', 'תיאור המשרה', 'דרישות התפקיד', 'מיומניות'];
    out.markers = {};
    const all = Array.from(document.querySelectorAll('*'));
    for (const marker of fields) {
      const hit = all.find((el) => {
        const t = (el as HTMLElement).innerText?.trim();
        // Match elements that START with this marker (so we get the heading itself, not body)
        return t && t.startsWith(marker) && t.length < 200;
      });
      if (hit) {
        const sib = hit.nextElementSibling;
        out.markers[marker] = {
          tag: hit.tagName,
          className: (hit as HTMLElement).className,
          text: (hit as HTMLElement).innerText.trim().slice(0, 200),
          nextSiblingTag: sib?.tagName,
          nextSiblingClass: sib ? (sib as HTMLElement).className : null,
          nextSiblingText: sib ? (sib as HTMLElement).innerText.trim().slice(0, 300) : null,
        };
      }
    }

    // 3) Inspect main container chain
    const main = document.querySelector('main');
    if (main) {
      out.main = {
        tag: 'MAIN',
        className: (main as HTMLElement).className,
        childCount: main.children.length,
        children: Array.from(main.children).slice(0, 10).map((c) => ({
          tag: c.tagName,
          className: (c as HTMLElement).className,
          textPreview: (c as HTMLElement).innerText.trim().slice(0, 80),
        })),
      };
    }

    return out;
  });

  console.log(JSON.stringify(dump, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
