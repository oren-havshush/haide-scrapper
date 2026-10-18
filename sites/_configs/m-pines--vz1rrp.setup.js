// m-pines.com/דרושים: WordPress, theme qs-starter, one page of accordion cards (.wrap_career_row), no pager,
// no job pages. Each card holds the title, an info line (experience | scope), the sections "תיאור משרה" and
// "דרישות התפקיד", and its own Contact Form 7 form (form 97) with a hidden "career-title" field that the
// page's own script fills with the card's data-title when the visitor opens the card.
// - description: the info line, then the "תיאור משרה" lines; a "מה צריך?" line is a requirement and moves.
//   requirements: the "דרישות התפקיד" lines. Section labels dropped, line breaks kept, text as printed.
// - id: no job number and no job address, so no id is emitted; the worker builds an h- id from the title.
//   The title is not a link, so the jobs carry no per-job url.
// - location: only a work-location line names the place (closed list of city.csv rows); רמלה is the
//   city.csv row "רמלה לוד".
// - apply: the card's own CF7 form, one blob per job, with career-title set to the card's data-title
//   as the page's click does; the reCAPTCHA token is browser-made and stored empty.
if (document.getElementById('haide-pines')) return;
if (!document.querySelector('.wrap_career_row')) return;
var T0 = Date.now();
var NB = String.fromCharCode(160);
var WS = new RegExp('[ \\t' + NB + ']+', 'g');
var OK1 = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var MATH = new RegExp('[' + String.fromCodePoint(0x1D400) + '-' + String.fromCodePoint(0x1D7FF) + ']', 'gu');
var clean = function (s) { return String(s || '').replace(WS, ' ').replace(/\s+/g, ' ').trim(); };
var linesOf = function (w) {
  if (!w) return [];
  var c = w.cloneNode(true);
  c.querySelectorAll('script, style, svg').forEach(function (e) { e.remove(); });
  c.querySelectorAll('br').forEach(function (e) { e.replaceWith('\n'); });
  c.querySelectorAll('p, li, div, h1, h2, h3, h4, h5, h6, tr').forEach(function (e) { e.appendChild(document.createTextNode('\n')); });
  return (c.textContent || '').split('\n').map(function (l) { return l.replace(WS, ' ').trim(); }).filter(function (l) { return l; });
};
var NEED = /^מה צריך\s*\?/;
// work-location lines: a place from the closed list on a line that says where the work or the company is
var CUE = /(מיקום|ממשרדי|במשרדי|יושבת|ממוקמ|עבודה ב)/;
var PLACES = [
  ['רמלה לוד', /(^|[^א-ת])ב?רמלה(?![א-ת])/],
  ['קרית גת', /(^|[^א-ת])ב?קריי?ת גת(?![א-ת])/],
  ['רבדים', /(^|[^א-ת])ב?רבדים(?![א-ת])/]
];
var placeOf = function (lines) {
  var out = [];
  lines.forEach(function (l) {
    if (!CUE.test(l)) return;
    PLACES.forEach(function (p) { if (p[1].test(l) && out.indexOf(p[0]) < 0) out.push(p[0]); });
  });
  return out;
};
var blobOf = function (row, title) {
  var fm = row.querySelector('form.wpcf7-form');
  if (!fm) return '';
  var id = (fm.querySelector('input[name="_wpcf7"]') || {}).value || '';
  if (!/^\d+$/.test(id)) return '';
  var fields = [];
  fm.querySelectorAll('input, select, textarea').forEach(function (e) {
    var ft = (e.tagName === 'INPUT' ? (e.getAttribute('type') || 'text') : e.tagName.toLowerCase()).toLowerCase();
    if (/^(submit|button|reset|image)$/.test(ft) || !e.name) return;
    var lab = e.getAttribute('placeholder') || '';
    if (ft === 'file') { var u = row.querySelector('.upload_resume_label'); if (u) lab = u.textContent; }
    var o = { name: e.name, label: clean(lab).replace(/:$/, ''), fieldType: ft, tagName: e.tagName,
      required: e.hasAttribute('required') || e.getAttribute('aria-required') === 'true' };
    if (ft === 'hidden') o.value = e.getAttribute('value') || '';
    if (e.name === '_wpcf7_recaptcha_response') o.value = '';
    if (e.name === 'career-title') { o.value = title; o.label = 'career-title'; }
    if (ft === 'file' && e.getAttribute('accept')) o.accept = e.getAttribute('accept');
    fields.push(o);
  });
  return JSON.stringify({ actionUrl: location.origin + '/wp-json/contact-form-7/v1/contact-forms/' + id + '/feedback',
    actionAttribute: fm.getAttribute('action') || '', formClass: fm.getAttribute('class') || '', formTag: 'form',
    method: 'POST', enctype: 'multipart/form-data', pageUrl: location.href.split('#')[0], fields: fields });
};
var root = document.createElement('div');
root.id = 'haide-pines';
root.style.display = 'none';
var dropped = [];
document.querySelectorAll('.wrap_career_row').forEach(function (row) {
  var title = clean((row.querySelector('.post_title') || {}).textContent).replace(MATH, function (ch) { return ch.normalize('NFKC'); });
  if (!title) return;
  if (!OK1.test(title) || BAD.test(title)) { dropped.push(title + ':lang'); return; }
  var D = [], R = [];
  var info = clean((row.querySelector('.career_nisayon') || {}).textContent);
  if (info) D.push(info);
  linesOf(row.querySelector('.desc_short')).forEach(function (l) { D.push(l); });
  row.querySelectorAll('.career_item').forEach(function (ci) {
    var lab = clean((ci.querySelector('h3') || {}).textContent);
    var toR = /^דרישות/.test(lab);
    linesOf(ci.querySelector('.page_text')).forEach(function (l) { (toR || NEED.test(l) ? R : D).push(l); });
  });
  // a driver's work is the route, not the company's site: no location from the text (owner 2026-10-18), the worker stores Unknown
  var loc = /(^|[^א-ת])נהג/.test(title) ? [] : placeOf(D);
  var ob = row.querySelector('.open_btn');
  var dt = (ob && ob.getAttribute('data-title')) || title;
  var blob = blobOf(row, dt);
  var it = document.createElement('div');
  it.className = 'haide-job';
  var add = function (cls, v) { var e = document.createElement('span'); e.className = cls + ' wp-exclude-emoji'; e.textContent = v; it.appendChild(e); };
  add('haide-title', title);
  if (D.length) add('__ai-description', D.join('\n'));
  if (R.length) add('__ai-requirements', R.join('\n'));
  if (loc.length) add('__ai-location', loc.join(' | '));
  if (blob) { add('__ai-applicationInfo', blob); add('__ai-formData', blob); }
  root.appendChild(it);
});
document.body.appendChild(root);
console.log('[pines] cards ' + document.querySelectorAll('.wrap_career_row').length + ', jobs ' + root.children.length + ', dropped ' + dropped.join(' ') + ', ' + (Date.now() - T0) + ' ms');
