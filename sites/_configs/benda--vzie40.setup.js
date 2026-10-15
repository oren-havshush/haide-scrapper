// benda.co.il/jobs: Elementor loop grid of the WordPress "jobs" post type, one page, no pager.
// A card prints the title, "תחום" (category) and "מיקום" (area tag); the body and the apply form are on
// the job page. The script reads every card, then every job page, ALL-OR-NOTHING (a failed fetch, a redirect
// or a page without the job template builds no item).
// - description / requirements: the job page's "תיאור המשרה" and "דרישות" blocks; the labels are dropped,
//   line breaks kept, text as printed.
// - id: the page prints no job number and the addresses are Hebrew, so no id is emitted; the worker builds
//   an h- id from title, department and url. The form field "jobnum" holds the category, not a number.
// - location: the card's area tag as printed, read through the config's locationMap; a work line saying
//   "בפריסה ארצית" adds that label. Nothing else from the text.
// - date: the job post's publish date (WP REST date_gmt); the page prints none.
// - apply: the job's own Elementor form as the page has it (hidden queried_id = the job's post, referer_title,
//   the prefilled job and category fields), one blob per job.
if (document.getElementById('haide-benda')) return;
if (!document.querySelector('.e-loop-item.type-jobs')) return;
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
// --- the cards ---
var cards = Array.prototype.map.call(document.querySelectorAll('.e-loop-item.type-jobs'), function (c) {
  var o = { pid: ((/(?:^|\s)e-loop-item-(\d+)(?:\s|$)/.exec(c.className) || [])[1]) || '', title: '', cat: '', tag: '', url: '' };
  c.querySelectorAll('h2.elementor-heading-title').forEach(function (h) {
    var b = h.querySelector('b');
    if (!b) return;
    var lab = clean(b.textContent), val = clean(h.textContent.replace(b.textContent, ''));
    if (lab === 'משרה' && !o.title) o.title = val;
    else if (lab === 'תחום' && !o.cat) o.cat = val;
    else if (lab === 'מיקום' && !o.tag) o.tag = val;
  });
  var a = c.querySelector('a[href*="/jobs/"]');
  if (a) o.url = new URL(a.getAttribute('href'), location.href).href;
  return o;
});
if (!cards.length || cards.some(function (c) { return !c.title || !c.url; })) { console.warn('[benda] card read failed'); return; }
// --- publish dates (one request; a failure leaves the jobs undated, nothing else) ---
var DATE = {};
var rj = await get(location.origin + '/wp-json/wp/v2/jobs?per_page=100&_fields=id,date_gmt');
try { (JSON.parse(rj || '[]') || []).forEach(function (p) { if (p && p.id && p.date_gmt) DATE[String(p.id)] = p.date_gmt + 'Z'; }); } catch (e) {}
// --- the job pages ---
var pages = [];
for (var i = 0; i < cards.length; i++) {
  var h = await get(cards[i].url);
  var d = h && new DOMParser().parseFromString(h, 'text/html');
  var main = d && d.querySelector('[data-elementor-type="single-post"].type-jobs');
  if (!main) { console.warn('[benda] job page failed: ' + cards[i].url); return; }
  pages.push(main);
}
var LABEL = /^(תיאור המשרה|דרישות( המשרה| התפקיד)?)\s*:?$/;
// one text block -> its section label (the block's own leading <b>, dropped) and its lines
var linesOf = function (w) {
  var c = w.cloneNode(true), sec = '';
  c.querySelectorAll('script, style, svg').forEach(function (e) { e.remove(); });
  var lead = c.querySelector('b, strong');
  if (lead && LABEL.test(clean(lead.textContent)) && !clean(c.textContent.split(lead.textContent)[0])) { sec = clean(lead.textContent); lead.replaceWith('\n'); }
  c.querySelectorAll('br').forEach(function (e) { e.replaceWith('\n'); });
  c.querySelectorAll('p, li, div, h1, h2, h3, h4, h5, h6, tr').forEach(function (e) { e.appendChild(document.createTextNode('\n')); });
  return { sec: sec, lines: (c.textContent || '').split('\n').map(function (l) { return l.replace(WS, ' ').trim(); }).filter(function (l) { return l; }) };
};
var split = function (main) {
  var D = [], R = [];
  main.querySelectorAll('.elementor-widget-text-editor .elementor-widget-container').forEach(function (w) {
    if (w.closest('form')) return;
    var b = linesOf(w);
    var to = /^דרישות/.test(b.sec) ? R : D;
    b.lines.forEach(function (l) { if (!LABEL.test(l)) to.push(l); });
  });
  return { d: D.join('\n'), r: R.join('\n'), lines: D };
};
var NATION = /(העבודה|המשרה)[^.]*בפריסה ארצית/;
var blobOf = function (main, url) {
  var fm = main.querySelector('form.elementor-form');
  if (!fm) return '';
  var fields = [];
  fm.querySelectorAll('input, select, textarea').forEach(function (e) {
    var ft = (e.tagName === 'INPUT' ? (e.getAttribute('type') || 'text') : e.tagName.toLowerCase()).toLowerCase();
    if (/^(submit|button|reset|image)$/.test(ft) || !e.name) return;
    var lb = e.id ? fm.querySelector('label[for="' + e.id + '"]') : null;
    var o = { name: e.name, label: clean(lb ? lb.textContent : (e.getAttribute('placeholder') || '')), fieldType: ft, tagName: e.tagName,
      required: e.hasAttribute('required') };
    if (e.hasAttribute('value') && ft !== 'file') o.value = e.getAttribute('value') || '';
    if (ft === 'file' && e.getAttribute('accept')) o.accept = e.getAttribute('accept');
    fields.push(o);
  });
  return JSON.stringify({ actionUrl: location.origin + '/wp-admin/admin-ajax.php', actionAttribute: '', formClass: fm.getAttribute('class') || '',
    formTag: 'form', method: 'POST', enctype: 'multipart/form-data', pageUrl: url, fields: fields });
};
// --- the items ---
var root = document.createElement('div');
root.id = 'haide-benda';
root.style.display = 'none';
var dropped = [];
cards.forEach(function (c, k) {
  var title = c.title.replace(MATH, function (ch) { return ch.normalize('NFKC'); });
  if (!OK1.test(title) || BAD.test(title)) { dropped.push(c.pid + ':lang'); return; }
  var s = split(pages[k]);
  var loc = c.tag ? [c.tag] : [];
  if (s.lines.some(function (l) { return NATION.test(l); })) loc.push('פריסה ארצית');
  var blob = blobOf(pages[k], c.url);
  var it = document.createElement('div');
  it.className = 'haide-job';
  var add = function (cls, v) { var e = document.createElement('span'); e.className = cls + ' wp-exclude-emoji'; e.textContent = v; it.appendChild(e); };
  var a = document.createElement('a');
  a.className = 'haide-link wp-exclude-emoji'; a.href = c.url; a.textContent = title;
  it.appendChild(a);
  if (c.cat) add('__ai-department', c.cat);
  if (s.d) add('__ai-description', s.d);
  if (s.r) add('__ai-requirements', s.r);
  if (loc.length) add('__ai-location', loc.join(' | '));
  if (DATE[c.pid]) add('__ai-publishDate', DATE[c.pid]);
  if (blob) { add('__ai-applicationInfo', blob); add('__ai-formData', blob); }
  root.appendChild(it);
});
document.body.appendChild(root);
console.log('[benda] cards ' + cards.length + ', jobs ' + root.children.length + ', dated ' + Object.keys(DATE).length + ', dropped ' + dropped.join(' ') + ', ' + (Date.now() - T0) + ' ms');
