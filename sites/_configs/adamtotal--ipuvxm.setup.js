// Tempo Beverages on AdamTotal (career.adamtotal.co.il, token 5fiBEc...), listing-only:
// every card carries the full job body in .description-text; the pager's pages 2+ are appended here.
var ITEM = 'article.job-card', prev = -1, stable = 0;
for (var t = 0; t < 60; t++) {
  var n = document.querySelectorAll(ITEM).length;
  if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n;
  await new Promise(function (r) { setTimeout(r, 500); });
}
function each(s, f, root) { (root || document).querySelectorAll(s).forEach(f); }
function put(item, cls, val) {
  var s = document.createElement('span');
  s.className = cls; s.style.display = 'none'; s.textContent = val;
  item.appendChild(s);
}
function addU(a, v) { if (a.indexOf(v) < 0) a.push(v); }
var TOK = new URL(location.href).searchParams.get('token') || '';

// Pages 2..last from the pager, all or nothing: a failed page empties the grid. Every row is
// kept; a job seen on two pages is collapsed by the worker on its detail link.
var first = document.querySelector(ITEM);
if (first && !document.querySelector('.__ai-paged')) {
  var box = first.parentElement, last = 1, ok = true;
  each('a[href*="page="]', function (a) { var m = (a.getAttribute('href') || '').match(/[?&]page=(\d+)/); if (m && +m[1] > last) last = +m[1]; });
  for (var pg = 2; pg <= last && pg <= 40; pg++) {
    var cards = [];
    try {
      var res = await fetch('/Home/Index?page=' + pg + '&token=' + encodeURIComponent(TOK), { credentials: 'same-origin' });
      if (!res.ok || res.redirected) { ok = false; break; }
      cards = new DOMParser().parseFromString(await res.text(), 'text/html').querySelectorAll(ITEM);
    } catch (e) { ok = false; break; }
    if (!cards.length) { ok = false; break; }
    cards.forEach(function (a) { box.appendChild(document.importNode(a, true)); });
  }
  if (!ok) each(ITEM, function (a) { a.remove(); });
  put(document.body, '__ai-paged', '');
}

// Per-job apply form: the page adds OrderNo (the job number) and Token at submit. [name, type, value, label, required]
var H = 'hidden', TS = 'cf-turnstile-response', FB = [['domain', H, ''], ['shared', H, ''], ['isCampaign', H, '0'],
  ['Fname', 'text', , 'שם פרטי', 1], ['Lname', 'text', , 'שם משפחה', 1], ['Phone', 'text', , 'טלפון', 1], ['Email', 'email', , 'דוא"ל'],
  ['CvFile', 'file', '.pdf,.doc,.docx', 'צרף קורות חיים'], [TS, H, , 'Cloudflare Turnstile token', 1]];
function form(no, href) {
  return JSON.stringify({ formSelector: 'form#ajax-cv-form', actionUrl: location.origin + '/Jobs/SubmitApplication', method: 'POST',
    enctype: 'multipart/form-data', pageUrl: href,
    fields: FB.concat([['OrderNo', H, no], ['Token', H, TOK]]).map(function (f) {
      var o = { name: f[0], label: f[3] || f[0], tagName: 'input', required: !!f[4], fieldType: f[1] };
      if (f[2] != null) o[f[1] === 'file' ? 'accept' : 'value'] = f[2];
      return o;
    }) });
}

function structuredText(el) {
  if (!el) return '';
  var c = el.cloneNode(true);
  each('style,script,meta', function (e) { e.remove(); }, c);
  // An <input value> is invisible to textContent (LRN-AGE-4); none in Tempo's cards, kept for safety.
  each('input', function (e) { e.replaceWith(' ' + (e.getAttribute('value') || '')); }, c);
  each('br', function (b) { var x = b.nextSibling; if (x && x.nodeType === 3) x.nodeValue = x.nodeValue.replace(/^[^\S\n]*\n/, ''); }, c);
  each('p,div,ul,ol,li,br,h1,h2,h3,h4,h5,h6,tr', function (e) { e.insertAdjacentText('afterend', '\n'); }, c);
  return c.textContent;
}

// Section labels. DROP: the field says what the text is (owner rule 2). KEEP: a terms/metrics heading stays as text.
var REQ_H = /^(דרישות( ה?(תפקיד|משרה))?|מה אנחנו מחפשים|כישורים( נדרשים)?|המאפיינים שיעזרו לכם\/ן להצליח בתפקיד)$/;
var DESC_DROP = /^(תיאור ה?(תפקיד|משרה)( ומטלות לביצוע)?|התפקיד כולל|מה כולל התפקיד|תחומי אחריות( מרכזיים| עיקריים)?|מטרת התפקיד|מטלות לביצוע|במסגרת התפקיד)$/;
var DESC_KEEP = /^(היקף ה?משרה( ומיקום)?|תנאי ה?עבודה|פרטי ה?משרה|סביבת העבודה|מדדי הצלחה בתפקיד)$/;
// Inside a requirements section: hours, scope, pay, place, benefits and the closing call stay in the description (rule 3).
var TERMS = /^(משרה מלאה|היקף|מיקום|שכר|תהליך גיוס|קליטה|נשמע|עבודה בסביבה)/;
function norm(l) { return l.replace(/[\s:?\-–]+$/, '').replace(/\s+/g, ' ').trim(); }

