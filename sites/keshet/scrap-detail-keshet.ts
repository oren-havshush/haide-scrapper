import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

(async () => {
  const urls = [
    'https://jobs.keshet-mediagroup.com/jobs/A5.467',  // Software Eng TL
    'https://jobs.keshet-mediagroup.com/jobs/2A.46A',  // Hebrew accounting
    'https://jobs.keshet-mediagroup.com/jobs/81.A6A',  // Data Analyst
  ];
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const p = await ctx.newPage();
  for (const url of urls) {
    console.log('\n========', url, '========');
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    await p.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
    await p.waitForTimeout(2500);
    const html = await p.content();
    if (urls.indexOf(url) === 0) fs.writeFileSync(path.resolve('.scratch', 'scrap-detail-keshet.html'), html);
    const info = await p.evaluate(`(() => {
      // jobline.position is what setDescription used
      const pos = (window).jobline ? (window).jobline.position : null;
      const posKeys = pos ? Object.keys(pos) : null;
      // pick out the page's main visible content
      const candidates = Array.from(document.querySelectorAll('div')).filter(function(d){
        var txt = (d.innerText || '').replace(/\\s+/g,' ').trim();
        return txt.length > 200 && txt.length < 5000;
      });
      const bigTextEls = candidates.slice(0, 5).map(function(d){
        return {
          cls: (d.className||'').toString().slice(0, 80),
          id: d.id || '',
          len: (d.innerText || '').length,
          preview: (d.innerText || '').replace(/\\s+/g,' ').slice(0, 250),
        };
      });
      // Heading
      const h1 = document.querySelector('h1');
      const h2 = document.querySelector('h2');
      const titleEl = document.querySelector('.job-title, [class*="title"]');
      // Common content selectors
      const tries = ['.description', '.job-description', '.position-details', '.position-description', '[class*="description"]', '.kst-position-description', '#description'];
      const trySamples = tries.map(function(s){
        const el = document.querySelector(s);
        return { sel: s, found: !!el, len: el ? (el.innerText || '').length : 0, preview: el ? (el.innerText || '').replace(/\\s+/g,' ').slice(0, 200) : null };
      });
      return {
        finalUrl: location.href,
        pageTitle: document.title,
        h1: h1 ? h1.textContent.trim().slice(0, 100) : null,
        h2: h2 ? h2.textContent.trim().slice(0, 100) : null,
        titleEl: titleEl ? { cls: titleEl.className, text: (titleEl.textContent || '').trim().slice(0, 100) } : null,
        joblinePosKeys: posKeys,
        joblinePosSample: pos ? { name: pos.name, jobNo: pos.jobNo, location: pos.location, department: pos.department, dateOpened: pos.dateOpened, uid: pos.uid, code: pos.code } : null,
        bigTextEls: bigTextEls,
        trySelectors: trySamples,
      };
    })()`);
    console.log(JSON.stringify(info, null, 2));
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
