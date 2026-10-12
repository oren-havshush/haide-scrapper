/* Colmex, Comeet board cglms/69.003. Runs on listing AND detail pages.
   LISTING: keep IL rows only, by the board's own data keyed by position UID (LRN-SPA-16; all rows
   are IL today). Department and city come from the position data. Id = Comeet position UID.
   DETAIL: Description block (descriptionFieldContent, LRN-SPA-21) -> description,
   Requirements block -> requirements (LRN-SPA-13).
   Apply (LRN-FORM-13): this job's own blob (careers.js multipart names) -> applicationInfo,
   _formData; reCAPTCHA v3 token is browser-made: empty hidden field. */

var NL = String.fromCharCode(10);
/* fromCharCode: invisible chars in a regex literal have disabled a guard before (CLAUDE.md). */
var ZW = new RegExp('[' + String.fromCharCode(0xFEFF, 0x200B, 0x200C, 0x200D, 0x2060) + ']', 'g');
var NBSP = new RegExp(String.fromCharCode(0x00A0), 'g');

function aiClean(t) {
  t = String(t || '').replace(ZW, '').replace(NBSP, ' ');
  var lines = t.split(NL), out = [];
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i].replace(/[ \t]+/g, ' ').trim();
    if (!l) { if (out.length && out[out.length - 1] !== '') out.push(''); continue; }
    out.push(l);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join(NL).trim();
}

/* textContent alone collapses the block to one run-on line. */
function structuredText(el) {
  if (!el) return '';
  var c = el.cloneNode(true), i;
  var kill = c.querySelectorAll('style,script,link,meta,iframe,img,noscript,form,button,svg');
  for (i = kill.length - 1; i >= 0; i--) kill[i].parentNode.removeChild(kill[i]);
  var brk = c.querySelectorAll('p,div,ul,ol,li,br,h1,h2,h3,h4,h5,h6,tr');
  for (i = 0; i < brk.length; i++) brk[i].insertAdjacentText('afterend', NL);
  return aiClean(c.textContent || '');
}

function aiInject(host, cls, val) {
  if (!host || !val || host.querySelector('.' + cls)) return;
  var s = document.createElement('span');
  s.className = cls;
  s.style.display = 'none';
  s.textContent = val;
  host.appendChild(s);
}

