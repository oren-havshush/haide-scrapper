// tbsi.co.il/jobs (תדיראן טלקום). Wix static page: the jobs are the items of one repeater, server-rendered, each with
// a title (h2 rich text), a body rich text and a "להגשת מועמדות" mailto button. No fetch, no detail pages.
// One item per repeater item that carries a mailto button; a hidden copy is built so the fields read cleanly.
// Apply: the item's own mailto address only, the query dropped (owner 2026-10-20: all four print the first job's subject;
// the public site builds the subject from each job's own title). Id: no printed number, no per-job URL -> no id, the worker builds h-<hash>.
// Location: work-location cue lines only ("מיקום:", "המשרה ממוקמת ב"), closed table; "עבודת שטח (פריסה ארצית)" ->
// פריסה ארצית; no place in the ad -> the single printed company city (footer "היצירה 23, פתח תקווה", LRN-LOC-20)
// unless the ad says field work.
if (document.getElementById('haide-tbsi')) return;
var T0 = Date.now();
var NB = String.fromCharCode(160), ZW = String.fromCharCode(0x200B), LRM = String.fromCharCode(0x200E), RLM = String.fromCharCode(0x200F);
var WS = new RegExp('[\\s' + NB + ']+', 'g'), ZR = new RegExp('[' + ZW + LRM + RLM + ']', 'g');
var clean = function (s) { return String(s || '').replace(ZR, '').replace(WS, ' ').trim(); };
var OK1 = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}]/u;
var BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var MATH = new RegExp('[' + String.fromCodePoint(0x1D400) + '-' + String.fromCodePoint(0x1D7FF) + ']', 'gu');
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var itemsNow = function () {
  return Array.prototype.filter.call(document.querySelectorAll('.wixui-repeater__item'), function (it) {
    return it.querySelector('a[href^="mailto:"]') && it.querySelector('h1, h2, h3') && it.querySelectorAll('[data-testid="richTextElement"]').length >= 2;
  });
};
var items = [], prev = -1, stable = 0;
for (var t = 0; t < 40; t++) {
  items = itemsNow();
  if (items.length > 0 && items.length === prev) { if (++stable >= 2) break; } else stable = 0;
  prev = items.length;
  await sleep(500);
}
if (!items.length) { console.warn('[tbsi] no job items on ' + location.href); return; }
// --- body split (owner's job body rules) ---
var REQH = /^דרישות(?:\s+(?:התפקיד|המשרה))?\s*:?$/;
var ADVH = /^יתרונות\s*:?$/;                       // a requirements sub-heading: kept as a line inside requirements
var BACK = /^(תנאים|המשרה|מיקום|היקף משרה)/;       // after the requirements: conditions, place and the closing line
var blocks = function (root) {
  var out = [];
  var walk = function (el) {
    Array.prototype.forEach.call(el.children, function (c) {
      if (c.tagName === 'UL' || c.tagName === 'OL') {
        Array.prototype.forEach.call(c.querySelectorAll('li'), function (li) { var x = clean(li.textContent); if (x) out.push({ li: true, text: x }); });
        return;
      }
      if (c.tagName === 'DIV') { walk(c); return; }
      var x = c.cloneNode(true);
      x.querySelectorAll('br').forEach(function (b) { b.replaceWith('\n'); });
      (x.textContent || '').split('\n').map(clean).filter(Boolean).forEach(function (ln) { out.push({ li: false, text: ln }); });
    });
  };
  walk(root);
  return out;
};
var split = function (root) {
  var d = [], r = [], mode = 'd';
  blocks(root).forEach(function (b) {
    var ln = b.text;
    if (!b.li && REQH.test(ln)) { mode = 'r'; return; }          // label dropped
    if (!b.li && ADVH.test(ln)) { mode = 'r'; r.push(b); return; }
    if (mode === 'r' && !b.li && BACK.test(ln)) mode = 'd';
    (mode === 'r' ? r : d).push(b);
  });
  return { d: d, r: r };
};
// --- location ---
var PT = { re: /(^|[\s,(\/:])ב?פתח[\s-]תקו(?:ו)?ה/, row: 'פתח תקווה' };
var COMPANY_CITY = 'פתח תקווה';
var place = function (lines) {
  var out = [], field = false;
  lines.forEach(function (ln) {
    var cue = /^מיקום\s*:/.test(ln) || /המשרה ממוקמת/.test(ln);
    if (/עבודת שטח|פריסה ארצית/.test(ln) && cue) { field = true; if (out.indexOf('פריסה ארצית') < 0) out.push('פריסה ארצית'); }
    if (cue && PT.re.test(ln) && out.indexOf(PT.row) < 0) out.push(PT.row);
  });
  if (out.length) return out;
  return field ? ['Unknown'] : [COMPANY_CITY];
};
// --- items ---
var box = document.createElement('div');
box.id = 'haide-tbsi';
box.style.display = 'none';
var dropped = [];
items.forEach(function (src) {
  var h = src.querySelector('h1, h2, h3');
  var title = clean(h.textContent).replace(MATH, function (ch) { return ch.normalize('NFKC'); });
  if (!title) return;
  if (!OK1.test(title) || BAD.test(title)) { dropped.push(title + ':lang'); return; }
  var body = null;
  Array.prototype.forEach.call(src.querySelectorAll('[data-testid="richTextElement"]'), function (rt) {
    if (rt.contains(h)) return;
    if (!body || clean(rt.textContent).length > clean(body.textContent).length) body = rt;
  });
  var mail = clean(src.querySelector('a[href^="mailto:"]').getAttribute('href').split('?')[0]);  var s = body ? split(body) : { d: [], r: [] };
  var it = document.createElement('div');
  it.className = 'haide-job';
  var add = function (cls, v) {
    var w = document.createElement('div');
    w.className = cls;
    if (typeof v === 'string') { w.textContent = v; it.appendChild(w); return; }
    var ul = null;
    v.forEach(function (x) {
      if (x.li) { if (!ul) { ul = document.createElement('ul'); w.appendChild(ul); } var li = document.createElement('li'); li.textContent = x.text; ul.appendChild(li); }
      else { ul = null; var p = document.createElement('p'); p.textContent = x.text; w.appendChild(p); }
    });
    it.appendChild(w);
  };
  add('__ai-title', title);
  if (s.d.length) add('__ai-description', s.d);
  if (s.r.length) add('__ai-requirements', s.r);
  add('__ai-location', place(s.d.concat(s.r).map(function (x) { return x.text; })).join(', '));
  add('__ai-applicationInfo', mail);
  box.appendChild(it);
});
document.body.appendChild(box);
console.log('[tbsi] items ' + items.length + ', jobs ' + box.children.length + ', dropped ' + dropped.join(' ') + ', ' + (Date.now() - T0) + ' ms');
