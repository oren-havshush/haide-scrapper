// j-t.org.il/#/careers (תחבורה לירושלים): a hash-routed React SPA on WordPress, listing-only config.
//
// The listing renders li.careers-list__item > a.careers-row[href="#/careers/<tender id>"], each card with
// the printed "מספר משרה" (JT001...) and the title. A job's body exists only on its #/careers/<id> route,
// which the SPA draws from the site's own content JSON (window.__JT_SITE_CONTENT__.he, the same data as
// GET /wp-json/jt/v1/content?lang=he). The worker never opens the hash routes; this script reads that JSON
// once and writes each job's fields into its card.
//
// - title: the card title as printed.
// - externalJobId: the printed job number, as j-t-<number> (letters kept). No number -> no id emitted.
// - detailUrl: the job's own route, absolute.
// - description / requirements: the job's sections in page order. Sections titled דרישות... / כישורים...
//   go to requirements (their titles kept, they tell threshold from advantage); a paragraph inside them that
//   only says the role's scope may change ("מובהר כי" / "יובהר כי") stays in description. The generic labels
//   "על המשרה" / "על התפקיד" are dropped; every other section title is kept as a line. Text as printed.
//   A listed job with no body in the JSON (the page shows "content will be published soon") gets none.
// - location: ירושלים on every job, a site rule set by the owner (2026-10-12): no ad names its work place and
//   the org's only address is in Jerusalem. Injected, so the gazetteer does not guess from prose.
// - applicationInfo / _formData: the job's own apply form. The SPA posts multipart FormData to
//   /wp-json/jt/v1/career-application with jobNumber, jobTitle, jobTitleHe added by script, so the blob
//   carries them as hidden fields with this job's values. The "I'm not a robot" box is a plain required
//   checkbox drawn by the page (no Google script, nothing sent), so it is not a field.
var ITEM_SEL = 'li.careers-list__item';
var prev = -1, stable = 0;
for (var t = 0; t < 60; t++) {
  var n = document.querySelectorAll(ITEM_SEL).length;
  if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n;
  await new Promise(function (r) { setTimeout(r, 500); });
}

var data = null;
try { data = window.__JT_SITE_CONTENT__ && window.__JT_SITE_CONTENT__.he; } catch (e) { data = null; }
if (!data || !data.careers) {
  try {
    var resp = await fetch(location.origin + '/wp-json/jt/v1/content?lang=he', { credentials: 'same-origin' });
    if (resp.ok) data = await resp.json();
  } catch (e) { data = null; }
}
var careers = (data && data.careers) || { listings: [], jobs: {} };
var listings = careers.listings || [];
var bodies = careers.jobs || {};

var REQ_T = /^(דרישות|כישורים)/;
var DROP_T = /^(על המשרה|על התפקיד)$/;
var SCOPE_P = /^(מובהר|יובהר) כי/;

var clean = function (s) { return String(s || '').replace(/\s+/g, ' ').trim(); };
var render = function (cls, rows) {
  var box = document.createElement('div'), ul = null;
  box.className = cls; box.style.display = 'none';
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r.li) {
      if (!ul) { ul = document.createElement('ul'); box.appendChild(ul); }
      var li = document.createElement('li'); li.textContent = r.t; ul.appendChild(li);
    } else {
      ul = null;
      var p = document.createElement('p'); p.textContent = r.t; box.appendChild(p);
    }
  }
  return box;
};
var hidden = function (cls, text, href) {
  var e = document.createElement(href ? 'a' : 'span');
  e.className = cls; e.style.display = 'none'; e.textContent = text;
  if (href) e.setAttribute('href', href);
  return e;
};

var items = document.querySelectorAll(ITEM_SEL);
for (var i = 0; i < items.length; i++) {
  var item = items[i];
  try {
    if (item.querySelector('.__ai-title')) continue;
    var a = item.querySelector('a.careers-row');
    var m = a ? /#\/careers\/([^/?#]+)$/.exec(a.getAttribute('href') || '') : null;
    if (!m) continue;
    var key = decodeURIComponent(m[1]);
    var tEl = item.querySelector('.careers-row__title');
    var title = clean(tEl ? tEl.textContent : '');
    var meta = item.querySelectorAll('.careers-row__meta span');
    var num = clean(meta.length > 1 ? meta[meta.length - 1].textContent : '');
    var lst = null;
    for (var k = 0; k < listings.length; k++) if (listings[k].id === key) { lst = listings[k]; break; }
    if (!num && lst) num = clean(lst.number);
    var body = bodies[key] || null;

    var desc = [], req = [];
    var secs = (body && body.sections) || [];
    for (var s = 0; s < secs.length; s++) {
      var sec = secs[s] || {};
      var st = clean(sec.title);
      var isReq = REQ_T.test(st);
      var target = isReq ? req : desc;
      if (st && !DROP_T.test(st)) target.push({ t: st, li: false });
      var ps = sec.paragraphs || [];
      for (var q = 0; q < ps.length; q++) {
        var pt = clean(ps[q]);
        if (!pt) continue;
        (isReq && SCOPE_P.test(pt) ? desc : target).push({ t: pt, li: false });
      }
      var bs = sec.bullets || [];
      for (var b = 0; b < bs.length; b++) {
        var bt = clean(bs[b]);
        if (bt) target.push({ t: bt, li: true });
      }
    }

    var url = location.origin + '/#/careers/' + encodeURIComponent(key);
    item.appendChild(hidden('__ai-title', title));
    if (/^[A-Za-z]+\d+$/.test(num)) item.appendChild(hidden('__ai-jobid', 'j-t-' + num));
    item.appendChild(hidden('__ai-detailUrl', url, url));
    item.appendChild(render('__ai-description', desc));
    item.appendChild(render('__ai-requirements', req));
    item.appendChild(hidden('__ai-location', 'ירושלים'));

    var jobTitle = (body && clean(body.heroTitle)) || (lst && clean(lst.title)) || title;
    var senior = !!((body && body.isSenior) || (lst && lst.isSenior));
    var f = function (name, label, type, req2, extra) {
      var o = { name: name, label: label, fieldType: type, required: req2, tagName: type === 'textarea' ? 'TEXTAREA' : 'INPUT' };
      if (extra) for (var x in extra) o[x] = extra[x];
      return o;
    };
    var ACCEPT = '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    var fields = [
      f('jobNumber', '', 'hidden', false, { value: num }),
      f('jobTitle', '', 'hidden', false, { value: jobTitle }),
      f('jobTitleHe', '', 'hidden', false, { value: jobTitle }),
      f('firstName', 'שם פרטי', 'text', true),
      f('lastName', 'שם משפחה', 'text', true),
      f('email', 'אימייל', 'email', true),
      f('phone', 'טלפון', 'tel', true),
      f('notes', 'הערות', 'textarea', false),
      f('lang', '', 'hidden', false, { value: 'he' }),
      f('cv', 'קובץ קורות חיים', 'file', true, { accept: ACCEPT })
    ];
    if (senior) fields.push(f('questionnaire', 'העלאת קובץ תשובות', 'file', true, { accept: ACCEPT }));
    fields.push(f('extraFiles[]', 'קבצים נוספים', 'file', false, { multiple: true }));
    var EP = location.origin + '/wp-json/jt/v1/career-application';
    var blob = JSON.stringify({ actionUrl: EP, actionAttribute: EP, method: 'POST', enctype: 'multipart/form-data', fields: fields });
    item.appendChild(hidden('__ai-applicationInfo', blob));
    item.appendChild(hidden('__ai-formData', blob));
  } catch (e) { /* one bad card never stops the rest */ }
}
