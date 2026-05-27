import { chromium } from 'playwright';

(async () => {
  const url = process.argv[2];
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

  const out = await p.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.job.filterItem'));
    const records = items.map((it, i) => {
      const titleEl = it.querySelector('h3');
      const idEl = it.querySelector('input[name="HiddenJobsIds"]') as HTMLInputElement | null;
      const detailEl = it.querySelector('a.toggler') as HTMLAnchorElement | null;
      return {
        i,
        title: (titleEl?.textContent || '').trim().slice(0, 60),
        externalJobId: idEl?.value ?? null,
        detailHref: detailEl?.getAttribute('href') ?? null,
      };
    });
    const idCounts: Record<string, number> = {};
    for (const r of records) {
      const k = r.externalJobId ?? '<null>';
      idCounts[k] = (idCounts[k] || 0) + 1;
    }
    const dupes = Object.entries(idCounts).filter(([, n]) => n > 1);
    return {
      totalItems: items.length,
      uniqueIds: Object.keys(idCounts).length,
      nullIds: idCounts['<null>'] || 0,
      duplicateIds: dupes,
      sampleRecords: records.slice(0, 50),
    };
  });

  console.log(JSON.stringify(out, null, 2));
  await b.close();
})();
