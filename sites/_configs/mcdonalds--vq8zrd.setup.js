var ITEM = '.mod_form_main_job_wrapper';
// Location from the card's own storeids attribute, read against the restaurant
// filter on the same page (2026-10-06). ";all;" is every restaurant. A store id
// not listed here adds nothing; a job left with none ships Unknown.
var STORE = {
  '313': 'נתניה',
  '254': 'נתב"ג', '255': 'נתב"ג', '256': 'נתב"ג',
  '38': 'אילת', '212': 'אילת', '239': 'אילת', '281': 'אילת', '288': 'אילת'
};
// The ad names its branch while its storeids say ";all;" (a branch not yet in
// the restaurant list): the named city is inside "everywhere", so it wins.
var BY_SLUG = { 'דרושות_ודרושים_לסניף_אופקים_החדש': 'אופקים' };
var NATIONWIDE = 'פריסה ארצית';
var INVIS = new RegExp('[' + String.fromCharCode(0x200B, 0x200E, 0x200F, 0xA0, 0xFEFF) + ']', 'g');
var REQ = /^(ניסיון|נסיון|ידע|רישיון|רשיון|תעודה|תעודת|בעל\/ת|בעלי|יכולת|נכונות|זמינות|שליטה|הכרה|הכרת|מגורים|דובר|עדיפות|נדרש|יוצא|רצוי|גישה|לגילאי)/;
function haideHash(s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); }
function lines(el) {
  if (!el) return [];
  var c = el.cloneNode(true);
  var w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
  var tn;
  while ((tn = w.nextNode())) tn.nodeValue = tn.nodeValue.replace(/\s+/g, ' ');
  c.querySelectorAll('br').forEach(function (b) { b.replaceWith('\n'); });
  c.querySelectorAll('p,div,ul,ol,li,h1,h2,h3,h4,h5,h6,tr').forEach(function (e) { e.insertAdjacentText('afterend', '\n'); });
  return c.textContent.split('\n').map(function (s) { return s.replace(INVIS, ' ').trim(); })
    .filter(function (s) { return s.length > 0; });
}
function put(item, cls, text, href) {
  if (item.querySelector('.' + cls)) return;
  var s = document.createElement(href ? 'a' : 'span');
  s.className = cls; s.style.display = 'none';
  if (href) s.setAttribute('href', href);
  s.textContent = text;
  item.appendChild(s);
}
document.querySelectorAll(ITEM).forEach(function (item) {
  var a = item.querySelector('a.mod_form_main_job_button');
  var h1 = item.querySelector('.mod_form_main_job_title');
  if (!a || !h1) return;
  var url = new URL(a.getAttribute('href'), location.href).href;
  var slug = decodeURIComponent(url.split('?')[0].split('/').filter(Boolean).pop());
  var desc = [], req = [];
  lines(item.querySelector('.mod_form_main_job_content')).forEach(function (l) {
    var t = l.replace(/^[*•▪\-–\s]+/, '');
    if (!/דרוש/.test(t) && (REQ.test(t) || /חובה|יתרון/.test(t))) req.push(l); else desc.push(l);
  });
  var locs = [];
  if (BY_SLUG[slug]) locs.push(BY_SLUG[slug]);
  else (item.getAttribute('storeids') || '').split(';').forEach(function (id) {
    var v = id === 'all' ? NATIONWIDE : STORE[id];
    if (v && locs.indexOf(v) < 0) locs.push(v);
  });
  if (locs.indexOf(NATIONWIDE) >= 0) locs = [NATIONWIDE];
  put(item, '__ai-id', 'mcdonalds-' + haideHash(slug));
  put(item, '__ai-title', h1.textContent.trim());
  put(item, '__ai-description', desc.join('\n'));
  put(item, '__ai-requirements', req.join('\n'));
  put(item, '__ai-location', locs.length ? locs.join(', ') : 'Unknown');
  put(item, '__ai-detailurl', url, url);
});
