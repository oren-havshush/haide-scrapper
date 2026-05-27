import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL = 'https://www.ness-tech.co.il/careers/';

const SETUP_SCRIPT = `(function () {
  try {
    var DETAIL_PREFIX = 'https://www.ness-tech.co.il/careers/job/';
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/careers/api/Careers/GetAllItems', false);
    try { xhr.setRequestHeader('accept', 'application/json'); } catch (e) {}
    xhr.send();
    if (xhr.status !== 200) {
      var em = document.createElement('span');
      em.setAttribute('data-haide-setup-error', 'http_' + xhr.status);
      em.style.display = 'none';
      document.body.appendChild(em);
      return;
    }
    var data = JSON.parse(xhr.responseText);
    var list = (data && data.allOrderDetailsList) || [];
    var cards = document.querySelectorAll('.card-job-container');
    for (var i = 0; i < cards.length && i < list.length; i++) {
      var card = cards[i];
      if (card.querySelector('.haide-enrich')) continue;
      var d = list[i] || {};
      var domTitle = '';
      try {
        var liTitle = card.querySelectorAll('ul li')[1];
        if (liTitle) domTitle = (liTitle.textContent || '').replace(/\\s+/g, ' ').trim();
      } catch (e) {}
      if (domTitle && d.title && domTitle.indexOf(d.title.replace(/\\s+/g, ' ').trim()) === -1 &&
          d.title.replace(/\\s+/g, ' ').trim().indexOf(domTitle) === -1) {
        var found = null;
        for (var k = 0; k < list.length; k++) {
          if (list[k] && list[k].title && (list[k].title.indexOf(domTitle) !== -1 || domTitle.indexOf(list[k].title) !== -1)) {
            found = list[k]; break;
          }
        }
        if (found) { d = found; } else { continue; }
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
    }
  } catch (e) {
    var em2 = document.createElement('span');
    em2.setAttribute('data-haide-setup-error', String(e).slice(0, 300));
    em2.style.display = 'none';
    document.body.appendChild(em2);
  }
})();`;

const config = {
  itemSelector: '.card-job-container',
  setupScript: SETUP_SCRIPT,
  fieldMappings: {
    title:          { selector: '.haide-title',         confidence: 100, source: 'MANUAL', capturedOnUrl: URL },
    location:       { selector: '.haide-location',      confidence: 100, source: 'MANUAL', capturedOnUrl: URL },
    description:    { selector: '.haide-description',   confidence: 100, source: 'MANUAL', capturedOnUrl: URL },
    externalJobId:  { selector: '.haide-jobid',         confidence: 100, source: 'MANUAL', capturedOnUrl: URL },
    publishDate:    { selector: '.haide-publish-date',  confidence: 100, source: 'MANUAL', capturedOnUrl: URL },
    department:     { selector: '.haide-department',    confidence: 100, source: 'MANUAL', capturedOnUrl: URL },
    detailUrl:      { selector: '.haide-detail-url',    extractAttr: 'href', confidence: 100, source: 'MANUAL', capturedOnUrl: URL },
    applicationInfo:{ selector: '.haide-detail-url',    confidence: 100, source: 'MANUAL', capturedOnUrl: URL },
    contactEmail:   { selector: '.haide-contact-email', confidence: 100, source: 'MANUAL', capturedOnUrl: URL },
    contactName:    { selector: '.haide-contact-name',  confidence: 100, source: 'MANUAL', capturedOnUrl: URL },
    subDepartment:  { selector: '.haide-subdept',       confidence: 100, source: 'MANUAL', capturedOnUrl: URL },
    isHot:          { selector: '.haide-is-hot',        confidence: 100, source: 'MANUAL', capturedOnUrl: URL },
  },
  pageFlow: [],
  formCapture: null,
};

const outPath = path.join(os.tmpdir(), 'scrap-ness-config.json');
fs.writeFileSync(outPath, JSON.stringify(config, null, 2), 'utf8');
console.log('Wrote', outPath, 'size=', fs.statSync(outPath).size);
console.log('setupScript chars:', SETUP_SCRIPT.length);