// Locations: labels for the config's locationMap. The tag is "<area> | <city?>" from the site's 6 regional buckets.
var AREA = ['גוש דן', 'מרכז', 'השרון', 'השפלה', 'ירושלים יו"ש', 'צפון', 'דרום', 'כל הארץ'];
// A city the map knows -> the tag areas it lies in (four-case rule, case 1).
var CITY = { 'נתניה': ['השרון'], 'רמלה': ['השפלה', 'גוש דן', 'מרכז'], 'לוד': ['השפלה', 'גוש דן', 'מרכז'], 'דלתון': ['צפון'], 'אילת': ['דרום'] };
var CITY_RE = new RegExp('(?:^|[\\s(])(?:ב|לסניף |בסניף )(' + Object.keys(CITY).join('|') + ')(?![א-ת])', 'g');
var NATION = /ברחבי הארץ|בפריסה ארצית|בכל הארץ/;
var PIN = String.fromCodePoint(0x1F4CD);
// Work-location cue lines only: "מיקום: / מיקום-", the pin line, the line under a "...מיקום" heading,
// and, in the first 3 lines, a line placing the hiring company (Tempo, its plant, branch or logistics site).
function cue(lines) {
  var cities = [], nation = false, nextIsCue = false, seen = 0;
  lines.forEach(function (l) {
    if (!l) return;
    seen++;
    var h = norm(l), isCue = false;
    if (nextIsCue) { isCue = true; nextIsCue = false; }
    if (l.length < 40 && /(^|ו)מיקום$/.test(h)) { nextIsCue = true; return; }
    if (/^(?:-\s*)?מיקום\s*[:\-–]/.test(l) || l.indexOf(PIN) === 0) isCue = true;
    if (seen <= 3 && /טמפו|מפעל|סניף|מרלו/.test(l)) isCue = 'company';
    if (!isCue) return;
    var m; CITY_RE.lastIndex = 0;
    while ((m = CITY_RE.exec(l))) addU(cities, m[1]);
    if (isCue === true && NATION.test(l)) nation = true;
  });
  return { cities: cities, nation: nation };
}

var LETTER_OK = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, LETTER_BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;

each(ITEM, function (item) {
  if (item.querySelector('.__ai-jobid')) return;
  var h4 = item.querySelector('h4.job-title-button'), ti = h4 ? h4.textContent.replace(/\s+/g, ' ').trim() : '';
  // Hebrew and English postings only (owner, 2026-09-27).
  if (!LETTER_OK.test(ti) || LETTER_BAD.test(ti)) { item.remove(); return; }
  var id = (item.getAttribute('data-job-id') || '').trim(), printed = '', tag = '';
  each('.job-meta > span', function (s) {
    if (s.querySelector('.fa-hashtag')) { var m = s.textContent.match(/(\d+)/); if (m) printed = m[1]; }
    if (s.querySelector('.fa-map-marker-alt')) tag = s.textContent;
  }, item);
  var link = item.querySelector('a.job-detail-link'), href = link ? new URL(link.getAttribute('href'), location.href).href : '';
  if (printed && printed === id) { put(item, '__ai-jobid', 'tempo-' + printed); put(item, '__ai-formData', form(printed, href)); }

  var lines = structuredText(item.querySelector('.description-text')).split('\n').map(function (l) { return l.replace(/[^\S\n]+/g, ' ').trim(); });
  // Blank lines from the markup (<li><p>) are dropped; a section change leaves one blank line.
  var desc = [], req = [], mode = 'd';
  lines.forEach(function (l) {
    if (!l) return;
    var h = norm(l);
    if (l.length < 60 && REQ_H.test(h)) { mode = 'r'; req.push(''); return; }
    if (l.length < 60 && DESC_DROP.test(h)) { mode = 'd'; desc.push(''); return; }
    if (l.length < 60 && DESC_KEEP.test(h)) { mode = 'd'; desc.push('', l); return; }
    if (mode === 'r' && TERMS.test(l)) { desc.push(l); return; }
    (mode === 'r' ? req : desc).push(l);
  });
  function join(x) { return x.join('\n').replace(/\n{3,}/g, '\n\n').trim(); }
  var d = join(desc), r = join(req);
  if (d) put(item, '__ai-description', d);
  if (r) put(item, '__ai-requirements', r);

  // Tag: its known city, else its areas (LRN-LOC-21/23). Text: a cue-line city inside the tag's
  // areas wins (case 1); a city outside them keeps the tag (case 3); no tag area -> the text (case 4).
  var areas = [], tagCities = [];
  tag.split('|').forEach(function (x) {
    x = x.replace(/\s+/g, ' ').trim(); if (!x) return;
    if (AREA.indexOf(x) >= 0) addU(areas, x); else if (CITY[x]) addU(tagCities, x);
  });
  var c = cue(lines), locs;
  if (tagCities.length) {
    locs = tagCities.slice();
    if (c.cities.some(function (x) { return tagCities.indexOf(x) >= 0; })) {
      c.cities.forEach(function (x) { addU(locs, x); });
      if (c.nation) addU(locs, 'פריסה ארצית');
    }
  } else if (!areas.length) {
    locs = c.cities.slice(); if (c.nation && locs.length) addU(locs, 'פריסה ארצית');
  } else {
    var all = areas.indexOf('כל הארץ') >= 0;
    var inside = c.cities.length && c.cities.every(function (x) { return all || CITY[x].some(function (g) { return areas.indexOf(g) >= 0; }); });
    if (inside) { locs = c.cities.slice(); if (c.nation) addU(locs, 'פריסה ארצית'); } else locs = areas;
  }
  if (locs.length) put(item, '__ai-location', locs.join(' | '));
});
