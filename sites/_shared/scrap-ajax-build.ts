import { chromium } from 'playwright';

const SETUP_SCRIPT = `
(function () {
  return (async function () {
    try {
      var resp = await fetch('/Umbraco/api/SearchJobsApi/FilterJobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'FreeText=&ResultsPerPage=500&PageNumber=0&AdvertisingDestination=1',
        credentials: 'same-origin',
      });
      var data = await resp.json();
      var container = document.querySelector('.search-jobs-results-cont');
      if (!container || !data || !Array.isArray(data.Results)) return -1;

      container.querySelectorAll('.job-item:not(.job-item-clone)').forEach(function (el) { el.remove(); });

      data.Results.forEach(function (j) {
        var areaText = (j.Areas && j.Areas[0] && j.Areas[0].Description) || '';
        var item = document.createElement('div');
        item.className = 'job-item';
        item.innerHTML =
          '<h2 class="job-title"></h2>' +
          '<div class="job-sub-title"></div>' +
          '<div class="job-profession"><span>תחום:</span><label></label></div>' +
          '<div class="bottom">' +
            '<div class="job-area"><span class="text"></span></div>' +
            '<a class="job-details-link"></a>' +
          '</div>' +
          '<span data-extracted-jobid="1" style="display:none"></span>';
        item.querySelector('.job-title').textContent = j.Description || '';
        item.querySelector('.job-sub-title').innerHTML = j.Notes || '';
        item.querySelector('.job-profession label').textContent = j.Profession || '';
        item.querySelector('.job-area .text').textContent = areaText;
        var a = item.querySelector('.job-details-link');
        a.setAttribute('href', j.JobUrl || '');
        a.textContent = 'לפרטי המשרה';
        item.querySelector('[data-extracted-jobid]').textContent = String(j.JobId || '');
        container.appendChild(item);
      });

      var btn = document.querySelector('button.load-more-jobs');
      if (btn && btn.parentElement) btn.parentElement.style.display = 'none';
    } catch (e) {}
    return document.querySelectorAll('.job-item:not(.job-item-clone)').length;
  })();
})();
`;

(async () => {
  const url = process.argv[2];
  const b = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'] });
  const ctx = await b.newContext({
    locale: 'he-IL', timezoneId: 'Asia/Jerusalem',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
  });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(1500);

  const t0 = Date.now();
  const count = await p.evaluate(SETUP_SCRIPT);
  console.log('setupScript count:', count, 'in', Date.now() - t0, 'ms');

  // Use the production selectors now
  const samples = await p.evaluate(() => {
    const items = document.querySelectorAll('.job-item:not(.job-item-clone)');
    const out: any[] = [];
    [0, 1, 100, 200, items.length - 1].forEach(i => {
      if (i < 0 || i >= items.length) return;
      const el = items[i];
      const t = el.querySelector('.job-title');
      const loc = el.querySelector('.job-area .text');
      const prof = el.querySelector('.job-profession label');
      const desc = el.querySelector('.job-sub-title');
      const detailA = el.querySelector('.job-details-link');
      const tagged = el.querySelector('[data-extracted-jobid]');
      out.push({
        i,
        title: t ? (t.textContent || '').trim().slice(0, 60) : null,
        location: loc ? (loc.textContent || '').trim() : null,
        profession: prof ? (prof.textContent || '').trim() : null,
        description: desc ? (desc.textContent || '').trim().slice(0, 80) : null,
        detailUrl: detailA ? detailA.getAttribute('href') : null,
        jobid: tagged ? tagged.textContent : null,
      });
    });
    return out;
  });
  console.log('samples:', JSON.stringify(samples, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
