// shlomit.org.il "בואו לעבוד איתנו": an Elementor loop grid of CPT `jobs`, 2 cards per page over /2/ /3/ /4/.
// The setupScript runs once, on page 1, so the later pages are fetched by their own "הבא" links and their cards
// appended to page 1's grid, all-or-nothing: a failed page, a redirect or a page without cards empties the grid.
// Per card: a link with a distinct url (page 1 + #job-<post>), description (intro + the היקף המשרה line),
// requirements (the דרישות התפקיד list), location from the title's "באיזור/לאיזור" phrase through a closed
// city.csv table, publishDate from the post's REST `date`. No externalJobId: the site prints no job number,
// so the worker builds an h- id from title, department and url.
var ITEM = '.e-loop-item.type-jobs';
if (document.querySelector('.__ai-link')) return;
var grid = document.querySelector('.elementor-loop-container');
if (!grid) return;
var nextOf = function (doc) { var a = doc.querySelector('a.page-numbers.next'); return a ? new URL(a.getAttribute('href'), location.href).href : ''; };
var next = nextOf(document), visited = [location.href.split('#')[0]], ok = true;
while (next && ok && visited.length < 30) {
  if (visited.indexOf(next) !== -1) break;
  visited.push(next);
  try {
    var r = await fetch(next, { credentials: 'same-origin', cache: 'no-store' });
    if (!r.ok || r.redirected) { ok = false; break; }
    var doc = new DOMParser().parseFromString(await r.text(), 'text/html');
    var more = doc.querySelectorAll(ITEM);
    if (!more.length) { ok = false; break; }
    more.forEach(function (it) { grid.appendChild(document.importNode(it, true)); });
    next = nextOf(doc);
  } catch (e) { ok = false; }
}
if (!ok) { document.querySelectorAll(ITEM).forEach(function (it) { it.remove(); }); console.log('[shlomit] page walk failed at ' + next + ', grid emptied'); return; }

var dates = {};
try {
  var rr = await fetch(location.origin + '/wp-json/wp/v2/jobs?per_page=100&_fields=id,date', { credentials: 'omit', cache: 'no-store' });
  if (rr.ok) (await rr.json()).forEach(function (j) { if (j && j.id && /^\d{4}-\d\d-\d\d/.test(j.date || '')) dates[String(j.id)] = j.date.slice(0, 10); });
} catch (e) { /* no dates; the jobs still ship */ }
// 3042 was the April 2026 general posting "דרושים רכזים ברחבי הארץ", later retitled to Dimona: its post date is not this ad's.
delete dates['3042'];

var PLACES = [['תל אביב', 'תל אביב-יפו'], ['המרכז', 'אזור מרכז'], ['חיפה', 'חיפה'], ['הקריות', 'אזור צפון'], ['עכו', 'עכו'],
  ['נהריה', 'נהריה'], ['גליל מערבי', 'אזור צפון'], ['ירושלים', 'ירושלים'], ['דימונה', 'דימונה'], ['ירוחם', 'ירוחם'], ['ערד', 'ערד']];
var HEB_LAT = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, OTHER = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var base = location.origin + location.pathname;
var clean = function (s) { return (s || '').replace(/\s+/g, ' ').trim(); };

document.querySelectorAll(ITEM).forEach(function (it) {
  var m = it.className.match(/(?:^|\s)post-(\d+)(?:\s|$)/);
  var h = it.querySelector('h2.elementor-heading-title');
  var title = clean(h && h.textContent);
  if (!m || !title || !HEB_LAT.test(title) || OTHER.test(title)) { it.remove(); return; }
  var box = document.createElement('div');
  box.className = '__ai-box wp-exclude-emoji';
  box.style.display = 'none';
  var add = function (tag, cls, text) { var e = document.createElement(tag); e.className = cls + ' wp-exclude-emoji'; if (text != null) e.textContent = text; box.appendChild(e); return e; };
  var a = add('a', '__ai-link', title);
  a.setAttribute('href', base + '#job-' + m[1]);

  var desc = add('div', '__ai-description');
  var body = it.querySelector('.elementor-widget-theme-post-content');
  if (body) [].forEach.call(body.children, function (p) { if (clean(p.textContent)) desc.appendChild(p.cloneNode(true)); });
  it.querySelectorAll('.job-data-wrapper .job-scope').forEach(function (s) {
    var lab = clean((s.querySelector('h4') || {}).textContent);
    var vals = [].map.call(s.querySelectorAll('.taxonomy-name'), function (n) { return clean(n.textContent); }).filter(Boolean);
    if (vals.length) { var p = document.createElement('p'); p.className = 'wp-exclude-emoji'; p.textContent = (lab ? lab + ' ' : '') + vals.join(', '); desc.appendChild(p); }
  });

  var req = add('ul', '__ai-requirements');
  it.querySelectorAll('.job-data-wrapper .job-requirements .taxonomy-name').forEach(function (n) {
    var t = clean(n.textContent);
    if (t) { var li = document.createElement('li'); li.className = 'wp-exclude-emoji'; li.textContent = t; req.appendChild(li); }
  });

  var area = title.match(/(?:^|\s)[בל]א(?:י)?זור\s+(.+)$/);
  var locs = [];
  if (area) PLACES.forEach(function (p) { if (area[1].indexOf(p[0]) !== -1 && locs.indexOf(p[1]) === -1) locs.push(p[1]); });
  if (locs.length) add('span', '__ai-location', locs.join(', '));
  if (dates[m[1]]) add('span', '__ai-publishDate', dates[m[1]]);
  it.appendChild(box);
});
