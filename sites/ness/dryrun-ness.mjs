import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL = 'https://www.ness-tech.co.il/careers/';

const SETUP_SCRIPT = `(function () {
  try {
    var BASE = 'https://www.ness-tech.co.il';
    var DETAIL_PREFIX = BASE + '/careers/job/';
    // Sync XHR to avoid relying on the worker awaiting Promises.
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/careers/api/Careers/GetAllItems', false);
    try { xhr.setRequestHeader('accept', 'application/json'); } catch (e) {}
    xhr.send();
    if (xhr.status !== 200) {
      var marker = document.createElement('span');
      marker.setAttribute('data-haide-setup-error', 'http_' + xhr.status);
      marker.style.display = 'none';
      document.body.appendChild(marker);
      return;
    }
    var data = JSON.parse(xhr.responseText);
    var list = (data && data.allOrderDetailsList) || [];
    var cards = document.querySelectorAll('.card-job-container');
    var injectedCount = 0;
    var mismatchCount = 0;
    for (var i = 0; i < cards.length && i < list.length; i++) {
      var card = cards[i];
      if (card.querySelector('.haide-enrich')) continue;
      var d = list[i] || {};

      // Sanity check: compare the title in the DOM (2nd li of first ul,
      // contains the job title as text) against the API title. If they
      // disagree, fall back to searching the list by title to handle
      // out-of-order responses.
      var domTitle = '';
      try {
        var liTitle = card.querySelectorAll('ul li')[1];
        if (liTitle) domTitle = (liTitle.textContent || '').replace(/\\s+/g, ' ').trim();
      } catch (e) {}
      if (domTitle && d.title && domTitle.indexOf(d.title.replace(/\\s+/g, ' ').trim()) === -1 &&
          d.title.replace(/\\s+/g, ' ').trim().indexOf(domTitle) === -1) {
        // Fall back: search the list
        var found = null;
        for (var k = 0; k < list.length; k++) {
          if (list[k] && list[k].title && (list[k].title.indexOf(domTitle) !== -1 || domTitle.indexOf(list[k].title) !== -1)) {
            found = list[k]; break;
          }
        }
        if (found) { d = found; } else { mismatchCount++; continue; }
      }

      var wrap = document.createElement('div');
      wrap.className = 'haide-enrich';
      wrap.style.display = 'none';

      function addSpan(cls, text) {
        var s = document.createElement('span');
        s.className = cls;
        s.textContent = text == null ? '' : String(text);
        wrap.appendChild(s);
      }
      function addLink(cls, href) {
        var a = document.createElement('a');
        a.className = cls;
        a.setAttribute('href', href);
        a.textContent = href;
        wrap.appendChild(a);
      }
      var descClean = (d.posDescription || '').replace(/<BR\\s*\\/?>/gi, '\\n').replace(/&nbsp;/gi, ' ');
      addSpan('haide-title', d.title);
      addSpan('haide-location', d.posLocation);
      addSpan('haide-description', descClean);
      addSpan('haide-jobid', d.index);
      addSpan('haide-publish-date', d.lastUpdated);
      addSpan('haide-department', d.profName);
      addSpan('haide-subdept', d.subProfName);
      addSpan('haide-contact-name', d.rakazName);
      addSpan('haide-contact-email', d.rakazEmail);
      addSpan('haide-is-hot', d.isHot);
      if (d.index) addLink('haide-detail-url', DETAIL_PREFIX + d.index);
      card.appendChild(wrap);
      injectedCount++;
    }
    var m = document.createElement('span');
    m.setAttribute('data-haide-setup-done', '1');
    m.setAttribute('data-haide-injected', String(injectedCount));
    m.setAttribute('data-haide-mismatch', String(mismatchCount));
    m.setAttribute('data-haide-list-len', String(list.length));
    m.setAttribute('data-haide-cards-len', String(cards.length));
    m.style.display = 'none';
    document.body.appendChild(m);
  } catch (e) {
    var em = document.createElement('span');
    em.setAttribute('data-haide-setup-error', String(e).slice(0, 300));
    em.style.display = 'none';
    document.body.appendChild(em);
  }
})();`;

(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await p.waitForSelector('.card-job-container', { timeout: 15000 });
  await p.waitForTimeout(1000);

  // Inject the setupScript
  await p.evaluate(SETUP_SCRIPT);

  // Read the diagnostic markers
  const diag = await p.evaluate(() => {
    const m = document.querySelector('[data-haide-setup-done]');
    const err = document.querySelector('[data-haide-setup-error]');
    return {
      done: m ? {
        injected: m.getAttribute('data-haide-injected'),
        mismatch: m.getAttribute('data-haide-mismatch'),
        listLen: m.getAttribute('data-haide-list-len'),
        cardsLen: m.getAttribute('data-haide-cards-len'),
      } : null,
      error: err ? err.getAttribute('data-haide-setup-error') : null,
    };
  });
  console.log('setupScript diag:', JSON.stringify(diag, null, 2));

  // Now run the dry-run with the field selectors
  const itemSel = '.card-job-container';
  const fields = {
    title:           { selector: '.haide-title' },
    location:        { selector: '.haide-location' },
    description:     { selector: '.haide-description' },
    externalJobId:   { selector: '.haide-jobid' },
    publishDate:     { selector: '.haide-publish-date' },
    department:      { selector: '.haide-department' },
    detailUrl:       { selector: '.haide-detail-url', attr: 'href' },
    contactEmail:    { selector: '.haide-contact-email' },
    contactName:     { selector: '.haide-contact-name' },
    subDepartment:   { selector: '.haide-subdept' },
    isHot:           { selector: '.haide-is-hot' },
  };

  const out = await p.evaluate((args) => {
    const items = document.querySelectorAll(args.itemSel);
    const samples = [];
    const indices = [0, 1, 100, 192];
    for (const i of indices) {
      if (i >= items.length) continue;
      const it = items[i];
      const rec = { _idx: i };
      for (const [name, f] of Object.entries(args.fields)) {
        const el = it.querySelector(f.selector);
        if (!el) { rec[name] = null; continue; }
        rec[name] = f.attr ? el.getAttribute(f.attr) : (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100);
      }
      samples.push(rec);
    }
    return { count: items.length, samples };
  }, { itemSel, fields });

  const outPath = path.join(os.tmpdir(), 'ness-dryrun.json');
  fs.writeFileSync(outPath, JSON.stringify({ diag, ...out }, null, 2), 'utf8');
  console.log('\nwrote:', outPath);
  console.log('count:', out.count);
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
