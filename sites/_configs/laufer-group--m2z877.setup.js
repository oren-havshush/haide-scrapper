// laufer.group/career-he/: WordPress, theme "laufer". One page, 12 accordions .position-item (title h3, body
// .position-item__content .editor-area), server-rendered; no pager, no load-more, no job pages a visitor reaches.
// The same 12 jobs (same codes, same Hebrew bodies) are on the English twin /career/; this site reads only /career-he/.
// No fetches: everything is in the listing HTML.
// - id: the job code the page itself sends with an application (onclick="setCode(<n>)" on the card's "שלח קורות חיים"
//   link fills the form's hidden job_code); it equals the printed "מספר משרה: <n>" on every card that prints one.
//   Stored as laufer-<n>. A card with no code gets no id (the worker hashes it) and is logged.
// - url: the listing + '#job-<n>' (no job pages; distinct per job so the worker does not merge cards).
// - body: lines as printed. "מספר משרה: <n>" line dropped (rule 7); "מחלקה: X" line -> department;
//   דרישות sections -> requirements (labels dropped); "הגדרת תפקיד:" label dropped; the rest -> description.
// - location: places from work-location lines only (a "מיקום:" line, "המשרה ממוקמת ב…", the title), closed list
//   (נתב"ג, לוד), quote marks typed as "; read through the config's locationMap.
// - apply: CF7 form 681 (#applyCV), one per page, shared by all jobs; per-job blob with job_code = the job's code,
//   as setCode sets it. No captcha. No consent box.
if (document.getElementById('haide-laufer')) return;
var ITEM = '.career-positions__list .position-item';
var prev = -1, stable = 0;
for (var t = 0; t < 40; t++) {
  var n = document.querySelectorAll(ITEM).length;
  if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n;
  await new Promise(function (r) { setTimeout(r, 250); });
}
var T0 = Date.now();
var NB = String.fromCharCode(160);
var QQ = String.fromCharCode(0x201D, 0x201C, 0x05F4);
var QRE = new RegExp('[' + QQ + ']', 'g');
var WS = new RegExp('[ \\t' + NB + ']+', 'g');
var OK1 = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}]/u;
var BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var MATH = new RegExp('[' + String.fromCodePoint(0x1D400) + '-' + String.fromCodePoint(0x1D7FF) + ']', 'gu');
var clean = function (s) { return String(s || '').replace(WS, ' ').replace(/\s+/g, ' ').trim(); };
var P = '^[^A-Za-zא-ת0-9]*';
var NUM = new RegExp(P + 'מספר משרה\\s*:?\\s*(\\d+)\\s*$');
var DEP = new RegExp(P + 'מחלקה\\s*:\\s*(.+)$');
var REQH = new RegExp(P + '(דרישות( התפקיד| המשרה| סף)?|Requirements)\\s*:?\\s*$');
var DROPH = new RegExp(P + '(הגדרת תפקיד|תיאור התפקיד)\\s*:?\\s*$');
var DESCH = new RegExp(P + '(התפקיד כולל|תנאים|הגדרת תפקיד|תיאור התפקיד)');
var TAIL = [/המשרה מיועדת ל/, /(^|[^א-ת])שכר/];
var CUE = new RegExp(P + 'מיקום\\s*:|המשרה ממוקמת');
var PLACES = [
  ['נתב"ג', /(^|[^א-ת])ב?נתב"ג(?![א-ת])/],
  ['לוד', /(^|[^א-ת])ב?לוד(?![א-ת])/]
];
var linesOf = function (el) {
  if (!el) return [];
  var c = el.cloneNode(true);
  c.querySelectorAll('p,div,ul,ol,li,br,h1,h2,h3,h4,h5,h6,tr').forEach(function (e) { e.insertAdjacentText('afterend', '\n'); });
  return String(c.textContent || '').split('\n').map(function (l) { return l.replace(WS, ' ').trim(); }).filter(Boolean);
};
var placesIn = function (line, out) {
  var l = line.replace(QRE, '"');
  PLACES.forEach(function (p) { if (p[1].test(l) && out.indexOf(p[0]) < 0) out.push(p[0]); });
};
var fm = document.querySelector('#applyCV form.wpcf7-form');
var formId = fm ? ((fm.querySelector('input[name="_wpcf7"]') || {}).value || '') : '';
var blobOf = function (code, pageUrl) {
  if (!fm || !/^\d+$/.test(formId)) return '';
  var fields = [];
  fm.querySelectorAll('input, select, textarea').forEach(function (e) {
    var ft = (e.tagName === 'INPUT' ? (e.getAttribute('type') || 'text') : e.tagName.toLowerCase()).toLowerCase();
    if (/^(submit|button|reset|image)$/.test(ft) || !e.name) return;
    var lab = e.getAttribute('placeholder') || '';
    if (ft === 'file') { var lp = e.closest('label'); var pp = lp ? lp.querySelector('p') : null; if (pp) lab = pp.textContent; }
    var req = e.getAttribute('aria-required') === 'true' || /wpcf7-validates-as-required/.test(e.className || '');
    var o = { name: e.name, label: clean(lab).replace(/^\*/, ''), fieldType: ft, tagName: e.tagName, required: req };
    if (ft === 'hidden') o.value = e.getAttribute('value') || '';
    if (e.name === 'job_code') { o.value = code; o.label = 'job_code'; }
    if (ft === 'file' && e.getAttribute('accept')) o.accept = e.getAttribute('accept');
    fields.push(o);
  });
  return JSON.stringify({ actionUrl: location.origin + '/wp-json/contact-form-7/v1/contact-forms/' + formId + '/feedback',
    actionAttribute: fm.getAttribute('action') || '', formClass: fm.getAttribute('class') || '', formTag: 'form',
    method: 'POST', enctype: 'multipart/form-data', pageUrl: pageUrl, fields: fields });
};
var base = location.origin + location.pathname;
var root = document.createElement('div');
root.id = 'haide-laufer';
root.style.display = 'none';
var log = [];
document.querySelectorAll(ITEM).forEach(function (card) {
  var title = clean((card.querySelector('.position-item__title') || {}).textContent).replace(MATH, function (ch) { return ch.normalize('NFKC'); });
  if (!title) return;
  if (!OK1.test(title) || BAD.test(title)) { log.push('lang:' + title); return; }
  var a = card.querySelector('a[href="#applyCV"]');
  var cm = a ? /setCode\((\d+)\)/i.exec(a.getAttribute('onclick') || '') : null;
  var code = cm ? cm[1] : '';
  var D = [], R = [], inR = false, dep = '', printed = '', places = [];
  placesIn(title, places);
  linesOf(card.querySelector('.position-item__content .editor-area')).forEach(function (l) {
    var m = NUM.exec(l);
    if (m) { printed = m[1]; return; }
    m = DEP.exec(l);
    if (m && !dep) { dep = clean(m[1]); return; }
    if (CUE.test(l)) placesIn(l, places);
    var short = l.length < 60;
    if (short && REQH.test(l)) { inR = true; return; }
    if (short && DROPH.test(l)) { inR = false; return; }
    if (short && DESCH.test(l)) { inR = false; D.push(l); return; }
    if (inR && !TAIL.some(function (re) { return re.test(l); })) { R.push(l); return; }
    D.push(l);
  });
  if (!code) log.push('nocode:' + title);
  if (printed && code && printed !== code) log.push('mismatch:' + code + '/' + printed);
  var url = base + '#job-' + (code || encodeURIComponent(title));
  var it = document.createElement('div');
  it.className = 'haide-job';
  var add = function (cls, val) { var e = document.createElement('span'); e.className = cls + ' wp-exclude-emoji'; e.textContent = val; it.appendChild(e); };
  var ln = document.createElement('a'); ln.className = '__ai-url wp-exclude-emoji'; ln.href = url; ln.textContent = title; it.appendChild(ln);
  add('haide-title', title);
  if (code) add('__ai-jobid', 'laufer-' + code);
  if (D.length) add('__ai-description', D.join('\n'));
  if (R.length) add('__ai-requirements', R.join('\n'));
  if (places.length) add('__ai-location', places.join(' | '));
  if (dep) add('__ai-department', dep);
  var blob = blobOf(code, url);
  if (blob) { add('__ai-applicationInfo', blob); add('__ai-formData', blob); }
  root.appendChild(it);
});
document.body.appendChild(root);
console.log('[laufer] cards ' + document.querySelectorAll(ITEM).length + ', jobs ' + root.children.length + ', log ' + log.join(' ') + ', ' + (Date.now() - T0) + ' ms');
