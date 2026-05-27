import { chromium } from 'playwright';
(async () => {
  const URL = 'https://jobs.keshet-mediagroup.com/';
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  const beforeUrl = p.url();
  // Click first job
  await p.click('.job-container');
  await p.waitForTimeout(3000);
  await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  const afterUrl = p.url();
  console.log('before:', beforeUrl);
  console.log('after :', afterUrl);
  const findings = await p.evaluate(() => {
    const heads = Array.from(document.querySelectorAll('h1,h2,h3')).map(h => h.textContent?.trim().slice(0, 80));
    const mailtos = Array.from(document.querySelectorAll('a[href^="mailto:"]')).map(a => a.getAttribute('href'));
    const modals = Array.from(document.querySelectorAll('[class*="modal"],[class*="overlay"],[class*="popup"]')).slice(0, 5).map(el => ({ class: el.className, html: (el.outerHTML || '').slice(0, 200) }));
    return { heads, mailtos: Array.from(new Set(mailtos)), modalCount: modals.length };
  });
  console.log(JSON.stringify(findings, null, 2));
  // Save full HTML after click
  require('fs').writeFileSync('/tmp/keshet-clicked.html', await p.content());
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
