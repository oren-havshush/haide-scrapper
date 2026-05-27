import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

(async () => {
  const url = 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite?q=Israel';
  const cfg = JSON.parse(fs.readFileSync(path.resolve('.scratch', 'scrap-config.json'), 'utf8'));
  const setupScript: string = cfg.setupScript;

  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'en-US', timezoneId: 'Asia/Jerusalem' });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('[data-automation-id="jobResults"] > ul > li', { timeout: 15000 });
  await p.waitForTimeout(2000);

  console.log('Running setupScript...');
  const t0 = Date.now();
  // Worker runs setupScript via page.evaluate(string); use eval to mimic.
  await p.evaluate((src: string) => {
    // eslint-disable-next-line no-eval
    return (0, eval)(src);
  }, setupScript);
  console.log('setupScript done in', Date.now() - t0, 'ms');

  const out = await p.evaluate(`(function(){
    var items = document.querySelectorAll('[data-automation-id="jobResults"] > ul > li');
    var samples = [];
    function probe(it, sel, attr) {
      var el = it.querySelector(sel);
      if (!el) return null;
      return attr ? el.getAttribute(attr) : (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 140);
    }
    for (var i = 0; i < Math.min(3, items.length); i++) {
      var it = items[i];
      samples.push({
        title: probe(it, 'a[data-automation-id="jobTitle"]'),
        externalJobId: probe(it, '[data-extracted-jobid]'),
        detailUrl: probe(it, '[data-extracted-detailurl]', 'href'),
        location: probe(it, '[data-extracted-location]'),
        publishDate: probe(it, '[data-extracted-publishdate]'),
        descriptionPreview: probe(it, '[data-extracted-description]')
      });
    }
    return { count: items.length, samples: samples };
  })()`);

  console.log(JSON.stringify(out, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
