// karnitmelamed.com/דרושים (WordPress + Elementor Pro), listing-only, no job pages. Each job is one item of the
// page's Elementor toggle: a.elementor-toggle-title + .elementor-tab-content; the body is in the DOM unclicked.
// No printed number, no per-job URL -> no id emitted; the worker builds the h- id itself (addsite3 6.2).
// Body: "תיאור התפקיד" / "דרישות התפקיד" labels dropped; the requirements section goes to requirements up to the
// "* ..." terms lines (scope, days, pay, equal-opportunity), which stay in the description.
// Location: the ads name no place; the clinic prints one address (מאפו 18, תל אביב) -> תל אביב-יפו (LRN-LOC-20),
// unless the ad has a work-location or field-work line, then Unknown.
// Apply: the page's one Elementor form (KmOnline, form_id e291bd7), one blob per job with the free-text
// message box form_fields[message] = the job title, so a submit names the job (LRN-FORM-13).
if (document.getElementById('haide-km')) return;
var tg = document.querySelector('.elementor-toggle');
if (!tg) { console.warn('[km] toggle not found'); return; }
var NB = String.fromCharCode(160);
var clean = function (s) { return String(s || '').split(NB).join(' ').replace(/\s+/g, ' ').trim(); };
var OK1 = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var LBL_D = /^(תיאור התפקיד|תיאור משרה|תיאור)\s*:?$/;
var LBL_R = /^(דרישות התפקיד|דרישות|דרישות המשרה)\s*:?$/;
var CUE = /(מיקום|מקום העבודה|העבודה ב|המשרה ממוקמת|באזור |עבודת שטח|אצל לקוחות|ברחבי הארץ)/;
var SITE_CITY = 'תל אביב-יפו';
var lines = function (el) {
  var c = el.cloneNode(true);
  c.querySelectorAll('br, p, div, li, h1, h2, h3, h4, h5, h6, ul, ol').forEach(function (e) { e.insertAdjacentText('afterend', '\n'); });
  return c.textContent.split('\n').map(clean).filter(function (l) { return /[\p{L}\d]/u.test(l); });
};
// --- the apply blob: the page's own form, fields as the server renders them (CRM tracking inputs added
// later by a third-party script are left out); the message box carries the job title ---
var fm = document.querySelector('form.elementor-form input[name="form_id"][value="e291bd7"]');
fm = fm ? fm.closest('form') : null;
if (!fm) { console.warn('[km] apply form not found'); return; }
var FIELDS = [];
fm.querySelectorAll('input, select, textarea').forEach(function (e) {
  var ft = (e.tagName === 'INPUT' ? (e.getAttribute('type') || 'text') : e.tagName.toLowerCase()).toLowerCase();
  if (/^(submit|button|reset|image)$/.test(ft) || !e.name) return;
  if (!/^(post_id|form_id|referer_title|queried_id)$/.test(e.name) && e.name.indexOf('form_fields[') !== 0) return;
  var lb = e.id ? fm.querySelector('label[for="' + e.id + '"]') : null;
  var o = { name: e.name, label: clean(lb ? lb.textContent : (e.getAttribute('placeholder') || '')), fieldType: ft, tagName: e.tagName,
    required: e.hasAttribute('required') };
  if (ft === 'hidden') o.value = e.getAttribute('value') || '';
  if (ft === 'file' && e.getAttribute('accept')) o.accept = e.getAttribute('accept');
  FIELDS.push(o);
});
var PAGE = location.origin + location.pathname;
var blobOf = function (title) {
  return JSON.stringify({ actionUrl: location.origin + '/wp-admin/admin-ajax.php', actionAttribute: '', formClass: fm.getAttribute('class') || '',
    formTag: 'form', method: 'POST', enctype: 'multipart/form-data', pageUrl: PAGE,
    fields: FIELDS.map(function (o) { var k = Object.assign({}, o); if (k.name === 'form_fields[message]') k.value = title; return k; }) });
};
// --- the items ---
var root = document.createElement('div');
root.id = 'haide-km';
root.style.display = 'none';
var dropped = [];
tg.querySelectorAll('.elementor-toggle-item').forEach(function (item) {
  var tEl = item.querySelector('.elementor-toggle-title'), body = item.querySelector('.elementor-tab-content');
  var title = clean(tEl && tEl.textContent);
  if (!title || !body) return;
  if (!OK1.test(title) || BAD.test(title)) { dropped.push(title + ':lang'); return; }
  var d = [], r = [], sec = 'd', all = lines(body);
  all.forEach(function (l) {
    if (LBL_D.test(l)) { sec = 'd'; return; }
    if (LBL_R.test(l)) { sec = 'r'; return; }
    if (/^\*/.test(l)) sec = 'd';
    (sec === 'r' ? r : d).push(l);
  });
  var loc = all.some(function (l) { return CUE.test(l); }) ? 'Unknown' : SITE_CITY;
  var it = document.createElement('div');
  it.className = 'haide-job wp-exclude-emoji';
  var add = function (cls, v) { var e = document.createElement('span'); e.className = cls + ' wp-exclude-emoji'; e.textContent = v; it.appendChild(e); };
  add('__ai-title', title);
  if (d.length) add('__ai-description', d.join('\n'));
  if (r.length) add('__ai-requirements', r.join('\n'));
  add('__ai-location', loc);
  var blob = blobOf(title);
  add('__ai-applicationInfo', blob);
  add('__ai-formData', blob);
  root.appendChild(it);
});
document.body.appendChild(root);
console.log('[km] jobs ' + root.children.length + ', dropped ' + dropped.join(' '));
