import { chromium } from 'playwright';

// Async setupScript: click load-more until button hides or count stabilises.
const SETUP_SCRIPT = `
(function () {
  function tagJobIds() {
    document.querySelectorAll('.job-item:not(.job-item-clone)').forEach(function (el) {
      if (el.querySelector('[data-extracted-jobid]')) return;
      var a = el.querySelector('.job-details-link');
      var href = a ? a.getAttribute('href') : '';
      var m = href ? href.match(/-(\\d+)\\/?$/) : null;
      if (m && m[1]) {
        var s = document.createElement('span');
        s.setAttribute('data-extracted-jobid', '1');
        s.style.display = 'none';
        s.textContent = m[1];
        el.appendChild(s);
      }
    });
  }
  function clickIt(btn) {
    try {
      if (window.jQuery) { window.jQuery(btn).trigger('click'); return; }
    } catch (e) {}
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  }
  return new Promise(function (resolve) {
    var maxClicks = 40;
    var clicks = 0;
    var lastCount = -1;
    var sameTimes = 0;
    function tick() {
      var btn = document.querySelector('button.load-more-jobs');
      var visible = btn && btn.offsetParent !== null;
      var current = document.querySelectorAll('.job-item:not(.job-item-clone)').length;
      if (lastCount >= 0) {
        if (current === lastCount) sameTimes++; else sameTimes = 0;
      }
      lastCount = current;
      if (!visible || clicks >= maxClicks || sameTimes >= 3) {
        tagJobIds();
        resolve(current);
        return;
      }
      clickIt(btn);
      clicks++;
      setTimeout(tick, 2200);
    }
    tick();
  });
})();
`;

(async () => {
  const url = process.argv[2];
  const b = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });
  const ctx = await b.newContext({
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
    extraHTTPHeaders: { 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' },
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(1500);

  const before = await p.evaluate(() => document.querySelectorAll('.job-item:not(.job-item-clone)').length);
  console.log('before setupScript:', before);

  const t0 = Date.now();
  const result = await p.evaluate(SETUP_SCRIPT);
  console.log('setupScript returned:', result, 'in', Date.now() - t0, 'ms');

  const after = await p.evaluate(() => document.querySelectorAll('.job-item:not(.job-item-clone)').length);
  const tagged = await p.evaluate(() => document.querySelectorAll('[data-extracted-jobid]').length);
  console.log('after setupScript: items =', after, ', tagged =', tagged);

  // Sample a few
  const samples = await p.evaluate(() => {
    const items = document.querySelectorAll('.job-item:not(.job-item-clone)');
    const out: any[] = [];
    [0, 1, items.length - 2, items.length - 1].forEach(i => {
      if (i < 0 || i >= items.length) return;
      const el = items[i];
      const t = el.querySelector('.job-title');
      const loc = el.querySelector('.job-area .text');
      const tagged = el.querySelector('[data-extracted-jobid]');
      out.push({
        i,
        title: t ? (t.textContent || '').trim().slice(0, 60) : null,
        location: loc ? (loc.textContent || '').trim() : null,
        jobid: tagged ? tagged.textContent : null,
      });
    });
    return out;
  });
  console.log('samples:', JSON.stringify(samples, null, 2));

  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
