// UCL Group (ucl-group.co.il) - JetEngine listing 47 on /career/ and the /jobtype/ pages; job body on /jobs/<slug>/.
// Listing: title + id (printed job number, namespaced ucl-group-<n>). Detail: description/requirements split + location.
var MATH = new RegExp('[' + String.fromCodePoint(0x1D400) + '-' + String.fromCodePoint(0x1D7FF) + ']', 'gu');
var C1 = new RegExp('[' + String.fromCharCode(0x80) + '-' + String.fromCharCode(0x9F) + ']', 'g');
var HEB_LAT = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u;
var OTHER = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var fld = function (root, id) {
  var e = root.querySelector('.elementor-element-' + id + ' .jet-listing-dynamic-field__content');
  return e ? e.textContent.replace(/\s+/g, ' ').trim() : '';
};
var put = function (root, cls, val) {
  var s = document.createElement('span');
  s.className = cls; s.style.display = 'none'; s.textContent = val; root.appendChild(s);
};

// ---- listing cards (also on detail pages' related-jobs carousel, which has no title widget: skipped)
var prev = -1, stable = 0;
for (var t = 0; t < 20; t++) {
  var n = document.querySelectorAll('.jet-listing-grid__item').length;
  if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n;
  if (document.querySelector('.elementor-element-457a1dd')) break;
  await new Promise(function (r) { setTimeout(r, 300); });
}
document.querySelectorAll('.jet-listing-grid__item').forEach(function (it) {
  if (it.querySelector('.__ai-title')) return;
  var title = fld(it, 'd54873d').replace(MATH, function (c) { return c.normalize('NFKC'); });
  if (!title) return;
  if (!HEB_LAT.test(title) || OTHER.test(title)) { it.remove(); return; }
  put(it, '__ai-title', title);
  var num = fld(it, '3e92eb6');
  if (/^\d+$/.test(num)) put(it, '__ai-id', 'ucl-group-' + num);
});

// ---- detail page
var body = document.querySelector('.elementor-element-457a1dd .jet-listing-dynamic-field__content');
if (body && !document.querySelector('.__ai-description')) {
  var c = body.cloneNode(true);
  c.querySelectorAll('input').forEach(function (e) { e.replaceWith(' ' + (e.getAttribute('value') || '') + ' '); });
  c.querySelectorAll('br').forEach(function (e) { e.replaceWith('\n'); });
  c.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,tr').forEach(function (e) { e.append('\n'); });
  var lines = c.textContent.replace(C1, '').split('\n').map(function (l) { return l.replace(/[ \t]+/g, ' ').trim(); }).filter(Boolean);
  var REQ = /^דרישות(\s+ה?(תפקיד|משרה))?\s*:?\s*$/;
  var LABEL = /^תיאור\s+ה?תפקיד\s*:?\s*$/;
  var COND = /^משרה מלאה\s*\|/;
  var desc = [], req = [], inReq = false;
  lines.forEach(function (l) {
    if (REQ.test(l)) { inReq = true; return; }
    if (LABEL.test(l)) return;
    if (inReq && !COND.test(l)) req.push(l); else desc.push(l);
  });
  var holder = document.createElement('div'); holder.style.display = 'none'; document.body.appendChild(holder);
  put(holder, '__ai-description', desc.join('\n'));
  if (req.length) put(holder, '__ai-requirements', req.join('\n'));

  // location: the region tag (four-case rule), mapped by a closed list to verbatim city.csv rows
  var TAG = { 'מרכז': 'אזור מרכז', 'שפלה': 'אזור שפלה', 'צפון': 'אזור צפון', 'ירושלים': 'ירושלים' };
  // closed place list: spelling in the ad -> verbatim city.csv row, and the tag areas it lies in
  var PLACE = { 'שוהם': 'שוהם', 'פתח תקווה': 'פתח תקווה', 'תל אביב': 'תל אביב-יפו', 'ירושלים': 'ירושלים' };
  var AREA = { 'שוהם': ['אזור מרכז'], 'פתח תקווה': ['אזור מרכז'], 'תל אביב-יפו': ['אזור מרכז'], 'ירושלים': ['ירושלים'] };
  var tag = TAG[fld(document, '941f938')] || '';
  var text = '', all = lines.join('\n');
  // cue 1: "למשרדנו היושבים ב<place>" (the job is at that office)
  var m = all.match(/למשרד(?:נו|ינו)\s+(?:ה)?(?:יושבים|ממוקמים)\s+ב(שוהם|פתח תקווה|תל אביב|ירושלים)(?=[\s.,!]|$)/);
  // cue 2 (owner 2026-10-11): an opening line placing the hiring company ("לחברה ... הממוקמת/היושבת ב<place>",
  // "לחברה ביטחונית בתל אביב"), not when the ad is field work or names several branches
  if (!m && !/עבודת שטח|תפקיד שטח|נסיעות|סניפים/.test(all)) {
    for (var i = 0; i < lines.length && !m; i++) {
      m = lines[i].match(/^(?:ל|ב)?(?:חברה|ארגון|משרד)\s[^.]*?\sב(שוהם|פתח תקווה|תל אביב|ירושלים)(?=[\s.,!]|$)/);
    }
  }
  if (m) text = PLACE[m[1]];
  var loc = tag;
  if (text && (!tag || (AREA[text] || []).indexOf(tag) >= 0)) loc = text;
  put(holder, '__ai-location', loc || 'Unknown');
}
