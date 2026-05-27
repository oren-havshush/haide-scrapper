import { chromium } from 'playwright';

(async () => {
  const url = 'https://www.aman.co.il/careers/all/';
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const p = await ctx.newPage();
  const reqs: { method: string; url: string; type: string }[] = [];
  p.on('request', (r) => {
    const u = r.url();
    if (/\/api\/|\/wp-json\/|\/_next\/data\/|graphql|positions|careers\/api|jobs?\.json/i.test(u) &&
        !/google|gtm|facebook|hcaptcha|hotjar|doubleclick|gstatic|analytics|cdn\.|fonts/i.test(u)) {
      reqs.push({ method: r.method(), url: u.slice(0, 220), type: r.resourceType() });
    }
  });
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(2000);
  const itemCount = await p.evaluate(() => document.querySelectorAll('article.positions_page__application').length);
  const totalText = await p.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll('h1,h2,h3,p,span,div,strong').forEach((el) => {
      const t = (el.textContent || '').trim();
      if (/^\d{1,4}\s*משרות/.test(t) || /\d{1,4}\s+(jobs|positions|open|נמצאו|מציג)/i.test(t)) {
        out.push(t.slice(0, 80));
      }
    });
    return Array.from(new Set(out));
  });
  const paginationLinks = await p.evaluate(() => {
    const links: string[] = [];
    document.querySelectorAll('a').forEach((a) => {
      const h = a.getAttribute('href') || '';
      const t = (a.textContent || '').trim();
      if (/page\/\d+|\?page=\d+|paged=\d+/.test(h) || /^עמוד הבא|next|הבא|»/i.test(t)) {
        links.push(`[${t.slice(0,20)}] ${h}`);
      }
    });
    return Array.from(new Set(links)).slice(0, 10);
  });
  console.log('listing-page item count:', itemCount);
  console.log('total/count text on page:', totalText);
  console.log('pagination links:', paginationLinks);
  console.log('\n--- interesting requests (API/JSON candidates) ---');
  for (const r of reqs.slice(0, 25)) console.log(`${r.method} ${r.type} ${r.url}`);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
