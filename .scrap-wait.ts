import { chromium } from 'playwright';
(async () => {
  const URL = process.argv[2];
  const OUT = process.argv[3];
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', viewport: { width: 1440, height: 1800 } });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  // Wait for jobs to be injected
  await p.waitForFunction(() => {
    const c = document.querySelector('.population-target');
    return c && c.children.length > 0;
  }, { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(2000);
  const html = await p.content();
  require('fs').writeFileSync(OUT, html);
  const r = await p.evaluate(() => {
    const target = document.querySelector('.population-target');
    return {
      htmlLen: document.documentElement.outerHTML.length,
      targetChildren: target ? target.children.length : -1,
      // Stats
      classes: Array.from(new Set(
        Array.from(document.querySelectorAll('.population-target *'))
          .slice(0, 30)
          .map(el => el.className)
      )),
      sample: target ? target.outerHTML.slice(0, 800) : '',
    };
  });
  console.log(JSON.stringify(r, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
