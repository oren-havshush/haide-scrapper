import * as fs from 'fs';
import * as path from 'path';

const URL_LISTING = 'https://www.assuta.co.il/jobs/search/';

const setupScript = `(function () {
  return (async function () {
    var diag = { stage: 'start' };
    var positions = [];
    try {
      diag.title = (document.title || '').slice(0, 80);
      diag.url = location.href;
      diag.bodyLen = (document.body && document.body.innerHTML || '').length;
      diag.existing = document.querySelectorAll('.accordion-item').length;
      diag.hasReblaze = /__uzdbm_|reblaze|perfdrive|Just a moment|challenge/i.test(document.documentElement.outerHTML || '');

      var resp = null, text = '';
      for (var attempt = 0; attempt < 3; attempt++) {
        try {
          resp = await fetch('/api/job-positions/get-jobs', { credentials: 'same-origin' });
          text = await resp.text();
          diag['attempt' + attempt] = (resp.status + ' len=' + text.length + ' head=' + text.slice(0, 60));
          if (resp.ok && text.charAt(0) === '{') break;
        } catch (err) { diag['attemptErr' + attempt] = String(err).slice(0, 200); }
        await new Promise(function (r) { setTimeout(r, 2000); });
      }
      diag.fetchStatus = resp ? resp.status : null;
      diag.fetchLen = text.length;

      try { var data = JSON.parse(text); positions = (data && data.positions) || []; } catch (e) { diag.parseErr = String(e).slice(0, 120); }
      diag.positionsCount = positions.length;
    } catch (e) { diag.outerErr = String(e).slice(0, 200); }

    var container = document.querySelector('#jobsAccordion') ||
                    document.querySelector('[class*="JobsAccordion_itemsContainer"]') ||
                    document.querySelector('.accordion');
    if (!container) {
      container = document.createElement('div');
      container.id = 'jobsAccordion';
      document.body.appendChild(container);
    }
    container.querySelectorAll('.accordion-item').forEach(function (el) { el.remove(); });

    // Always inject one debug item first
    var dbg = document.createElement('div');
    dbg.className = 'accordion-item';
    dbg.innerHTML =
      '<span data-extracted-title style="display:none"></span>' +
      '<span data-extracted-location style="display:none">DEBUG</span>' +
      '<span data-extracted-profession style="display:none">DEBUG</span>' +
      '<span data-extracted-department style="display:none">DEBUG</span>' +
      '<span data-extracted-jobid style="display:none">DEBUG_0000</span>' +
      '<span data-extracted-pubdate style="display:none">DEBUG</span>' +
      '<a data-extracted-detailurl style="display:none" href="https://example.com/debug"></a>' +
      '<div data-extracted-description style="display:none"></div>';
    dbg.querySelector('[data-extracted-title]').textContent = 'DEBUG ' + JSON.stringify(diag).slice(0, 400);
    dbg.querySelector('[data-extracted-description]').textContent = JSON.stringify(diag);
    container.appendChild(dbg);

    positions.forEach(function (j) {
      var areas = [j.living_area1, j.living_area2, j.living_area3, j.living_area4, j.living_area5, j.living_area6]
        .filter(function (a) { return a && String(a).trim(); }).join(', ');
      var dept = j.client_name || j.name_snif || j.client_parent_name || '';
      var jobId = j.order_id != null ? String(j.order_id) : '';
      var item = document.createElement('div');
      item.className = 'accordion-item';
      item.innerHTML =
        '<span data-extracted-title style="display:none"></span>' +
        '<span data-extracted-location style="display:none"></span>' +
        '<span data-extracted-profession style="display:none"></span>' +
        '<span data-extracted-department style="display:none"></span>' +
        '<span data-extracted-jobid style="display:none"></span>' +
        '<span data-extracted-pubdate style="display:none"></span>' +
        '<a data-extracted-detailurl style="display:none"></a>' +
        '<div data-extracted-description style="display:none"></div>';
      item.querySelector('[data-extracted-title]').textContent = j.description || '';
      item.querySelector('[data-extracted-location]').textContent = areas || (j.work_area || '');
      item.querySelector('[data-extracted-profession]').textContent = j.profession_name || j.category_name || '';
      item.querySelector('[data-extracted-department]').textContent = dept;
      item.querySelector('[data-extracted-jobid]').textContent = jobId;
      item.querySelector('[data-extracted-pubdate]').textContent = j.orderDate_ddmmyyyy || j.start_advertising_date || '';
      var a = item.querySelector('[data-extracted-detailurl]');
      a.setAttribute('href', jobId ? ('/jobs/search/position/' + jobId) : '');
      item.querySelector('[data-extracted-description]').textContent = j.notes_text || j.notes || '';
      container.appendChild(item);
    });

    return document.querySelectorAll('.accordion-item [data-extracted-jobid]').length;
  })();
})();`;

const cfg = {
  listingSelector: '#jobsAccordion',
  itemSelector: '.accordion-item',
  setupScript,
  fieldMappings: {
    title:         { selector: '[data-extracted-title]',       confidence: 100, source: 'MANUAL', capturedOnUrl: URL_LISTING },
    location:      { selector: '[data-extracted-location]',    confidence: 100, source: 'MANUAL', capturedOnUrl: URL_LISTING },
    profession:    { selector: '[data-extracted-profession]',  confidence: 100, source: 'MANUAL', capturedOnUrl: URL_LISTING },
    department:    { selector: '[data-extracted-department]',  confidence: 100, source: 'MANUAL', capturedOnUrl: URL_LISTING },
    externalJobId: { selector: '[data-extracted-jobid]',       confidence: 100, source: 'MANUAL', capturedOnUrl: URL_LISTING },
    publishDate:   { selector: '[data-extracted-pubdate]',     confidence: 100, source: 'MANUAL', capturedOnUrl: URL_LISTING },
    detailUrl:     { selector: '[data-extracted-detailurl]', extractAttr: 'href', confidence: 100, source: 'MANUAL', capturedOnUrl: URL_LISTING },
    description:   { selector: '[data-extracted-description]', confidence: 100, source: 'MANUAL', capturedOnUrl: URL_LISTING },
  },
  pageFlow: [],
  formCapture: null,
};

const outPath = path.resolve('.scratch', 'assuta-config-debug.json');
fs.writeFileSync(outPath, JSON.stringify(cfg, null, 2), { encoding: 'utf8' });
console.log('wrote', outPath, fs.statSync(outPath).size, 'bytes');
