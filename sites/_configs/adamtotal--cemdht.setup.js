// Harel on AdamTotal (career.adamtotal.co.il, tenant "harel"). Listing-only:
// every card already carries the full job body in .description-text.
var ITEM = 'article.job-card';
var prev = -1, stable = 0;
for (var t = 0; t < 60; t++) {
  var n = document.querySelectorAll(ITEM).length;
  if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n;
  await new Promise(function (r) { setTimeout(r, 500); });
}

// The worker does not re-run setupScript after it paginates, so pages 2+ are
// fetched here (same origin, server-rendered) and their cards appended to page 1.
var first = document.querySelector(ITEM);
if (first && !document.querySelector('.__ai-paged') && /\/Home\/Index/i.test(location.pathname)) {
  var box = first.parentElement, seen = {};
  document.querySelectorAll(ITEM).forEach(function (a) { seen[a.getAttribute('data-job-id')] = 1; });
  for (var pg = 2; pg <= 20; pg++) {
    var u = new URL(location.href); u.searchParams.set('page', String(pg));
    var html = '';
    try { var res = await fetch(u.href, { credentials: 'same-origin' }); if (!res.ok) break; html = await res.text(); } catch (e) { break; }
    var cards = new DOMParser().parseFromString(html, 'text/html').querySelectorAll(ITEM), added = 0;
    cards.forEach(function (a) {
      var k = a.getAttribute('data-job-id');
      if (!k || seen[k]) return;
      seen[k] = 1; box.appendChild(document.importNode(a, true)); added++;
    });
    if (!added) break;
  }
  var mark = document.createElement('span'); mark.className = '__ai-paged'; mark.style.display = 'none';
  document.body.appendChild(mark);
}

function structuredText(el) {
  if (!el) return '';
  var c = el.cloneNode(true);
  c.querySelectorAll('style,script').forEach(function (e) { e.remove(); });
  // "<br>\n" in the source: the newline after a <br> is formatting, not a second break.
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

// Standalone section headings. The label itself is dropped (owner rule 2).
var REQ_H = /^(מה אנחנו מחפשים|דרישות( ה?(משרה|תפקיד))?|יתרונות|כישורים( נדרשים)?)$/;
var DESC_H = /^(איך יי?ראה ה?יו[םמ] ?יום שלך|במסגרת התפקיד|תיאור ה?(משרה|תפקיד)|מה כולל התפקיד|היקף +ה?משרה|אנחנו על המפה|מיקום( ה?משרה)?|מה תרוויחו|מה מייחד אותנו|למה זה תפקיד ששווה לעצור בשבילו)$/;
// Inside a requirements section: hours, pay, benefits and the office stay in the description.
var REQ_WORD = /(חובה|יתרון)|^(ניסיון|נסיון|ידע|רישיון|רשיון|תואר|תעודה|תעודת|בעל|יכולת|נכונות|זמינות|שליטה|הכרה|הכרת|דובר|אנגלית|היכרות|עדיפות|נדרש|רצוי)/;
var TERMS = /רמת גן|ברג(?![א-ת])|פתח תק|הבורסה|סבידור|סובידור|בוטינסקי|היקף|שעות|\d:\d\d|שכר|מהבית|קרן השתלמות|ביטוח בריאות|הטבות|עובד\S* חבר|קריירה|קידום|^משרה (מלאה|חלקית)|ימים? [א-ת]['’]|חמישי מקוצר|^מיקום/;

function norm(l) { return l.replace(/[\s:：?\-–]+$/, '').replace(/\s+/g, ' ').trim(); }

// Harel's named offices -> verbatim "CSV files/city.csv" entries. Region words are
// emitted raw: the worker's shared LOCATION_ALIAS (locationNormalize.ts) maps them.
var OFFICE = { 'פתח תקוה': 'פתח תקווה', 'פתח תקווה': 'פתח תקווה', 'בית הראל רמת גן': 'רמת גן', 'בית מ.א.ה': 'רמת גן' };

document.querySelectorAll(ITEM).forEach(function (item) {
  if (item.querySelector('.__ai-jobid')) return;
  var id = (item.getAttribute('data-job-id') || '').trim();
  if (id) put(item, '__ai-jobid', 'harel-' + id);

  var body = structuredText(item.querySelector('.description-text'));
  var desc = [], req = [], mode = 'd';
  body.split('\n').forEach(function (raw) {
    var l = raw.replace(/[^\S\n]+/g, ' ').trim();
    if (!l) { (mode === 'r' ? req : desc).push(''); return; }
    var h = norm(l);
    if (l.length < 60 && REQ_H.test(h)) { mode = 'r'; return; }
    if (l.length < 60 && DESC_H.test(h)) { mode = 'd'; return; }
    if (mode === 'r' && !REQ_WORD.test(l) && TERMS.test(l)) { desc.push(l); return; }
    (mode === 'r' ? req : desc).push(l);
  });
  function join(a) { return a.join('\n').replace(/\n{3,}/g, '\n\n').trim(); }
  var d = join(desc), r = join(req);
  if (d === r) r = '';
  if (d) put(item, '__ai-description', d);
  if (r) put(item, '__ai-requirements', r);

  // Location: the employer's own text first (the region list on the card is a
  // recruiting-area taxonomy — 5570 lists five regions, its text says ברג).
  var locs = [];
  function add(v) { if (locs.indexOf(v) < 0) locs.push(v); }
  if (/רמת גן|(^|[^א-ת])ברג(?![א-ת])|בית המאה/.test(body)) add('רמת גן');
  if (/פתח תקו?וה/.test(body)) add('פתח תקווה');
  var m = body.match(/מיקום ה?משרה\s*[:\-]?\s*(צפון|דרום|מרכז)(?![א-ת])/);
  if (m) locs = [m[1]];
  if (!locs.length) {
    var metaLoc = '';
    item.querySelectorAll('.job-meta > span').forEach(function (s) { if (s.querySelector('.fa-map-marker-alt')) metaLoc = s.textContent; });
    var toks = metaLoc.split('|').map(function (x) { return x.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
    toks.forEach(function (x) { if (OFFICE[x]) add(OFFICE[x]); });
    if (!locs.length) toks.forEach(function (x) { add(x); });
  }
  put(item, '__ai-location', locs.length ? locs.join(', ') : 'Unknown');
});
