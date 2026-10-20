// kaufman-group.co.il/קריירה (custom "flexi" CMS), listing-only, no job pages, no fetches.
// Every job is one accordion row li.page_job; title, body and the job's own apply form are in the server HTML.
// The script builds one hidden div.haide-job per row inside #haide-kaufman.
// - id: none emitted. The printed "משרה מס׳" (hidden job_id) is not unique (two different jobs carry 3, a third
//   carries 03) and the site has reused numbers for other jobs (Wayback: 08 and 09 were sales/branch-manager ads in
//   2021); no CMS record id in the row. The worker builds h-<hash> from the title (addsite3 6.2, LRN-ID-5).
// - title: the row's title span; the number sits in its own <strong> and is not part of it (rule 7).
// - description / requirements: the row's .page_job_form_desc, line by line; the "התפקיד כולל:" label and the
//   "דרישות:" heading are dropped; lines under the heading go to requirements, except scope, hours, pay, terms and
//   the equal-opportunity line, which stay in the description. List items stay list items.
// - location: the row's own area tag (hidden input "area", comma-joined) as printed, read through the config's
//   locationMap. A city named in the title, the ad's first line or an "העבודה ב..." line refines it when it lies
//   inside the tag's area (or the tag is "כל הארץ"); a city outside the tag's area keeps the tag (4-case rule).
// - apply: the row's own form, as the page's script sends it (AJAX POST multipart, FormData of the form, to
//   /קריירה?action=submit): hidden job_id/title/area with this row's values, hidden "labels" (static), name*,
//   email*, phone*, date (birth date, optional), file (CV). The mobile twin "sp_file" (same CV upload, shown only on
//   phones) is left out. No captcha, no consent box. One blob per job.
if (document.getElementById('haide-kaufman')) return;
var ITEM = 'li.page_job';
var prev = -1, stable = 0;
for (var t = 0; t < 40; t++) {
  var n = document.querySelectorAll(ITEM).length;
  if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n;
  await new Promise(function (r) { setTimeout(r, 250); });
}
var NB = String.fromCharCode(160);
var clean = function (s) { return String(s || '').split(NB).join(' ').replace(/\s+/g, ' ').trim(); };
var OK1 = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}]/u;
var BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var LBL_D = /^(התפקיד כולל|תיאור התפקיד|תיאור המשרה|תיאור)\s*:?$/;
var LBL_R = /^(דרישות|דרישות התפקיד|דרישות המשרה|דרישות לתפקיד)\s*:?$/;
var STAY = /^(משרה מלאה|משרה חלקית|שעות עבודה|שעות|תנאים|שכר|בונוס|הסעות|קליטה|המודעה פונה|המשרה מיועדת|המשרה פונה)/;
// closed table of places a cue line may name: label as emitted -> [pattern, region tag(s) it lies in]
var PLACES = [
  ['ראש העין', /(^|[\s\-ב])ראש העין(?=$|[\s,.\-!:)])/, ['מרכז']],
  ['כפר סבא', /(^|[\s\-ל])כפר[\s\-]סבא(?=$|[\s,.\-!:)])/, ['השרון']],
  ['רעננה', /(^|[\s\-ב])רעננה(?=$|[\s,.\-!:)])/, ['השרון']],
  ['נתניה', /(^|[\s\-ב])נתניה(?=$|[\s,.\-!:)])/, ['השרון']],
  ['חדרה', /(^|[\s\-ב])חדרה(?=$|[\s,.\-!:)])/, ['השרון']]
];
// tags that name one city: tag -> that city's PLACES label
var TAG_CITY = { 'מטה - לב הארץ - ראש העין': 'ראש העין' };
var CUE = /^העבודה ב/;
var linesOf = function (box) {
  var out = [];
  if (!box) return out;
  var kids = box.children;
  for (var k = 0; k < kids.length; k++) {
    var el = kids[k];
    if (el.tagName === 'UL' || el.tagName === 'OL') {
      // an <li> can carry a second paragraph after <br><br> ("...במשרה מלאה<br><br>המודעה פונה..."): its own line
      el.querySelectorAll('li').forEach(function (li) {
        var c = li.cloneNode(true);
        c.querySelectorAll('br').forEach(function (b) { b.replaceWith('\n'); });
        String(c.textContent || '').split('\n').map(clean).filter(Boolean).forEach(function (s, i) { out.push({ t: s, li: i === 0 }); });
      });
    } else {
      var c = el.cloneNode(true);
      c.querySelectorAll('br').forEach(function (b) { b.replaceWith('\n'); });
      String(c.textContent || '').split('\n').forEach(function (x) { x = clean(x); if (x) out.push({ t: x, li: false }); });
    }
  }
  return out;
};
var render = function (cls, ls) {
  var d = document.createElement('div');
  d.className = cls;
  var ul = null;
  ls.forEach(function (l) {
    if (l.li) {
      if (!ul) { ul = document.createElement('ul'); d.appendChild(ul); }
      var li = document.createElement('li'); li.textContent = l.t; ul.appendChild(li);
    } else {
      ul = null;
      var p = document.createElement('p'); p.textContent = l.t; d.appendChild(p);
    }
  });
  return d;
};
var placesIn = function (s) {
  var out = [];
  PLACES.forEach(function (p) { if (p[1].test(s) && out.indexOf(p[0]) < 0) out.push(p[0]); });
  return out;
};
var regionOf = function (label) { for (var i = 0; i < PLACES.length; i++) if (PLACES[i][0] === label) return PLACES[i][2]; return []; };
var where = function (tags, title, ls) {
  var cue = [title];
  if (ls.length) cue.push(ls[0].t);
  ls.forEach(function (l) { if (CUE.test(l.t)) cue.push(l.t); });
  var txt = [];
  cue.forEach(function (s) { placesIn(s).forEach(function (p) { if (txt.indexOf(p) < 0) txt.push(p); }); });
  if (!txt.length) return tags;
  var tagCities = tags.map(function (g) { return TAG_CITY[g]; }).filter(Boolean);
  // case 2: the tag's city is named and more places are added -> all of them
  if (tagCities.some(function (c) { return txt.indexOf(c) >= 0; })) return tags.concat(txt.filter(function (c) { return tagCities.indexOf(c) < 0; }));
  // case 1: every named city lies inside the tag's area (or the tag is the whole country) -> the cities
  var inside = txt.every(function (c) {
    return tags.some(function (g) { return g === 'כל הארץ' || regionOf(c).indexOf(g) >= 0; });
  });
  return inside ? txt : tags; // case 3: a place outside the tag -> keep the tag
};
var root = document.createElement('div');
root.id = 'haide-kaufman';
root.style.display = 'none';
var dropped = [];
document.querySelectorAll(ITEM).forEach(function (row) {
  var fm = row.querySelector('form.page_job_form');
  var hid = function (nm) { var e = fm && fm.querySelector('input[name="' + nm + '"]'); return e ? e.getAttribute('value') || '' : ''; };
  var title = clean((row.querySelector('.page_job_title span') || {}).textContent) || clean(hid('title'));
  var num = hid('job_id');
  if (!title) { dropped.push((num || '?') + ':no-title'); return; }
  if (!OK1.test(title) || BAD.test(title)) { dropped.push(num + ':lang'); return; }
  var all = linesOf(row.querySelector('.page_job_form_desc'));
  var d = [], r = [], sec = 'd';
  all.forEach(function (l) {
    if (LBL_D.test(l.t)) { sec = 'd'; return; }
    if (LBL_R.test(l.t)) { sec = 'r'; return; }
    (sec === 'r' && !STAY.test(l.t) ? r : d).push(l);
  });
  var tags = hid('area').split(',').map(clean).filter(Boolean);
  var loc = where(tags, title, all.filter(function (l) { return !LBL_D.test(l.t) && !LBL_R.test(l.t); }));
  var it = document.createElement('div');
  it.className = 'haide-job';
  var add = function (cls, v) { var e = document.createElement('span'); e.className = cls; e.textContent = v; it.appendChild(e); };
  add('__ai-title', title);
  if (d.length) it.appendChild(render('__ai-description', d));
  if (r.length) it.appendChild(render('__ai-requirements', r));
  if (loc.length) add('__ai-location', loc.join(' | '));
  if (fm) {
    var fields = [];
    fm.querySelectorAll('input, select, textarea').forEach(function (e) {
      var ft = (e.tagName === 'INPUT' ? (e.getAttribute('type') || 'text') : e.tagName.toLowerCase()).toLowerCase();
      var nm = e.getAttribute('name');
      if (!nm || /^(submit|button|reset|image)$/.test(ft) || nm === 'sp_file') return;
      var lf = e.id ? fm.querySelector('label[for="' + e.id + '"]') : null;
      var o = { name: nm, label: clean(e.getAttribute('data-label') || e.getAttribute('aria-label') || (lf && (lf.getAttribute('aria-label') || lf.textContent)) || nm), fieldType: ft, tagName: e.tagName,
        required: e.getAttribute('aria-required') === 'true' || e.classList.contains('required') };
      if (ft === 'hidden') o.value = e.getAttribute('value') || '';
      fields.push(o);
    });
    if (!fields.some(function (f) { return f.name === 'labels'; })) {
      var lab = {};
      fm.querySelectorAll('[name]').forEach(function (e) { var k = e.getAttribute('name').split('[')[0]; if (lab[k] === undefined && e.getAttribute('data-label')) lab[k] = e.getAttribute('data-label'); });
      fields.push({ name: 'labels', label: 'labels', fieldType: 'hidden', tagName: 'INPUT', required: false, value: JSON.stringify(lab) });
    }
    var act = new URL(fm.getAttribute('action') || location.href, location.href).href;
    var blob = JSON.stringify({ actionUrl: act, actionAttribute: fm.getAttribute('action') || '', formClass: fm.getAttribute('class') || '',
      formTag: 'form', method: 'POST', enctype: 'multipart/form-data', fields: fields });
    add('__ai-applicationInfo', blob);
    add('__ai-formData', blob);
  }
  root.appendChild(it);
});
document.body.appendChild(root);
console.log('[kaufman] rows ' + document.querySelectorAll(ITEM).length + ', jobs ' + root.children.length + ', dropped ' + dropped.join(' '));
