import { chromium } from 'playwright';
(async () => {
  const URL = process.argv[2];
  const OUT = process.argv[3];
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    locale: 'he-IL', timezoneId: 'Asia/Jerusalem',
    viewport: { width: 1440, height: 900 },
  });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(1500);
  const html = await p.content();
  require('fs').writeFileSync(OUT, html);
  // Find descriptive sections
  const findings = await p.evaluate(() => {
    const heads: any[] = [];
    document.querySelectorAll('h1,h2,h3,h4').forEach(h => {
      const t = (h.textContent || '').trim();
      if (t) heads.push({ tag: h.tagName, text: t.slice(0, 80), parentClasses: Array.from((h.parentElement?.classList || [])).slice(0, 3) });
    });
    const mailtos = Array.from(document.querySelectorAll('a[href^="mailto:"]')).map(a => a.getAttribute('href'));
    return { heads: heads.slice(0, 20), mailtos: Array.from(new Set(mailtos)) };
  });
  console.log(JSON.stringify(findings, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
