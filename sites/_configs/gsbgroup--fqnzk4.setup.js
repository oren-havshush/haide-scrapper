// gsbgroup.co.il careers page (GSB GROUP). WordPress + Elementor + JetEngine listing 571 (CPT careers): every job is a
// card on this page (.jet-listing-grid__item[data-post-id]) with its title (h4) and its whole text in one heading widget.
// No fetch, no detail pages (the CPT single pages render no text and nothing links to them).
// Id: no printed job number -> no id; the worker builds h-<hash>. No per-job URL (the card button is #apply).
// Body: "פרטים:" and "דרישות:" labels dropped; lines after "דרישות:" go to requirements until the CV/email line, which stays
// in the description as printed (a form and an email line in one job: the form is the apply method).
// Location: a cue line naming Knot industrial zone ("משרדי החברה ממוקמים בא.ת כנות") -> the city.csv row
// "אזור תעשיה כנות"; no place in the ad -> the single printed company address (footer "אדום 33, אזור התעשייה כנות",
// LRN-LOC-20) unless the ad says field work.
// Apply: the page's one Elementor form "טופס הגשת מועמדות" (#apply, form_id 3db77e0, no captcha in it) is copied into
// every job and captured per job by the shared template; the job title is put in its free-text field "הערות נוספות".
if (document.getElementById('haide-gsb')) return;
var T0 = Date.now();
var NB = String.fromCharCode(160), ZW = String.fromCharCode(0x200B), LRM = String.fromCharCode(0x200E), RLM = String.fromCharCode(0x200F);
var WS = new RegExp('[ \\t' + NB + ']+', 'g'), ZR = new RegExp('[' + ZW + LRM + RLM + ']', 'g');
var clean = function (s) { return String(s || '').replace(ZR, '').replace(WS, ' ').trim(); };
var OK1 = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}]/u;
var BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var MATH = new RegExp('[' + String.fromCodePoint(0x1D400) + '-' + String.fromCodePoint(0x1D7FF) + ']', 'gu');
var ITEM = '.jet-listing-grid__item[data-post-id]';
var items = [], prev = -1, stable = 0;
for (var t = 0; t < 40; t++) {
  items = Array.prototype.slice.call(document.querySelectorAll(ITEM));
  if (items.length > 0 && items.length === prev) { if (++stable >= 2) break; } else stable = 0;
  prev = items.length;
  await new Promise(function (r) { setTimeout(r, 500); });
}
var FORM = document.querySelector('#apply form.elementor-form') || document.querySelector('form.elementor-form:has(input[type="file"])');
if (!items.length || !FORM) { console.log('[gsb] nothing built: items ' + items.length + ', form ' + !!FORM); return; }
var REQH = /^דרישות(?:\s+(?:התפקיד|המשרה))?\s*:?$/;
var LABEL = /^(?:פרטים|תיאור(?:\s+התפקיד)?)\s*:?$/;
var BACK = /קורות\s+חיים|למייל|משלוח/;
var CUE = /ממוקמ|מיקום|מקום\s+העבודה|העבודה\s+ב/;
var KNOT = /(^|[\s(,:])ב?(?:א\.ת\.?|אזור\s+התעשי?יה|אזור\s+תעשי?יה)\s*כנות/;
var FIELD = /עבודת\s+שטח|פריסה\s+ארצית|נסיעות/;
var COMPANY = 'אזור תעשיה כנות';
var place = function (lines) {
  var cue = false, field = false;
  lines.forEach(function (ln) { if (CUE.test(ln) && KNOT.test(ln)) cue = true; if (FIELD.test(ln)) field = true; });
  if (cue) return COMPANY;
  return field ? 'Unknown' : COMPANY;
};
var root = document.createElement('div');
root.id = 'haide-gsb-x'; root.style.display = 'none';
var drop = [];
items.forEach(function (src) {
  var h = src.querySelector('h1, h2, h3, h4');
  var title = h ? clean(h.textContent).replace(MATH, function (c) { return c.normalize('NFKC'); }) : '';
  var pid = src.getAttribute('data-post-id');
  if (!title) { drop.push(pid + ':notitle'); return; }
  if (!OK1.test(title) || BAD.test(title)) { drop.push(pid + ':lang'); return; }
  var body = null;
  Array.prototype.forEach.call(src.querySelectorAll('.elementor-widget-heading .elementor-heading-title'), function (e) { if (e !== h && !e.contains(h)) body = body || e; });
  var raw = '';
  if (body) { var x = body.cloneNode(true); x.querySelectorAll('br').forEach(function (b) { b.replaceWith('\n'); }); raw = x.textContent; }
  var d = [], r = [], mode = 'd';
  String(raw).split(/\r?\n/).map(clean).filter(Boolean).forEach(function (ln) {
    if (LABEL.test(ln)) return;
    if (REQH.test(ln)) { mode = 'r'; return; }
    var li = /^-/.test(ln), text = li ? clean(ln.replace(/^-+/, '')) : ln;
    if (!text) return;
    if (mode === 'r' && !li && BACK.test(text)) mode = 'd';
    (mode === 'r' ? r : d).push({ li: li, text: text });
  });
  var it = document.createElement('div');
  it.className = 'haide-job';
  var add = function (cls, v) {
    var w = document.createElement('div'); w.className = cls;
    if (typeof v === 'string') { w.textContent = v; it.appendChild(w); return; }
    var ul = null;
    v.forEach(function (x) {
      if (x.li) { if (!ul) { ul = document.createElement('ul'); w.appendChild(ul); } var li = document.createElement('li'); li.textContent = x.text; ul.appendChild(li); }
      else { ul = null; var p = document.createElement('p'); p.textContent = x.text; w.appendChild(p); }
    });
    it.appendChild(w);
  };
  add('__ai-title', title);
  if (d.length) add('__ai-description', d);
  if (r.length) add('__ai-requirements', r);
  add('__ai-location', place(d.concat(r).map(function (x) { return x.text; })));
  var hold = document.createElement('div'); hold.className = 'haide-form';
  var f = FORM.cloneNode(true);
  var note = f.querySelector('textarea[name="form_fields[field_ce1fbae]"]');
  if (note) note.value = title;
  hold.appendChild(f); it.appendChild(hold);
  root.appendChild(it);
});
document.body.appendChild(root);
;(function () {
var EXTRACTOR_VERSION = 3;
function extractFormSchema(form) {
var pageUrl = window.location.href;
var actionRaw = (form.getAttribute('action') || '').trim();
var actionAttribute = actionRaw;
try { if (actionRaw) actionAttribute = new URL(actionRaw, pageUrl).toString(); } catch (e) {}
var action = form.getAttribute('action') || '';
var method = (form.getAttribute('method') || 'GET').toUpperCase();
var enctype = form.getAttribute('enctype');
var fields = [];
var honeypots = [];
var radios = {};
var els = form.querySelectorAll('input, select, textarea');
for (var i = 0; i < els.length; i++) {
var el = els[i];
var tag = el.tagName.toLowerCase();
var type = tag === 'input' ? ((el.getAttribute('type') || 'text').toLowerCase()) : tag;
if (type === 'submit' || type === 'button' || type === 'image' || type === 'reset') continue;
var name = el.getAttribute('name') || '';
var style = (el.getAttribute('style') || '').toLowerCase();
var isOffscreen = style.indexOf('-99999') !== -1 || style.indexOf('display:none !important') !== -1 || style.indexOf('display: none !important') !== -1;
var ancestorHint = '';
var ancestorHidden = false;
for (var a = el.parentElement; a && a !== form; a = a.parentElement) {
ancestorHint += ' ' + (a.id || '') + ' ' + (typeof a.className === 'string' ? a.className : '');
if (ancestorHidden) continue;
var acs = window.getComputedStyle(a);
var apv = a.parentElement ? window.getComputedStyle(a.parentElement).visibility : 'visible';
var tiny = (/px$/.test(acs.width) && parseFloat(acs.width) <= 1) || (/px$/.test(acs.height) && parseFloat(acs.height) <= 1);
var aclip = (acs.clip || '').replace(/\s+/g, '');
var aclipPath = (acs.clipPath || '').replace(/\s+/g, '');
ancestorHidden =
acs.display === 'none' ||
(acs.visibility === 'hidden' && apv !== 'hidden') ||
(tiny && (acs.overflow || '').indexOf('hidden') !== -1) ||
aclip === 'rect(0px,0px,0px,0px)' ||
aclipPath === 'inset(50%)' ||
aclipPath === 'inset(100%)';
}
var isHpName = /\b(hp[_-]|honeypot|maspik|nickname|malkodet)/i.test(name + ' ' + (el.id || '') + ' ' + (el.className || '') + ancestorHint);
var nearLabel = '';
if (el.parentElement) {
var sibs = el.parentElement.children;
for (var si = 0; si < sibs.length; si++) if (sibs[si] !== el && sibs[si].tagName === 'LABEL') nearLabel += ' ' + (sibs[si].textContent || '');
}
var askText = (nearLabel + ' ' + (el.getAttribute('placeholder') || '')).replace(/\s+/g, ' ');
var asksEmpty =
/leave (this|the) field (empty|blank)|do not fill|don't fill/i.test(askText) ||
['השאר שדה זה ריק', 'השאירו שדה זה ריק', 'יש להשאיר ריק', 'אין למלא', 'לא למלא', 'נא לא למלא'].some(function (h) { return askText.indexOf(h) !== -1; });
var isTrap = false;
var isTextLike = /^(text|email|tel|url|number|search|password|textarea)$/.test(type);
var emptied = false;
var prefilled = false;
if (isTextLike) {
var cs = window.getComputedStyle(el);
var pv = el.parentElement ? window.getComputedStyle(el.parentElement).visibility : 'visible';
emptied = (tag === 'textarea' ? (el.textContent || '').trim() !== '' : (el.getAttribute('value') || '').trim() !== '') && el.value === '';
prefilled = !emptied && (el.value || '').trim() !== '';
var styleHidden =
cs.display === 'none' ||
(cs.visibility === 'hidden' && pv !== 'hidden') ||
cs.opacity === '0' ||
(/px$/.test(cs.width) && parseFloat(cs.width) <= 1) ||
(/px$/.test(cs.height) && parseFloat(cs.height) <= 1) ||
((cs.position === 'absolute' || cs.position === 'fixed') &&
((parseFloat(cs.left) || 0) <= -1000 || (parseFloat(cs.top) || 0) <= -1000)) ||
(el.getAttribute('aria-hidden') === 'true' && el.getAttribute('tabindex') === '-1');
isTrap = emptied || ((styleHidden || ancestorHidden) && !prefilled) || asksEmpty;
}
if ((isOffscreen || isHpName || isTrap) && type !== 'hidden') {
if (name && honeypots.indexOf(name) === -1) honeypots.push(name);
continue;
}
var label = '';
if (el.id) {
var safeId = el.id.replace(/"/g, '\\"');
var lab = form.querySelector('label[for="' + safeId + '"]');
if (lab) label = (lab.textContent || '').replace(/\s+/g, ' ').trim();
}
if (!label) {
var parentLabel = el.closest('label');
if (parentLabel) label = (parentLabel.textContent || '').replace(/\s+/g, ' ').trim();
}
var required = el.hasAttribute('required') || el.getAttribute('aria-required') === 'true';
if (type === 'radio') {
var option = { value: el.value, label: label };
if (name && radios[name]) {
radios[name].options.push(option);
radios[name].required = radios[name].required || required;
continue;
}
var fs = el.closest('fieldset');
var legend = fs ? fs.querySelector('legend') : null;
var groupLabel = legend ? (legend.textContent || '').replace(/\s+/g, ' ').trim() : '';
var group = { name: name, fieldType: 'radio', label: groupLabel || name, required: required, tagName: tag, options: [option] };
if (name) radios[name] = group;
fields.push(group);
continue;
}
if (!label) label = el.getAttribute('placeholder') || el.getAttribute('aria-label') || '';
var rec = { name: name, fieldType: type, label: label, required: required, tagName: tag };
if (type === 'hidden') rec.value = el.value || '';
if (prefilled) { rec.value = el.value; rec.prefilled = true; }
if (type === 'file') {
var accept = el.getAttribute('accept');
if (accept) rec.accept = accept;
if (el.multiple) rec.multiple = true;
}
if (tag === 'select') {
var opts = el.querySelectorAll('option'); var options = [];
for (var k = 0; k < opts.length; k++) {
options.push({ value: opts[k].value, label: (opts[k].textContent || '').replace(/\s+/g, ' ').trim() });
}
rec.options = options;
}
fields.push(rec);
}
var schema = { actionUrl: action, actionAttribute: actionAttribute, pageUrl: pageUrl, method: method };
if (enctype) schema.enctype = enctype;
schema.fields = fields;
schema.honeypots = honeypots;
schema.capturedAt = new Date().toISOString();
schema.captureSource = 'script';
schema.extractorVersion = EXTRACTOR_VERSION;
return schema;
}
function pickForm(scope) {
var forms = scope.querySelectorAll('form');
var best = null, bestScore = -1;
for (var i = 0; i < forms.length; i++) {
var f = forms[i];
var name = (f.getAttribute('name') || '').toLowerCase();
var role = (f.getAttribute('role') || '').toLowerCase();
if (role === 'search' || /search/.test(name)) continue;
var inputs = f.querySelectorAll('input:not([type="hidden"]), select, textarea');
var visibleCount = 0;
for (var j = 0; j < inputs.length; j++) {
var t = (inputs[j].getAttribute('type') || '').toLowerCase();
if (t === 'submit' || t === 'button' || t === 'image' || t === 'reset') continue;
visibleCount++;
}
if (visibleCount > bestScore) { bestScore = visibleCount; best = f; }
}
return bestScore >= 1 ? best : null;
}
try {
document.querySelectorAll('#haide-gsb-x > div.haide-job').forEach(function (item) {
if (item.querySelector('[data-extracted-form]')) return;
var f = pickForm(item);
if (!f) return;
var schema = extractFormSchema(f);
var s = document.createElement('span');
s.setAttribute('data-extracted-form', '1');
s.style.display = 'none';
s.textContent = JSON.stringify(schema);
item.appendChild(s);
});
} catch (e) {}
})();
root.querySelectorAll('div.haide-job').forEach(function (it) {
  var s = it.querySelector('[data-extracted-form]'), h = it.querySelector('.haide-form');
  if (!s || !h) { drop.push('form:' + it.querySelector('.__ai-title').textContent); return; }
  var o = JSON.parse(s.textContent); s.remove(); h.remove();
  ['__ai-applicationInfo', '__ai-formData'].forEach(function (k) { var e = document.createElement('span'); e.className = k; e.textContent = JSON.stringify(o); it.appendChild(e); });
});
if (drop.join().indexOf('form:') < 0 && root.children.length) root.id = 'haide-gsb';
console.log('[gsb] cards ' + items.length + ', jobs ' + root.children.length + ', dropped ' + drop.join(' ') + ', ' + (Date.now() - T0) + ' ms');
