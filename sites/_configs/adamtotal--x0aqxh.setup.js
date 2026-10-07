// FEMI on AdamTotal (career.adamtotal.co.il, token 401C99FB...). Listing-only:
// every card carries the full job body in .description-text; one page, no pager.
var ITEM = 'article.job-card';
var prev = -1, stable = 0;
for (var t = 0; t < 60; t++) {
  var n = document.querySelectorAll(ITEM).length;
  if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n;
  await new Promise(function (r) { setTimeout(r, 500); });
}

function structuredText(el) {
  if (!el) return '';
  var c = el.cloneNode(true);
  c.querySelectorAll('style,script,meta').forEach(function (e) { e.remove(); });
  c.querySelectorAll('br').forEach(function (b) {
    var nx = b.nextSibling;
    if (nx && nx.nodeType === 3) nx.nodeValue = nx.nodeValue.replace(/^[^\S\n]*\n/, '');
  });
  c.querySelectorAll('p,div,ul,ol,li,br,h1,h2,h3,h4,h5,h6,tr').forEach(function (e) { e.insertAdjacentText('afterend', '\n'); });
  return c.textContent;
}
function put(item, cls, val) {
  var s = document.createElement('span');
  s.className = cls; s.style.display = 'none'; s.textContent = val;
  item.appendChild(s);
}

// Standalone section headings; the label itself is dropped (owner rule 2).
var REQ_H = /^(דרישות( ה?(משרה|תפקיד))?|מה אנחנו מחפשים|כישורים( נדרשים)?)$/;
var DESC_H = /^(תיאור ה?(משרה|תפקיד)|התפקיד כולל|תחומי אחריות|מה אנחנו מציעים|מה כולל התפקיד|פרטי ה?משרה|מה בתפקיד|למה לעבוד אצלנו|מי אנחנו|במסגרת ה?תפקיד|במסגרת בתפקיד|למה כדאי להצטרף אלינו|מה מחכה לכם אצלנו|היקף המשרה ושעות עבודה)$/;
// A requirement line with no heading (rule 1): ends in "- חובה" / "יתרון".
var REQ_LINE = /(חובה|יתרון( משמעותי| מהותי)?)\s*[!.]?\s*$/;
// Inside a requirements section, pay / hours / scope stay in the description (rule 3).
var TERMS = /שכר|בונוס|היקף|שעות|^משרה (מלאה|חלקית)|^-?\s*מיקו[םמ]/;
function norm(l) { return l.replace(/[\s:?\-–]+$/, '').replace(/\s+/g, ' ').trim(); }

// Locations. Tag (card region) -> verbatim city.csv region. Cities named on a
// work-location cue line -> verbatim city.csv entry + the regions it lies in.
var REGION = { 'גוש דן': 'אזור מרכז', 'מרכז': 'אזור מרכז', 'כל הארץ': 'פריסה ארצית', 'ירושלים יו"ש': 'אזור ירושלים',
  'צפון': 'אזור צפון', 'השרון': 'אזור השרון', 'שרון': 'אזור השרון', 'השפלה': 'אזור שפלה', 'שפלה': 'אזור שפלה', 'דרום': 'אזור דרום' };
var M = 'אזור מרכז', S = 'אזור השרון', SH = 'אזור שפלה', J = 'אזור ירושלים', N = 'אזור צפון', D = 'אזור דרום';
var CITY = { 'חולון': ['חולון', M], 'ירושלים': ['ירושלים', J], 'עכו': ['עכו', N], 'רעננה': ['רעננה', S],
  'רחובות': ['רחובות', SH], 'רמלה': ['רמלה לוד', SH], 'פתח תקווה': ['פתח תקווה', M], 'בני ברק': ['בני ברק', M],
  'מרחבים': ['מרחבים', D], 'נתיבות': ['נתיבות', D], 'אופקים': ['אופקים', D], 'ב"ש': ['באר שבע', D], 'באר שבע': ['באר שבע', D],
  'אילת': ['אילת', D], 'קריית אונו': ['קריית אונו', M], 'אור יהודה': ['אור יהודה', M] };
