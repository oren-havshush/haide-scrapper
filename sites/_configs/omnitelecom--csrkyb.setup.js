// omnitelecom.co.il/join-the-team: WordPress + Elementor, post type "jobs", one listing page with two
// groups of title links (article.ee-post), no pager. The body and the apply form are on each job page.
// The script reads every card, then every job page, ALL-OR-NOTHING (a failed fetch, a redirect or a
// page without the job template builds no item).
// - description / requirements: the job page's post content, split by its own labels: "תיאור" /
//   "תיאור המשרה" open the description, "דרישות" / "כישורים" the requirements, and the labels are dropped.
//   A "למה (כדאי) להצטרף" block goes back to the description. Line breaks kept, text as printed.
// - department: the job page's category heading (שירות לקוחות / פיתוח).
// - id: two job addresses are ASCII (emitted as omnitelecom-<slug>); the others are Hebrew, so no id is
//   emitted for them and the worker builds an h- id from title, department and url. No post ids.
// - location: only a work-location line of the ad names the place (closed list, city.csv rows). A job
//   whose text names no city and no field work takes the company's city (SITE_CITY, LRN-LOC-20).
// - date: the job post's publish date (WP REST date_gmt); the page prints none.
// - apply: the job page's own Elementor form, one blob per job; the hidden job-title field is filled
//   with the job's title, as the page's own script does. The form has a REQUIRED marketing-consent box
//   (form_fields[promotional_accept]), pre-checked on the page; captured as it is (decided 2026-10-18),
//   and the public site decides whether to show the job.
if (document.getElementById('haide-omni')) return;
if (!document.querySelector('article.ee-post.type-jobs')) return;
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
var cards = Array.prototype.map.call(document.querySelectorAll('article.ee-post.type-jobs'), function (c) {
  var a = c.querySelector('a.ee-post__title');
  return {
    pid: ((/(?:^|\s)post-(\d+)(?:\s|$)/.exec(c.className) || [])[1]) || '',
    title: clean(a ? a.textContent : ''),
    url: a ? new URL(a.getAttribute('href'), location.href).href : ''
  };
});
if (!cards.length || cards.some(function (c) { return !c.title || !c.url; })) { console.warn('[omni] card read failed'); return; }
// --- publish dates (one request; a failure leaves the jobs undated, nothing else) ---
var DATE = {};
var rj = await get(location.origin + '/wp-json/wp/v2/jobs?per_page=100&_fields=id,date_gmt');
try { (JSON.parse(rj || '[]') || []).forEach(function (p) { if (p && p.id && p.date_gmt) DATE[String(p.id)] = p.date_gmt + 'Z'; }); } catch (e) {}
// --- the job pages ---
var pages = [];
for (var i = 0; i < cards.length; i++) {
  var h = await get(cards[i].url);
  var d = h && new DOMParser().parseFromString(h, 'text/html');
  var body = d && d.querySelector('.elementor-widget-theme-post-content');
  if (!body || !d.querySelector('body.single-jobs')) { console.warn('[omni] job page failed: ' + cards[i].url); return; }
  pages.push(d);
}
var D_LAB = /^תיאור( המשרה| התפקיד)?$/, R_LAB = /^(דרישות( המשרה| התפקיד)?|כישורים)$/, D_BACK = /^למה (כדאי )?להצטרף/;
var labOf = function (l) { return l.replace(/[:\s]+$/, ''); };
var linesOf = function (w) {
  var c = w.cloneNode(true);
  c.querySelectorAll('script, style, svg, form').forEach(function (e) { e.remove(); });
  c.querySelectorAll('br').forEach(function (e) { e.replaceWith('\n'); });
  c.querySelectorAll('p, li, div, h1, h2, h3, h4, h5, h6, tr').forEach(function (e) { e.appendChild(document.createTextNode('\n')); });
  return (c.textContent || '').split('\n').map(function (l) { return l.replace(WS, ' ').trim(); }).filter(function (l) { return l; });
};
var split = function (w) {
  var D = [], R = [], to = D;
  linesOf(w).forEach(function (l) {
    var lab = labOf(l);
    if (D_LAB.test(lab)) { to = D; return; }
    if (R_LAB.test(lab)) { to = R; return; }
    if (D_BACK.test(lab)) to = D;
    to.push(l);
  });
  return { d: D.join('\n'), r: R.join('\n'), lines: D };
};
// work-location lines: a place from the closed list on a line that says where the work or the company is
var PLACES = [['רמת גן', /ברמת[ -]גן/]];
var CUE = /(עבודה|משרה|במשרד|ממשרדי|הממוקמת|ממוקמת)/;
var FIELD = /(עבודת שטח|בשטח|אצל לקוחות|ברחבי הארץ|בפריסה ארצית)/;
var SITE_CITY = 'רמת גן';
var UNDATED_SLUGS = ['רצ-פיתוח'];
var placeOf = function (lines) {
  var out = [];
  lines.forEach(function (l) {
    if (!CUE.test(l)) return;
    PLACES.forEach(function (p) { if (p[1].test(l) && out.indexOf(p[0]) < 0) out.push(p[0]); });
  });
  if (!out.length && !lines.some(function (l) { return FIELD.test(l); })) out.push(SITE_CITY);
  return out;
};
var blobOf = function (d, url, title) {
  var fm = d.querySelector('form.elementor-form');
  if (!fm) return '';
  var fields = [];
  fm.querySelectorAll('input, select, textarea').forEach(function (e) {
    var ft = (e.tagName === 'INPUT' ? (e.getAttribute('type') || 'text') : e.tagName.toLowerCase()).toLowerCase();
    if (/^(submit|button|reset|image)$/.test(ft) || !e.name) return;
    if (e.name === 'g-recaptcha-response') return;
    var lb = e.id ? fm.querySelector('label[for="' + e.id + '"]') : null;
    var o = { name: e.name, label: clean(lb ? lb.textContent : (e.getAttribute('placeholder') || '')), fieldType: ft, tagName: e.tagName,
      required: e.hasAttribute('required') };
    if (e.hasAttribute('value') && ft !== 'file') o.value = e.getAttribute('value') || '';
    if (e.name === 'form_fields[8165846]') { o.value = title; o.label = 'job title'; }
    if (ft === 'file' && e.getAttribute('accept')) o.accept = e.getAttribute('accept');
    fields.push(o);
  });
  return JSON.stringify({ actionUrl: location.origin + '/wp-admin/admin-ajax.php', actionAttribute: '', formClass: fm.getAttribute('class') || '',
    formTag: 'form', method: 'POST', enctype: 'multipart/form-data', pageUrl: url, fields: fields });
};
// --- the items ---
var root = document.createElement('div');
root.id = 'haide-omni';
root.style.display = 'none';
var dropped = [];
cards.forEach(function (c, k) {
  var title = c.title.replace(MATH, function (ch) { return ch.normalize('NFKC'); });
  if (!OK1.test(title) || BAD.test(title)) { dropped.push(c.pid + ':lang'); return; }
  var d = pages[k];
  var s = split(d.querySelector('.elementor-widget-theme-post-content'));
  var cat = clean((d.querySelector('h1.elementor-heading-title a[rel="tag"]') || {}).textContent);
  var loc = placeOf(s.lines);
  var slug = (/\/jobs\/([^\/?#]+)\/?$/.exec(c.url) || [])[1] || '';
  var id = /^[a-z0-9-]+$/.test(slug) ? 'omnitelecom-' + slug : '';
  var blob = blobOf(d, c.url, clean((d.querySelector('#name-job') || {}).textContent) || title);
  var it = document.createElement('div');
  it.className = 'haide-job';
  var add = function (cls, v) { var e = document.createElement('span'); e.className = cls + ' wp-exclude-emoji'; e.textContent = v; it.appendChild(e); };
  var a = document.createElement('a');
  a.className = 'haide-link wp-exclude-emoji'; a.href = c.url; a.textContent = title;
  it.appendChild(a);
  if (id) add('__ai-externalJobId', id);
  if (cat) add('__ai-department', cat);
  if (s.d) add('__ai-description', s.d);
  if (s.r) add('__ai-requirements', s.r);
  if (loc.length) add('__ai-location', loc.join(' | '));
  // LRN-AGE-6 (owner 2026-10-18): this post's address names another job (ר"צ פיתוח), so its post date is not this job's date.
  var dslug = slug; try { dslug = decodeURIComponent(slug); } catch (e) {}
  var undated = UNDATED_SLUGS.indexOf(dslug) >= 0;
  if (DATE[c.pid] && !undated) add('__ai-publishDate', DATE[c.pid]);
  if (blob) { add('__ai-applicationInfo', blob); add('__ai-formData', blob); }
  root.appendChild(it);
});
document.body.appendChild(root);
console.log('[omni] cards ' + cards.length + ', jobs ' + root.children.length + ', dated ' + Object.keys(DATE).length + ', dropped ' + dropped.join(' ') + ', ' + (Date.now() - T0) + ' ms');
