// kedmi770.co.il/careers after the 2026-10 rebuild (Next.js). Every job is a server-rendered
// <section> under .legacy-document-sections: <h2> title, <p> text, <ul> requirements. No detail pages.
// - title: the <h2> as printed.
// - description (.__ai-description): the section's <p> lines, then the text the page prints once for
//   all jobs (holmesplace rule): the <aside> note above the list, and the closing section's text
//   without its heading and without its apply sentence (that sentence is the applicationInfo).
// - requirements (.__ai-requirements): the section's <ul>, moved as markup so the bullets survive.
// - externalJobId: NOT emitted. No printed number, no id attribute, no per-job URL; the worker
//   synthesises h-<hash> (addsite3 6.2). The pre-rebuild ids were the titles.
// - location (.__ai-location): חולון for every job. The ads name no place; the page prints one company
//   address (footer "הכישור 47, חולון"); both roles are office roles (LRN-LOC-20).
// - applicationInfo (.__ai-apply): text, not a form (owner 2026-10-22): the closing section's apply
//   sentence as printed ("שלחו פרטים דרך עמוד יצירת הקשר…") and the contact page's address. The
//   /contact form posts JSON to /api/leads, which a stored form cannot describe yet (asked of Shay).
//   No apply sentence, or no job -> nothing is built and the run refuses (zero match), never a partial set.
if (document.getElementById('haide-kedmi')) return;
var T0 = Date.now();
var NB = String.fromCharCode(160), ZW = String.fromCharCode(0x200B), LRM = String.fromCharCode(0x200E), RLM = String.fromCharCode(0x200F);
var WS = new RegExp('[ \\t' + NB + ']+', 'g'), ZR = new RegExp('[' + ZW + LRM + RLM + ']', 'g');
var clean = function (s) { return String(s || '').replace(ZR, '').replace(WS, ' ').trim(); };
var COMPANY = 'חולון';
var APPLY = /יצירת\s+הקשר|צור\s+קשר/;
var sections = Array.prototype.slice.call(document.querySelectorAll('.legacy-document-sections > section'));
var CONTACT = location.origin + '/contact';
var shared = [], applyLine = '';
var aside = document.querySelector('aside');
if (aside && clean(aside.textContent)) shared.push(clean(aside.textContent));
var jobs = [];
sections.forEach(function (s) {
  if (!s.querySelector('ul') && APPLY.test(s.textContent || '')) {
    Array.prototype.forEach.call(s.querySelectorAll('p'), function (p) {
      clean(p.textContent).split(/(?<=\.)\s+/).forEach(function (x) { if (!x) return; if (APPLY.test(x)) applyLine = applyLine || x; else shared.push(x); });
    });
    return;
  }
  jobs.push(s);
});
if (!jobs.length || !applyLine) { console.log('[kedmi] nothing built: sections ' + sections.length + ', jobs ' + jobs.length + ', apply line ' + !!applyLine); return; }
var root = document.createElement('div');
root.id = 'haide-kedmi-build';
root.style.display = 'none';
var drop = [];
jobs.forEach(function (s, n) {
  var h = s.querySelector('h2, h3');
  var title = h ? clean(h.textContent) : '';
  if (!title) { drop.push(n + ':notitle'); return; }
  var it = document.createElement('div'); it.className = 'haide-job';
  var add = function (cls, text) { var e = document.createElement('div'); e.className = cls; e.textContent = text; it.appendChild(e); };
  var d = [];
  Array.prototype.forEach.call(s.querySelectorAll(':scope > p'), function (p) { var t = clean(p.textContent); if (t) d.push(t); });
  if (shared.length) d = d.concat(d.length ? [''] : [], shared);
  add('__ai-title', title);
  if (d.length) add('__ai-description', d.join('\n'));
  var ul = s.querySelector(':scope > ul');
  if (ul) { var r = document.createElement('div'); r.className = '__ai-requirements'; r.appendChild(ul.cloneNode(true)); it.appendChild(r); }
  add('__ai-location', COMPANY);
  add('__ai-apply', applyLine + '\n' + CONTACT);
  root.appendChild(it);
});
if (root.children.length) root.id = 'haide-kedmi';
document.body.appendChild(root);
console.log('[kedmi] sections ' + sections.length + ', jobs ' + root.children.length + ', dropped ' + drop.join(' ') + ', ' + (Date.now() - T0) + ' ms');
