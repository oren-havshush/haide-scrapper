// careers.towersemi.com/our-loactions/israel/: one server-rendered table (Title | Location | Division), no pager.
// The body and the apply form are on each job page (/job-description/?job_id=N). The script reads every row,
// then every job page, ALL-OR-NOTHING (a failed fetch, a redirect or a page without the job body builds no item).
// - id: the row's own data-job_id (also the job page's job_id), namespaced towersemi-N. The page prints no number.
// - description / requirements: the job page's body block; "Job Requirements" / "דרישות" go to requirements,
//   the field labels (About / Job Description / Job Requirements, the Hebrew ones) are dropped, line breaks kept.
// - location: the row's Location cell as printed, read through the config's locationMap; a body line
//   "Located at ... Netanya" places the job there instead (the cell is the same for every Israeli job).
// - apply: the job page's Hebrew Gravity form (the page's default), one blob per job, with the values the
//   page's own script writes in: Job Title (input_134), Job ID (input_139), URL Source (input_136).
if (document.getElementById('haide-tower')) return;
var rowsEl = document.querySelectorAll('table.tftable tr[data-job_id]');
if (!rowsEl.length) return;
var T0 = Date.now();
var NB = String.fromCharCode(160);
var WS = new RegExp('[ \\t' + NB + ']+', 'g');
var OK1 = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var MATH = new RegExp('[' + String.fromCodePoint(0x1D400) + '-' + String.fromCodePoint(0x1D7FF) + ']', 'gu');
var clean = function (s) { return String(s || '').replace(WS, ' ').replace(/\s+/g, ' ').trim(); };
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var get = async function (url) {
  for (var a = 0; a < 2; a++) {
    try {
      var r = await fetch(url, { credentials: 'include', cache: 'no-store' });
      if (r.ok && !r.redirected) return await r.text();
    } catch (e) {}
    await sleep(1500);
  }
  return null;
};
var rows = Array.prototype.map.call(rowsEl, function (tr) {
  var a = tr.querySelector('a'), td = tr.querySelectorAll('td');
  var id = tr.getAttribute('data-job_id') || '';
  return { id: id, title: clean(a ? a.textContent : ''), loc: clean(td[1] ? td[1].textContent : ''), div: clean(td[2] ? td[2].textContent : ''),
    url: location.origin + '/job-description/?job_id=' + id };
});
if (rows.some(function (r) { return !/^\d+$/.test(r.id) || !r.title; })) { console.warn('[tower] row read failed'); return; }
var pages = [];
for (var i = 0; i < rows.length; i++) {
  var h = await get(rows[i].url);
  var d = h && new DOMParser().parseFromString(h, 'text/html');
  var cc = d && d.querySelector('#defaultCountry');
  var body = cc && cc.nextElementSibling;
  if (!body || !clean(body.textContent)) { console.warn('[tower] job page failed: ' + rows[i].url); return; }
  pages.push({ d: d, body: body, html: h });
}
// body -> lines, each marked as a heading when it is an h1-h6 or a paragraph that is all bold
var BLOCK = 'p, li, div, h1, h2, h3, h4, h5, h6, tr, ul, ol';
var linesOf = function (body) {
  var c = body.cloneNode(true);
  c.querySelectorAll('script, style, svg, form').forEach(function (e) { e.remove(); });
  c.querySelectorAll('h1, h2, h3, h4, h5, h6, p').forEach(function (e) {
    var t = clean(e.textContent), b = '';
    e.querySelectorAll('strong, b').forEach(function (s) { b += s.textContent; });
    if (t && (/^H\d$/.test(e.tagName) || clean(b) === t)) e.insertBefore(document.createTextNode('\n##'), e.firstChild);
  });
  c.querySelectorAll('br').forEach(function (e) { e.replaceWith('\n'); });
  c.querySelectorAll(BLOCK).forEach(function (e) { e.appendChild(document.createTextNode('\n')); });
  return (c.textContent || '').split('\n').map(function (l) { return l.replace(WS, ' ').trim(); }).filter(function (l) { return l && !/^(##)?[.\s]*$/.test(l); });
};
var DROP = /^(About Tower Semiconductor|אודות טאואר סמיקונדקטור|Job Description|תיאור התפקיד|Job Requirements|Requirements|דרישות( התפקיד)?)\s*:?$/i;
var REQ = /^(Job Requirements|Requirements|דרישות( התפקיד)?)\s*:?$/i;
var SUB = /^(Must Have|Nice to Have|Advantage|חובה|יתרון)\s*[:\-]?$/i;
var split = function (body) {
  var D = [], R = [], to = D;
  linesOf(body).forEach(function (l) {
    var head = l.indexOf('##') === 0, t = head ? clean(l.slice(2)) : l;
    if (!t) return;
    if (head) {
      if (REQ.test(t)) { to = R; return; }
      if (DROP.test(t)) { to = D; return; }
      if (to === R && !SUB.test(t)) to = D;
    }
    to.push(t);
  });
  return { d: D.join('\n'), r: R.join('\n'), lines: D };
};
var NETANYA = /^\W*Located at\b.*\bNetanya\b/i;
var GFC = /gf_form_conditional_logic'\]\[13\] = \{ logic: \{(.*?)\}, dependents/;
var blobOf = function (pg, r) {
  var fm = pg.d.querySelector('form#gform_13');
  if (!fm) return '';
  var cond = {}, m = GFC.exec(pg.html), re = /(\d+): \{"field":\{"enabled":true,"actionType":"show"/g, k;
  while (m && (k = re.exec(m[1]))) cond['input_' + k[1]] = true;
  var fill = { input_134: r.title, input_139: r.id, input_136: 'Tower Career website' };
  var fields = [];
  fm.querySelectorAll('input, select, textarea').forEach(function (e) {
    var ft = (e.tagName === 'INPUT' ? (e.getAttribute('type') || 'text') : e.tagName.toLowerCase()).toLowerCase();
    if (/^(submit|button|reset|image)$/.test(ft) || !e.name) return;
    var g = e.closest('.gfield');
    var lb = g ? g.querySelector('.gfield_label, legend') : null;
    var o = { name: e.name, label: clean(lb ? lb.textContent : ''), fieldType: ft, tagName: e.tagName,
      required: !!(g && /gfield_contains_required/.test(g.className) && ft !== 'hidden') };
    if (g && /gfield_visibility_hidden/.test(g.className) && ft === 'text') o.fieldType = 'hidden';
    if (Object.prototype.hasOwnProperty.call(fill, e.name)) o.value = fill[e.name];
    else if (e.hasAttribute('value')) o.value = e.getAttribute('value') || '';
    var base = e.name.split('.')[0];
    if (cond[base]) o.conditional = true;
    if (e.tagName === 'SELECT') o.options = Array.prototype.map.call(e.options, function (op) { return { value: op.value, label: clean(op.textContent) }; }).slice(0, 80);
    fields.push(o);
  });
  fields.push({ name: 'input_104', label: clean((fm.querySelector('#field_13_104 .gfield_label') || {}).textContent || 'CV'), fieldType: 'file', tagName: 'INPUT', required: true, accept: '.pdf,.doc,.docx' });
  fields.push({ name: 'g-recaptcha-response', label: 'reCAPTCHA (invisible, browser token)', fieldType: 'hidden', tagName: 'TEXTAREA', required: false });
  return JSON.stringify({ actionUrl: location.origin + '/job-description/?job_id=' + r.id + '#gf_13', actionAttribute: '/job-description/?job_id=' + r.id + '#gf_13',
    formClass: fm.getAttribute('class') || '', formTag: 'form', formSelector: 'form#gform_13', method: 'POST', enctype: 'multipart/form-data', pageUrl: r.url, fields: fields });
};
var root = document.createElement('div');
root.id = 'haide-tower';
root.style.display = 'none';
var dropped = [];
rows.forEach(function (r, k) {
  var title = r.title.replace(MATH, function (ch) { return ch.normalize('NFKC'); });
  if (!OK1.test(title) || BAD.test(title)) { dropped.push(r.id + ':lang'); return; }
  var s = split(pages[k].body);
  var loc = s.lines.some(function (l) { return NETANYA.test(l); }) ? 'Netanya' : r.loc;
  var blob = blobOf(pages[k], r);
  var it = document.createElement('div');
  it.className = 'haide-job';
  var add = function (cls, v) { var e = document.createElement('span'); e.className = cls; e.textContent = v; it.appendChild(e); };
  var a = document.createElement('a');
  a.className = 'haide-link'; a.href = r.url; a.textContent = title;
  it.appendChild(a);
  add('__ai-externalJobId', 'towersemi-' + r.id);
  if (r.div) add('__ai-department', r.div);
  if (s.d) add('__ai-description', s.d);
  if (s.r) add('__ai-requirements', s.r);
  if (loc) add('__ai-location', loc);
  if (blob) { add('__ai-applicationInfo', blob); add('__ai-formData', blob); }
  root.appendChild(it);
});
document.body.appendChild(root);
console.log('[tower] rows ' + rows.length + ', jobs ' + root.children.length + ', dropped ' + dropped.join(' ') + ', ' + (Date.now() - T0) + ' ms');