/* The separator before the position UID varies (/None/, /_-/, /<slug>/); take the last path segment. */
function uidFromHref(href) {
  var clean = String(href || '').split(/[?#]/)[0].replace(/\/+$/, '');
  var segs = clean.split('/'), out = '', i;
  for (i = 0; i < segs.length; i++) if (segs[i]) out = segs[i];
  return out;
}

/* city.csv verbatim; an unmapped city injects Unknown (LRN-LOC-4). */
var CITY = { 'tel aviv-yafo': 'תל אביב-יפו', 'tel aviv': 'תל אביב-יפו' };

/* Language gate on the title: Hebrew or Latin letters only (owner, 2026-09-27). */
var OK = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u;
var BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;

var onDetail = !!document.querySelector('[data-qa="descriptionFieldContent"], [data-qa="requirementFieldContent"]');

/* ---------------- LISTING SCOPE ---------------- */
if (!onDetail) {
  var prev = -1, stable = 0;
  for (var t = 0; t < 40; t++) {
    var n = document.querySelectorAll('a.positionItem').length;
    if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
    prev = n;
    await new Promise(function (r) { setTimeout(r, 500); });
  }

  var byUid = {};
  var data = window.COMPANY_POSITIONS_DATA;
  if (data && data.length) {
    for (var d = 0; d < data.length; d++) if (data[d] && data[d].uid) byUid[data[d].uid] = data[d];
  }

  var items = document.querySelectorAll('a.positionItem');
  for (var i = 0; i < items.length; i++) {
    var a = items[i];
    var li = a.closest('li');
    if (!li || li.querySelector('.__ai-jobid')) continue;
    var uid = uidFromHref(a.getAttribute('href'));
    var pos = byUid[uid];
    var loc = pos && pos.location ? pos.location : null;
    /* No data for this UID -> fall back to the group heading printed above the row. */
    var heading = '';
    if (!loc) {
      var g = li.closest('ul');
      while (g && !heading) {
        g = g.previousElementSibling;
        if (g && String(g.className || '').indexOf('positionsGroupTitle') !== -1) heading = (g.textContent || '').replace(/\s+/g, ' ').trim();
      }
    }
    var isIL = loc ? loc.country === 'IL' : /^israel\b/i.test(heading);
    var title = ((a.querySelector('.positionLink') || {}).textContent || '').replace(/\s+/g, ' ').trim();
    if (!isIL || !title || !OK.test(title) || BAD.test(title)) {
      if (li.parentNode) li.parentNode.removeChild(li);
      continue;
    }
    aiInject(li, '__ai-jobid', uid);
    if (pos && pos.department) aiInject(li, '__ai-department', String(pos.department).replace(/\s+/g, ' ').trim());
    var cityRaw = loc && loc.city ? loc.city : heading.replace(/^israel\s*,?\s*/i, '');
    var city = CITY[String(cityRaw).replace(/\s+/g, ' ').trim().toLowerCase()];
    aiInject(li, '__ai-location', city || 'Unknown');
  }
}

/* ---------------- DETAIL SCOPE ---------------- */
if (onDetail && !document.querySelector('[data-ai-detail]')) {
  var box = document.createElement('div');
  box.setAttribute('data-ai-detail', '1');
  box.style.display = 'none';

  var desc = [], req = [];
  var secs = document.querySelectorAll('[data-qa="descriptionFieldContent"], [data-qa="requirementFieldContent"]');
  for (var s2 = 0; s2 < secs.length; s2++) {
    var sec = secs[s2];
    var h = sec.parentElement ? sec.parentElement.querySelector('[data-qa="descriptionFieldTitle"], [data-qa="requirementFieldTitle"]') : null;
    var label = h ? (h.textContent || '').replace(/\s+/g, ' ').trim() : '';
    /* A line that only restates the field name (Job Description:, דרישות התפקיד:) is a label: dropped. */
    var body = aiClean(structuredText(sec).split(NL).filter(function (l) {
      return !/^(job description|description|job requirements|requirements|תיאור המשרה|תיאור התפקיד|דרישות התפקיד|דרישות המשרה)\s*:?$/i.test(l.trim());
    }).join(NL));
    if (!body) continue;
    var isReq = /requirement|qualification|skill|advantage|nice to have|דרישות|כישורים|יתרון/i.test(label);
    var restates = /^(description|job description|requirements|qualifications|skills)$/i.test(label);
    (isReq ? req : desc).push((label && !restates) ? (label + ':' + NL + body) : body);
  }
  if (desc.length) {
    var dd = document.createElement('div');
    dd.className = '__ai-description';
    dd.textContent = desc.join(NL + NL);
    box.appendChild(dd);
  }
  if (req.length) {
    var rr = document.createElement('div');
    rr.className = '__ai-requirements';
    rr.textContent = req.join(NL + NL);
    box.appendChild(rr);
  }
  var eEl = document.querySelector('[data-qa="headerEmploymentType"]');
  var emp = eEl ? (eEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
  if (emp) {
    var ee = document.createElement('div');
    ee.className = '__ai-employmentType';
    ee.textContent = emp;
    box.appendChild(ee);
  }
  var puid = uidFromHref(location.pathname);
  if (/^\w+\.\w+$/.test(puid)) {
    var api = 'https://www.comeet.co/careers-api/1.0/company/69.003/positions/' + puid + '/apply';
    var F = [['first_name', 'First name', 'text', 1], ['last_name', 'Last name', 'text', 1], ['email', 'Email', 'email', 1],
      ['phone', 'Phone', 'tel', 1], ['cv', 'Resume', 'file', 1], ['links', 'Personal website', 'url', 0],
      ['attachments', 'Cover Letter', 'file', 0], ['attachments', 'Portfolio', 'file', 0],
      ['comment', 'Personal note', 'textarea', 0], ['grecaptcha_token', '', 'hidden', 0]];
    var flds = F.map(function (x) {
      var o = { name: x[0], label: x[1], fieldType: x[2], required: !!x[3], tagName: x[2] === 'textarea' ? 'TEXTAREA' : 'INPUT' };
      if (x[2] === 'hidden') o.value = '';
      return o;
    });
    var ap = document.createElement('div');
    ap.className = '__ai-apply';
    ap.textContent = JSON.stringify({ actionUrl: api, actionAttribute: api, method: 'POST', enctype: 'multipart/form-data', fields: flds });
    box.appendChild(ap);
  }
  if (box.childNodes.length) document.body.appendChild(box);
}
