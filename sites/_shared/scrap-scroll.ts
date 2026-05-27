import { chromium } from 'playwright';

(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'en-US' });
  const p = await ctx.newPage();
  await p.goto('https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite?q=Israel', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('[data-automation-id="jobResults"]', { timeout: 15000 });
  await p.waitForTimeout(2000);

  const counts: number[] = [];
  for (let i = 0; i < 8; i++) {
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await p.waitForTimeout(2000);
    const n = await p.evaluate(() => document.querySelectorAll('[data-automation-id="jobResults"] > ul > li').length);
    counts.push(n);
  }
  console.log(JSON.stringify({ counts }, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
