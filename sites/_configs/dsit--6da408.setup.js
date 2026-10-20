// dsit.co.il/career/ (WordPress, CPT "position"), listing-only: the worker visits no job page.
// The listing groups 12 rows (div.role-row: h3 title, teaser, a link to /position/<slug>/) under
// department accordions (".role-group-toggle h3" = "R&D (3)"). The ad body is only on the job page.
// This script GETs each job page (credentials omit: no session or Cloudflare cookie is sent; 20 s limit per
// fetch; 3 in flight) and builds one hidden div.haide-job per row in #haide-dsit.
// ALL-OR-NOTHING: if any job page fails (network error, timeout, non-2xx, redirect, no h1, no body section,
// no apply form), or the rows differ from the printed department counts, no row is built at all.
// - externalJobId: dsit-<ASCII slug of /position/<slug>/> (no printed job number; a Latin slug is a native id).
// - description: the page's intro paragraphs + "Job Description"/"Job Responsibilities" sections; requirements:
//   "Job Requirements", "Advantages", "Personal Skills/Requirements/Qualities" sections. Section labels are
//   dropped. The email line ("Please send your resume to ...") and an hours line stay in the description.
//   The Cloudflare-obfuscated address is decoded to the text a visitor sees.
// - location: the company prints one address (2 Rechavam Zeevi St., Givat Shmuel) and the ads name no other
//   place -> גבעת שמואל (LRN-LOC-20); an ad that asks for field work -> Unknown (owner to confirm).
// - publishDate: the page's JSON-LD datePublished.
// - apply: the job page's CF7 form 146 as the page sends it, one blob per job; the optional "Open Role Title"
//   field (role) carries the job title, since _wpcf7_container_post is 0 and nothing else names the job
//   (LRN-FORM-19). The Akismet textarea is a honeypot: listed in honeypots, never in fields. Consent box
//   acceptance-859 is required and NOT pre-checked. No captcha on the form.
if (document.getElementById('haide-dsit')) return;
var ROW = 'div.role-group div.role-row';
var prev = -1, stable = 0;
for (var t = 0; t < 20; t++) {
  var n = document.querySelectorAll(ROW).length;
  if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n;
  await new Promise(function (r) { setTimeout(r, 300); });
}
var T0 = Date.now();
var NBSP = String.fromCharCode(160);
var sq = function (s) { return String(s || '').split(NBSP).join(' ').replace(/[ \t]+/g, ' ').trim(); };
var OK1 = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}]/u;
var BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var DHEAD = /^(job description|job responsibilities|responsibilities|description|the role)\s*:?$/i;
var RHEAD = /^(job requirements|requirements|advantages|personal skills|personal requirements|personal qualities|qualifications|skills)\s*:?$/i;
var STAY = /send your resume|@|full-time position|part-time position/i;
var FIELD = /field ?work/i;
var CITY = 'גבעת שמואל';
// rows and the printed counts per department
var rows = [], printed = 0;
document.querySelectorAll('div.role-group').forEach(function (g) {
  var gh = g.querySelector('.role-group-toggle h3');
  var gm = /^(.*?)\s*\((\d+)\)$/.exec(sq(gh ? gh.textContent : ''));
  if (gm) printed += parseInt(gm[2], 10); else printed = NaN;
  g.querySelectorAll('div.role-row').forEach(function (rw) {
    var a = rw.querySelector('a[href*="/position/"]');
    var h3 = rw.querySelector('h3');
    rows.push({ title: sq(h3 ? h3.textContent : ''), href: a ? new URL(a.getAttribute('href'), location.href).href : '', dept: gm ? gm[1] : '' });
  });
});
var get = async function (url) {
  var ac = new AbortController();
  var timer = setTimeout(function () { ac.abort(); }, 20000);
  try {
    var r = await fetch(url, { credentials: 'omit', redirect: 'follow', signal: ac.signal, cache: 'no-store' });
    if (!r.ok || r.redirected) throw new Error('status ' + r.status + (r.redirected ? ' redirected' : '') + ' ' + url);
    return await r.text();
  } finally { clearTimeout(timer); }
};
// block-aware lines; Cloudflare email obfuscation decoded to the visible address
var lines = function (el) {
  var c = el.cloneNode(true);
  c.querySelectorAll('script,style').forEach(function (e) { e.remove(); });
  c.querySelectorAll('[data-cfemail]').forEach(function (e) {
    var h = e.getAttribute('data-cfemail') || '', k = parseInt(h.substr(0, 2), 16), s = '';
    for (var i = 2; i < h.length; i += 2) s += String.fromCharCode(parseInt(h.substr(i, 2), 16) ^ k);
    e.replaceWith(s);
  });
  c.querySelectorAll('br').forEach(function (e) { e.replaceWith('\n'); });
  c.querySelectorAll('p,div,li,ul,ol,h1,h2,h3,h4,h5,h6,tr').forEach(function (e) { e.append('\n'); });
  return c.textContent.split('\n').map(sq).filter(Boolean);
};
var parse = function (row, html) {
  var doc = new DOMParser().parseFromString(html, 'text/html');
  var top = doc.querySelector('.s-career-top-section');
  var h1 = top && top.querySelector('h1');
  var secs = doc.querySelectorAll('.position-content-section .row');
  var fm = Array.prototype.filter.call(doc.querySelectorAll('form.wpcf7-form'), function (f) { return f.querySelector('input[type="file"]'); })[0];
  if (!h1 || !secs.length || !fm) throw new Error('page shape ' + row.href);
  var D = [], R = [], all = [];
  top.querySelectorAll('p:not(#breadcrumbs)').forEach(function (p) { lines(p).forEach(function (l) { D.push(l); all.push(l); }); });
  secs.forEach(function (s) {
    var h = s.querySelector('h2'), ct = s.querySelector('.content');
    var head = sq(h ? h.textContent : '');
    var mode = RHEAD.test(head) ? 'r' : 'd';
    if (head && !DHEAD.test(head) && !RHEAD.test(head) && head !== row.title && head !== sq(h1.textContent)) D.push(head);
    (ct ? lines(ct) : []).forEach(function (l) {
      if (DHEAD.test(l)) { mode = 'd'; return; }
      if (RHEAD.test(l)) { mode = 'r'; return; }
      all.push(l);
      if (mode === 'r' && !STAY.test(l)) R.push(l); else D.push(l);
    });
  });
  if (!D.length && !R.length) throw new Error('no text ' + row.href);
  var dp = (/"datePublished":"([^"]+)"/.exec(html) || [])[1] || '';
  var fields = [], honeypots = [];
  fm.querySelectorAll('input, select, textarea').forEach(function (e) {
    var ft = (e.tagName === 'INPUT' ? (e.getAttribute('type') || 'text') : e.tagName.toLowerCase()).toLowerCase();
    if (/^(submit|button|reset|image)$/.test(ft) || !e.name) return;
    if (ft !== 'hidden' && (e.closest('.akismet-fields-container') || /_hp_|honeypot/i.test(e.name))) { honeypots.push(e.name); return; }
    var lb = e.closest('label');
    var o = { name: e.name, label: sq(lb ? lb.textContent : e.name) || e.name, fieldType: ft, tagName: e.tagName,
      required: e.getAttribute('aria-required') === 'true' || /validates-as-required/.test(e.className) || !!e.closest('.wpcf7-acceptance:not(.optional)') };
    if (ft === 'hidden') o.value = e.getAttribute('value') || '';
    if (e.getAttribute('accept')) o.accept = e.getAttribute('accept');
    if (e.name === 'role') o.value = row.title;
    if (ft === 'checkbox' && e.hasAttribute('checked')) o.checked = true;
    fields.push(o);
  });
  if (!fields.some(function (f) { return f.name === 'role'; })) throw new Error('no role field ' + row.href);
  var act = new URL(fm.getAttribute('action') || '', row.href).href;
  var blob = JSON.stringify({ actionUrl: act, actionAttribute: act, formClass: fm.getAttribute('class') || '', formTag: 'form',
    method: 'POST', enctype: fm.getAttribute('enctype') || 'multipart/form-data', pageUrl: row.href, fields: fields, honeypots: honeypots });
  var loc = all.some(function (l) { return FIELD.test(l); }) ? 'Unknown' : CITY;
  return { d: D.join('\n'), r: R.join('\n'), date: dp, blob: blob, loc: loc };
};
var jobs = [];
try {
  if (!rows.length || rows.length !== printed) throw new Error('rows ' + rows.length + ' vs printed ' + printed);
  rows.forEach(function (r) { if (!r.title || !/^https:\/\/dsit\.co\.il\/position\/[^\/]+\/$/.test(r.href)) throw new Error('row shape ' + r.href); });
  var out = new Array(rows.length), next = 0;
  var worker = async function () {
    while (next < rows.length) { var i = next++; out[i] = parse(rows[i], await get(rows[i].href)); }
  };
  await Promise.all([worker(), worker(), worker()]);
  jobs = rows.map(function (r, i) { return Object.assign({}, r, out[i]); });
} catch (e) {
  console.log('[dsit] no rows built: ' + e);
  jobs = [];
}
if (jobs.length) {
  var root = document.createElement('div');
  root.id = 'haide-dsit';
  root.style.display = 'none';
  var dropped = [];
  jobs.forEach(function (j) {
    if (!OK1.test(j.title) || BAD.test(j.title)) { dropped.push(j.href + ':lang'); return; }
    var it = document.createElement('div');
    it.className = 'haide-job';
    var add = function (cls, v) { var e = document.createElement('span'); e.className = cls; e.textContent = v; it.appendChild(e); };
    var a = document.createElement('a');
    a.className = 'haide-link'; a.href = j.href; a.textContent = j.title;
    it.appendChild(a);
    var slug = (/\/position\/([a-z0-9-]+)\/$/.exec(j.href) || [])[1];
    if (slug) add('__ai-externalJobId', 'dsit-' + slug);
    if (j.dept) add('__ai-department', j.dept);
    if (j.d) add('__ai-description', j.d);
    if (j.r) add('__ai-requirements', j.r);
    add('__ai-location', j.loc);
    var dt = new Date(j.date);
    if (j.date && !isNaN(dt)) add('__ai-publishDate', dt.toISOString());
    add('__ai-applicationInfo', j.blob);
    add('__ai-formData', j.blob);
    root.appendChild(it);
  });
  document.body.appendChild(root);
  console.log('[dsit] rows ' + rows.length + ', jobs ' + root.children.length + ', dropped ' + dropped.join(' ') + ', ' + (Date.now() - T0) + ' ms');
}
