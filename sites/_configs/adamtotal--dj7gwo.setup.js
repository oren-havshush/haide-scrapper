// James Richardson Duty Free on AdamTotal (career.adamtotal.co.il, token 7675h424...). Listing-only:
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

// Requirements heading: the label itself is dropped (owner rule 2).
var REQ_H = /^(דרישות( ה?(משרה|תפקיד))?|כישורים( נדרשים)?)$/;
// Description headings that are field labels: dropped.
var DESC_H = /^(תיאור ה?(משרה|תפקיד)|התפקיד כולל)$/;
// Section headings that end a requirements list but are the employer's own text: kept.
var KEEP_H = /^(למה דווקא אצלנו|ליצי?רי?ת קשר)$/;
// A requirement line with no heading (rule 1): ends in "- חובה" / "יתרון", or a starred availability line.
var REQ_LINE = /(חובה|יתרון( משמעותי| מהותי)?)\s*[!.]?\s*$/;
var REQ_STAR = /^\*\s*(זמינות|נכונות)\s+לעבוד/;
// Inside a requirements section, pay / hours / scope stay in the description (rule 3).
var TERMS = /שכר|בונוס|היקף|שעות|^משרה (מלאה|חלקית)/;
function norm(l) { return l.replace(/[\s:?\-–]+$/, '').replace(/\s+/g, ' ').trim(); }

// Locations. Tag (card region) -> verbatim city.csv region; unknown tag parts ("שדה תעופה", "1") are ignored.
var REGION = { 'גוש דן': 'אזור מרכז', 'מרכז': 'אזור מרכז', 'כל הארץ': 'פריסה ארצית', 'ירושלים יו"ש': 'אזור ירושלים',
  'צפון': 'אזור צפון', 'השרון': 'אזור השרון', 'שרון': 'אזור השרון', 'השפלה': 'אזור שפלה', 'שפלה': 'אזור שפלה', 'דרום': 'אזור דרום' };
// Work-location cue: "לעבודה בחנויות בנתב"ג" -> city.csv entry נתב"ג, which lies in אזור מרכז / אזור שפלה.
var NATBAG = 'נתב"ג';
var NATBAG_AREAS = ['אזור מרכז', 'אזור שפלה', 'פריסה ארצית'];
var CUE = /לעבודה ב(?:חנויות )?בנתב["״]ג/;
// Owner 2026-10-07: "בדיוטי פרי טרמינל 1" (Terminal 1 = Ben Gurion, an inference) and the misspelt "בנת"בג" also mean נתב"ג.
var CUE_OWNER = /בדיוטי פרי טרמינל 1|בנת["״]בג/;

document.querySelectorAll(ITEM).forEach(function (item) {
  if (item.querySelector('.__ai-jobid')) return;
  var id = (item.getAttribute('data-job-id') || '').trim();
  var meta = item.querySelectorAll('.job-meta > span'), printed = '', tag = '';
  meta.forEach(function (s) {
    if (s.querySelector('.fa-hashtag')) { var m = s.textContent.match(/(\d+)/); if (m) printed = m[1]; }
    if (s.querySelector('.fa-map-marker-alt')) tag = s.textContent;
  });
  if (printed && printed === id) put(item, '__ai-jobid', 'dutyfree-' + printed);

  var body = structuredText(item.querySelector('.description-text'));
  var desc = [], req = [], mode = 'd', kept = false, cue = false, gap = false;
  body.split('\n').forEach(function (raw) {
    var l = raw.replace(/[^\S\n]+/g, ' ').trim();
    if (!l) { (mode === 'r' ? req : desc).push(''); gap = true; return; }
    var h = norm(l);
    // After a blank line, an unbulleted line ends the requirements list (2530's closing line).
    if (mode === 'r' && gap && !/^[-*•]/.test(l)) mode = 'd';
    gap = false;
    if (CUE.test(l) || CUE_OWNER.test(l)) cue = true;
    if (l.length < 40 && KEEP_H.test(h)) { mode = 'd'; kept = true; desc.push(l); return; }
    if (l.length < 40 && REQ_H.test(h)) { mode = 'r'; return; }
    if (l.length < 40 && DESC_H.test(h)) { mode = 'd'; return; }
    if (mode === 'r' && TERMS.test(l)) { desc.push(l); return; }
    if (mode === 'd' && !kept && (REQ_LINE.test(l) || REQ_STAR.test(l)) && !TERMS.test(l)) { req.push(l); return; }
    (mode === 'r' ? req : desc).push(l);
  });
  function join(a) { return a.join('\n').replace(/\n{3,}/g, '\n\n').trim(); }
  var d = join(desc), r = join(req);
  if (d === r) r = '';
  if (d) put(item, '__ai-description', d);
  if (r) put(item, '__ai-requirements', r);

  // Four-case rule: the cue-line place inside the tag's area wins; otherwise the tag; no tag -> Unknown.
  var tags = [];
  tag.split('|').forEach(function (x) { x = x.replace(/\s+/g, ' ').trim(); if (REGION[x] && tags.indexOf(REGION[x]) < 0) tags.push(REGION[x]); });
  var inside = cue && tags.some(function (x) { return NATBAG_AREAS.indexOf(x) >= 0; });
  var locs = inside ? [NATBAG] : tags;
  put(item, '__ai-location', locs.length ? locs.join(', ') : 'Unknown');
});
