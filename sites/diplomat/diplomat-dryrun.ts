import { chromium } from 'playwright';

(async () => {
  const url = process.argv[2];
  const detailUrl = process.argv[3];
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const p = await ctx.newPage();

  // ---- LISTING ----
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

  const listingProbe = `(() => {
    var items = document.querySelectorAll('a.job-item[href]');
    var txt = function(el, attr) {
      if (!el) return null;
      if (attr) return el.getAttribute(attr);
      return (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 100);
    };
    var samples = [];
    for (var i = 0; i < Math.min(3, items.length); i++) {
      var it = items[i];
      samples.push({
        title:         txt(it.querySelector('.job-title')),
        location:      txt(it.querySelector('[data-field="location"]')),
        externalJobId: txt(it.querySelector('[data-field="compPositionID"]')),
        publishDate:   txt(it.querySelector('[data-field="activationDate"]')),
        shortDesc:     txt(it.querySelector('.job-shortdescription')),
        detailUrl:     it.getAttribute('href'),
      });
    }
    return { count: items.length, samples: samples };
  })()`;
  const listingOut = await p.evaluate(listingProbe);
  console.log('--- LISTING ---');
  console.log(JSON.stringify(listingOut, null, 2));

  // ---- DETAIL ----
  await p.goto(detailUrl, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

  const detailProbe = `(() => {
    var txt = function(el) { return el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : null; };
    var desc = txt(document.querySelector('[data-field="description"]'));
    return {
      title: txt(document.querySelector('[data-field="extJobTitleText"]')) || txt(document.querySelector('.job-title')),
      location: txt(document.querySelector('[data-field="location"]')),
      externalJobId: txt(document.querySelector('[data-field="compPositionID"]')),
      descriptionLen: desc ? desc.length : 0,
      descriptionPreview: desc ? desc.slice(0, 200) : null,
    };
  })()`;
  const detailOut = await p.evaluate(detailProbe);
  console.log('--- DETAIL ---');
  console.log(JSON.stringify(detailOut, null, 2));

  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
