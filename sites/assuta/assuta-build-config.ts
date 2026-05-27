import * as fs from 'fs';
import * as path from 'path';

const URL_LISTING = 'https://www.assuta.co.il/jobs/search/';

const setupScript = `(function () {
  return (async function () {
    try {
      var resp = await fetch('/api/job-positions/get-jobs', { credentials: 'same-origin' });
      if (!resp.ok) return -2;
      var data = await resp.json();
      var positions = (data && data.positions) || [];
      var container = document.querySelector('#jobsAccordion') ||
                      document.querySelector('[class*="JobsAccordion_itemsContainer"]') ||
                      document.querySelector('.accordion');
      if (!container) {
        container = document.createElement('div');
        container.id = 'jobsAccordion';
        document.body.appendChild(container);
      }
      container.querySelectorAll('.accordion-item').forEach(function (el) { el.remove(); });

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
    } catch (e) { return -1; }
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

const outPath = path.resolve('.scratch', 'assuta-config.json');
fs.writeFileSync(outPath, JSON.stringify(cfg, null, 2), { encoding: 'utf8' });
console.log('wrote', outPath, fs.statSync(outPath).size, 'bytes');
console.log('itemSelector:', cfg.itemSelector);
console.log('listingSelector:', cfg.listingSelector);
console.log('setupScript len:', setupScript.length);
console.log('fields:', Object.keys(cfg.fieldMappings).join(', '));
