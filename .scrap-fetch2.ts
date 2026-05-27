import { chromium } from 'playwright';
(async () => {
  const URL = process.argv[2];
  const OUT = process.argv[3];
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    locale: 'he-IL', timezoneId: 'Asia/Jerusalem',
    extraHTTPHeaders: { 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' },
    viewport: { width: 1440, height: 900 },
  });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // Scroll a few times to trigger any lazy loading
  for (let i = 0; i < 5; i++) {
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await p.waitForTimeout(1200);
  }
  await p.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(2000);
  const html = await p.content();
  require('fs').writeFileSync(OUT, html);
  // Look for headings that mention משרות/דרושים/vacancies and find their containers
  const findings = await p.evaluate(() => {
    const result: any[] = [];
    const headings = document.querySelectorAll('h1,h2,h3,h4');
    headings.forEach(h => {
      const t = (h.textContent || '').trim();
      if (/משרות|דרושים|vacanc/i.test(t)) {
        let cur: Element | null = h;
        for (let i = 0; i < 5 && cur; i++) {
          cur = cur.parentElement;
        }
        result.push({ text: t.slice(0, 60), htag: h.tagName, parentSig: cur ? cur.tagName + '.' + Array.from(cur.classList).slice(0,3).join('.') : null });
      }
    });
    // Also count items that look like job cards: anchors leading to job-like URLs
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    const jobAnchors = anchors.filter(a => /job|career|position|vacan|משרה|דרוש/i.test(a.getAttribute('href') || ''));
    const sample = jobAnchors.slice(0, 5).map(a => ({ href: a.getAttribute('href'), text: (a.textContent || '').trim().slice(0, 60) }));
    return { headings: result, jobAnchorCount: jobAnchors.length, sampleAnchors: sample };
  });
  console.log(JSON.stringify(findings, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