// All or nothing: a cue list with any name we cannot map verbatim yields no cities.
function cityList(s) {
  var out = [], ok = true;
  s.split(/[,،]/).forEach(function (part) {
    part.split(':').forEach(function (p) {
      p = p.replace(/^[\s\-–(]+|[\s.)]+$/g, '').replace(/^מטה החברה$/, '');
      if (!p || REGION[p]) return;
      var bits = CITY[p] ? [p] : p.split(/\s+ו(?=[א-ת])/);
      bits.forEach(function (b) { b = b.trim(); if (CITY[b]) out.push(CITY[b]); else ok = false; });
    });
  });
  return ok ? out : [];
}

document.querySelectorAll(ITEM).forEach(function (item) {
  if (item.querySelector('.__ai-jobid')) return;
  var id = (item.getAttribute('data-job-id') || '').trim();
  var meta = item.querySelectorAll('.job-meta > span'), printed = '', tag = '';
  meta.forEach(function (s) {
    if (s.querySelector('.fa-hashtag')) { var m = s.textContent.match(/(\d+)/); if (m) printed = m[1]; }
    if (s.querySelector('.fa-map-marker-alt')) tag = s.textContent;
  });
  if (printed && printed === id) put(item, '__ai-jobid', 'femi-' + printed);

  var body = structuredText(item.querySelector('.description-text'));
  var desc = [], req = [], mode = 'd', sec = '', cue = [], nextCue = false;
  body.split('\n').forEach(function (raw) {
    var l = raw.replace(/[^\S\n]+/g, ' ').trim();
    if (!l) { (mode === 'r' ? req : desc).push(''); return; }
    var h = norm(l);
    if (nextCue) { nextCue = false; cue.push(l); desc.push(l); return; }
    if (/^מיקו(ם|מים|מי המשרות)$/.test(h) && l.length < 20) { nextCue = true; desc.push(l); return; }
    if (l.length < 60 && REQ_H.test(h)) { mode = 'r'; sec = h; return; }
    if (l.length < 60 && DESC_H.test(h)) { mode = 'd'; sec = h; return; }
    // Final letters: מיקום ends in ם, מיקומים / מיקומי use מ (CLAUDE.md).
    var c = l.match(/^(?:-\s*)?מיקו(?:ם|מים|מי המשרות|ם המשרה)\s*:\s*(.+)$/);
    if (c) cue.push(c[1]);
    c = l.match(/זמינות לעבודה ב(\S+?)\s*-/);
    if (c) cue.push(c[1]);
    c = l.replace(/^-\s*/, '');
    if (/^פרטי ה?משרה$/.test(sec) && CITY[c]) cue.push(c);
    if (mode === 'r' && TERMS.test(l)) { desc.push(l); return; }
    if (mode === 'd' && REQ_LINE.test(l) && !TERMS.test(l)) { req.push(l); return; }
    (mode === 'r' ? req : desc).push(l);
  });
  function join(a) { return a.join('\n').replace(/\n{3,}/g, '\n\n').trim(); }
  var d = join(desc), r = join(req);
  if (d === r) r = '';
  if (d) put(item, '__ai-description', d);
  if (r) put(item, '__ai-requirements', r);

  // Four-case rule: a cue-line city inside the tag's area wins; one outside it keeps the tag.
  var tags = [];
  tag.split('|').forEach(function (x) { x = x.replace(/\s+/g, ' ').trim(); if (REGION[x] && tags.indexOf(REGION[x]) < 0) tags.push(REGION[x]); });
  var cities = [];
  cue.forEach(function (s) { cityList(s).forEach(function (cr) { if (cities.indexOf(cr) < 0) cities.push(cr); }); });
  var inside = cities.filter(function (cr) { return tags.indexOf('פריסה ארצית') >= 0 || tags.indexOf(cr[1]) >= 0; });
  var locs = [];
  if (inside.length && inside.length === cities.length) inside.forEach(function (cr) { if (locs.indexOf(cr[0]) < 0) locs.push(cr[0]); });
  else locs = tags;
  put(item, '__ai-location', locs.length ? locs.join(', ') : 'Unknown');
});
