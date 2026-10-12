/* codeoasis.com careers (Hebrew page; the English /en/careers/ page uses the same template).
   WP accordion .co-faq: <a class="title"> + <div class="faq-details"> siblings, no wrapper,
   no detail pages. Item = div.faq-details; the title comes from the preceding a.title.
   Id: no printed job number and no id attribute (#faq-N is only a position), so no id is
   emitted and the worker builds an h- id from title and department.
   Apply: email. Cloudflare email protection is decoded here (data-cfemail and
   /cdn-cgi/l/email-protection#), so nothing depends on CF's own decoder having run.
   applicationInfo = mailto:<the address the job prints, lowercased>. No ad asks the
   candidate to name the job, so nothing follows the address.
   Body: lines routed by the ad's own headings (labels dropped); requirement-class headings
   open requirements; apply lines (an address, "CV to", "Apply now") leave both fields.
   A job with no heading whose first line is an experience line is all requirements.
   Location: from a work-location cue (closed list). Site rule (owner 2026-10-12): the company
   prints one address (Abba Eban 16, Herzliya), so an ad that names no place and hints at no
   field work or other place gets הרצליה. An ad with a field-work hint or an unlisted place
   cue stays Unknown. Decided from the ad text only, never from the id. */
function dec(h) {
  var k = parseInt(h.slice(0, 2), 16), o = '';
  for (var i = 2; i < h.length; i += 2) o += String.fromCharCode(parseInt(h.slice(i, i + 2), 16) ^ k);
  return o;
}
function lines(el) {
  var c = el.cloneNode(true);
  c.querySelectorAll('[data-cfemail]').forEach(function (e) { e.textContent = dec(e.getAttribute('data-cfemail')); });
  c.querySelectorAll('a[href*="email-protection#"]').forEach(function (a) {
    var h = a.getAttribute('href').split('#')[1] || '';
    if (/^[0-9a-f]+$/i.test(h) && !/@/.test(a.textContent)) a.textContent = dec(h);
  });
  c.querySelectorAll('script,style,.__ai').forEach(function (e) { e.remove(); });
  var w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT, null), t;
  while ((t = w.nextNode())) t.nodeValue = t.nodeValue.replace(/\s+/g, ' ');
  c.querySelectorAll('p,div,ul,ol,li,br,h1,h2,h3,h4,h5,h6').forEach(function (e) { e.insertAdjacentText('afterend', '\n'); });
  return c.textContent.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
}
var EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;
var DESC_HEAD = /^(תיאור|תיאור התפקיד|מה התפקיד\?|RESPONSIBILITIES|Job Description|Description)\s*:?$/i;
var REQ_HEAD = /^(דרישות|דרישות התפקיד|מהן הדרישות\?|Requirements|Job Requirements|REQUIRED SKILLS|QUALIFICATIONS)\s*:?$/i;
var APPLY = /^(CV to|CV send to|Send your CV|קורות חיים)|apply now/i;
var GENDER = /לנשים (ו)?גברים כאחד|לנשים ולגברים כאחד/;
var EXP = /^(At least|Minimum|\d+\+? years|ניסיון|לפחות)/i;
var PLACES = [[/team in Herzliya/i, 'הרצליה'], [/ממוקמ\S*\s+ב(א)?יזור המרכז/, 'אזור מרכז']];
var HQ = 'הרצליה';
var FIELD = /עבודת שטח|אצל (ה)?לקוח|באתרי (ה)?לקוח|ברחבי הארץ|פריסה ארצית|נסיעות|outsourc|on-?site|at (our |the )?client|customer site|travel/i;
var OTHER = /ממוקמ|מיקום|באזור|באיזור|located|location|based in|office in|remote|מהבית|היברידי|hybrid/i;
var OK = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
function add(item, cls, text) {
  var s = document.createElement('span');
  s.className = cls + ' __ai';
  s.style.display = 'none';
  s.textContent = text;
  item.appendChild(s);
}
document.querySelectorAll('.co-faq .faq-details').forEach(function (item) {
  if (item.querySelector('.__ai-title')) return;
  var head = item.previousElementSibling;
  if (!head || !head.matches('a.title')) return;
  var title = head.textContent.replace(/\s+/g, ' ').trim();
  if (!title || !OK.test(title) || BAD.test(title)) return;
  var ls = lines(item), addr = '';
  ls.forEach(function (l) { var m = EMAIL.exec(l); if (m && !addr) addr = m[0]; });
  if (!addr) {
    var a = item.querySelector('a[href^="mailto:"]');
    if (a) addr = a.getAttribute('href').replace(/^mailto:/i, '').split('?')[0];
  }
  var hasHead = ls.some(function (l) { return DESC_HEAD.test(l) || REQ_HEAD.test(l); });
  var mode = !hasHead && ls.length && EXP.test(ls[0]) ? 'r' : 'd';
  var desc = [], req = [];
  ls.forEach(function (l) {
    if (DESC_HEAD.test(l)) { mode = 'd'; return; }
    if (REQ_HEAD.test(l)) { mode = 'r'; return; }
    if (EMAIL.test(l) || APPLY.test(l)) return;
    if (GENDER.test(l)) { desc.push(l); return; }
    (mode === 'r' ? req : desc).push(l);
  });
  var all = ls.join('\n'), loc = [];
  PLACES.forEach(function (p) { if (p[0].test(all) && loc.indexOf(p[1]) < 0) loc.push(p[1]); });
  if (!loc.length && !FIELD.test(title + '\n' + all) && !OTHER.test(all)) loc.push(HQ);
  add(item, '__ai-title', title);
  add(item, '__ai-description', desc.join('\n'));
  add(item, '__ai-requirements', req.join('\n'));
  add(item, '__ai-location', loc.length ? loc.join(', ') : 'Unknown');
  if (addr) add(item, '__ai-apply', 'mailto:' + addr.toLowerCase());
});
