import { chromium } from 'playwright';
import * as fs from 'fs';

(async () => {
  const url = process.argv[2];
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    extraHTTPHeaders: { 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' },
  });
  const p = await ctx.newPage();

  const apiReqs: any[] = [];
  p.on('request', (req) => {
    const u = req.url();
    const ct = req.headers()['accept'] || '';
    if (
      /api|jobs?\b|umbraco|graphql/i.test(u) &&
      !/google|facebook|gtm|hotjar|doubleclick|gstatic|fonts/i.test(u) &&
      !/\.(png|jpg|svg|css|js|woff)$/i.test(u)
    ) {
      apiReqs.push({ method: req.method(), url: u.slice(0, 220), postData: req.postData()?.slice(0, 300) });
    }
  });

  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // Wait specifically for the accordion-item to appear
  await p.waitForSelector('.accordion-item', { timeout: 30000 }).catch(() => {});
  await p.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(2000);

  const data = await p.evaluate(() => {
    // Find candidate item selectors with different strategies
    const sel1 = document.querySelectorAll('.accordion-item');
    const sel2 = document.querySelectorAll('[class*="JobsAccordion_customItem"]');
    const sel3 = document.querySelectorAll('[class*="customItem"]');
    const result: any = {
      selAccordionItem: sel1.length,
      selJobsAccordion: sel2.length,
      selCustomItem: sel3.length,
      firstAccordionHTML: sel1[0] ? (sel1[0] as HTMLElement).outerHTML.slice(0, 6000) : null,
      counterCandidates: [] as string[],
      loadMoreButtons: [] as string[],
      paginationButtons: [] as string[],
    };

    document.querySelectorAll('h1, h2, h3, h4, p, span, div').forEach((el) => {
      const t = (el.textContent || '').trim();
      if (/^\d{1,4}\s+משרות$/.test(t) || /\d+\s+(jobs|results)/i.test(t) || /נמצאו\s*\d+/i.test(t) || /סה.כ.*\d+/.test(t)) {
        result.counterCandidates.push(t.slice(0, 120));
      }
    });

    document.querySelectorAll('button, a').forEach((el) => {
      const t = (el.textContent || '').trim();
      if (/load.*more|show.*more|הצג.*עוד|טען.*עוד|עוד משרות|הבא|next/i.test(t)) {
        result.loadMoreButtons.push(((el as HTMLElement).className || '').slice(0,80) + ' :: ' + t.slice(0, 80));
      }
      if (/page|עמוד|pagination/i.test(((el as HTMLElement).className || '') + ' ' + ((el as HTMLElement).getAttribute('aria-label') || ''))) {
        result.paginationButtons.push(((el as HTMLElement).className || '').slice(0,80) + ' :: aria=' + ((el as HTMLElement).getAttribute('aria-label') || ''));
      }
    });

    return result;
  });

  console.log('counts: .accordion-item=', data.selAccordionItem, ', [class*=JobsAccordion_customItem]=', data.selJobsAccordion, ', [class*=customItem]=', data.selCustomItem);
  console.log('counterCandidates:', data.counterCandidates);
  console.log('loadMoreButtons:', data.loadMoreButtons);
  console.log('paginationButtons:', data.paginationButtons);
  fs.writeFileSync('.scratch/assuta-first-job.html', data.firstAccordionHTML || '');
  console.log('saved first accordion item HTML to .scratch/assuta-first-job.html');

  console.log('\n--- captured api-like requests ---');
  for (const r of apiReqs.slice(0, 30)) {
    console.log(`${r.method} ${r.url}`);
    if (r.postData) console.log('  body:', r.postData);
  }

  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
