// soglowek.co.il/משרות: every job is an accordion row `.careers-list > .career.ac` on this one page,
// full text in the HTML (collapsed, not lazy). No job pages (the sitemap's /career/<slug>/ addresses
// redirect back here), no pager.
// - title: the row's h3, as printed. Hebrew/English titles only.
// - description: the `.career__toggle p` block; its leading label "תיאור התפקיד:" is dropped, line
//   breaks kept. requirements: the `.career__body` block, line by line.
// - id: the page prints no job number and has no id attribute; the slugs are Hebrew. No id is emitted;
//   the worker builds an h- id from title, department and url.
// - location: the site's own job_location tags, read from the page's location filter (one GET per
//   filter option, ?job_location=<value>); the labels go through the config's locationMap. The title's
//   "אתר <place>" line is the text cue: it adds places only next to a tag place it repeats (four-case
//   rule), and stands alone when a job has no tag. A failed filter page drops the tags for every job
//   (the title cue then decides), never a partial tag set.
// - apply: the row's own mailto link (one address for every job, no subject); the page gives no
//   instruction on what to write, so applicationInfo is the bare mailto.
var SEL = '.careers-list > .career.ac';
var rows = document.querySelectorAll(SEL);
if (!rows.length || document.querySelector(SEL + ' > .__ai-title')) return;
var T0 = Date.now();
var NB = String.fromCharCode(160);
var WS = new RegExp('[ \\t' + NB + ']+', 'g');
var OK1 = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var MATH = new RegExp('[' + String.fromCodePoint(0x1D400) + '-' + String.fromCodePoint(0x1D7FF) + ']', 'gu');
var one = function (s) { return String(s || '').replace(/\s+/g, ' ').trim(); };
var lines = function (el) {
  if (!el) return [];
  var c = el.cloneNode(true);
  c.querySelectorAll('script, style, svg, a.career__button').forEach(function (e) { e.remove(); });
  c.querySelectorAll('br').forEach(function (e) { e.replaceWith('\n'); });
  c.querySelectorAll('p, li, div, h1, h2, h3, h4, h5, h6, tr').forEach(function (e) { e.appendChild(document.createTextNode('\n')); });
  return (c.textContent || '').split('\n').map(function (l) { return l.replace(WS, ' ').trim(); }).filter(function (l) { return l; });
};
var DLABEL = /^(תיאור התפקיד|תיאור המשרה|תיאור)\s*:\s*/;
// --- the site's location tags, from its own filter (all-or-nothing) ---
var TAGS = {}, tagsOk = true, opts = [];
document.querySelectorAll('input[name="job_location"]').forEach(function (i) {
  var v = i.getAttribute('value') || '', lab = i.closest('label') && i.closest('label').querySelector('.label');
  if (v && v !== 'reset' && lab) opts.push({ v: v, label: one(lab.textContent) });
});
for (var k = 0; k < opts.length && tagsOk; k++) {
  var html = null;
  for (var a = 0; a < 2 && html === null; a++) {
    try {
      var r = await fetch(location.origin + location.pathname + '?job_location=' + opts[k].v, { credentials: 'include', cache: 'no-store' });
      if (r.ok && !r.redirected) html = await r.text();
    } catch (e) {}
    if (html === null) await new Promise(function (res) { setTimeout(res, 1500); });
  }
  var d = html && new DOMParser().parseFromString(html, 'text/html');
  if (!d || !(d.querySelector('.careers-list') || d.querySelector('.no-recipes-found'))) { tagsOk = false; break; }
  d.querySelectorAll(SEL + ' h3').forEach(function (h) {
    var t = one(h.textContent);
    (TAGS[t] = TAGS[t] || []).push(opts[k].label);
  });
}
if (!tagsOk) { console.warn('[soglowek] location filter failed, title cue only'); TAGS = {}; }
var CUE = /(?:^|[\s,–-])אתר[\s\-–:]+([^,]+)$/;
var dropped = [];
rows.forEach(function (row) {
  var h = row.querySelector('.career__toggle h3');
  var title = one(h && h.textContent).replace(MATH, function (ch) { return ch.normalize('NFKC'); });
  if (!title) return;
  if (!OK1.test(title) || BAD.test(title)) { dropped.push(title); return; }
  var D = lines(row.querySelector('.career__toggle p'));
  if (D.length) D[0] = D[0].replace(DLABEL, '');
  D = D.filter(function (l) { return l; });
  var R = lines(row.querySelector('.career__body'));
  var tags = TAGS[one(h.textContent)] || [];
  var m = CUE.exec(title), cue = m ? m[1].split('/').map(one).filter(function (x) { return x; }) : [];
  var loc = tags.slice();
  if (!tags.length) loc = cue;
  else if (cue.some(function (c) { return tags.indexOf(c) >= 0; })) cue.forEach(function (c) { if (loc.indexOf(c) < 0) loc.push(c); });
  var mail = row.querySelector('a[href^="mailto:"]');
  var addr = mail ? (mail.getAttribute('href') || '').replace(/^mailto:/i, '').split('?')[0].trim() : '';
  var add = function (cls, v) { var e = document.createElement('span'); e.className = cls + ' wp-exclude-emoji'; e.style.display = 'none'; e.textContent = v; row.appendChild(e); };
  add('__ai-title', title);
  if (D.length) add('__ai-description', D.join('\n'));
  if (R.length) add('__ai-requirements', R.join('\n'));
  if (loc.length) add('__ai-location', loc.join(' | '));
  if (addr) add('__ai-applicationInfo', 'mailto:' + addr);
});
console.log('[soglowek] rows ' + rows.length + ', tags ' + (tagsOk ? opts.length + ' filters' : 'failed') + ', dropped ' + dropped.length + ', ' + (Date.now() - T0) + ' ms');
