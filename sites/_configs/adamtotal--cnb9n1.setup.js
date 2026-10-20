// Altshuler Shaham on AdamTotal (career.adamtotal.co.il, token 1EB6B34D-...). Listing-only, one page, no pager:
// every article.job-card carries the full job body in .description-text. This script makes NO request.
// Id altshuler-<n>: the printed "מס' משרה" (equal to the card's data-job-id). Undated (no date anywhere).
// Location: the card's area tag ("גוש דן") through the config's locationMap; a city on a work-location cue
// line inside the tag's area replaces it (four-case rule). No tag and no cue line -> nothing (Unknown).
// Apply: one blob per job = the request the page's submit sends (POST /Jobs/SubmitApplication, multipart,
// OrderNo = this job's number, Token = the tenant). Cloudflare Turnstile on submit (cf-turnstile-response,
// browser-made). Both consent boxes are required and NOT pre-checked.
var ITEM = 'article.job-card';
var prev = -1, stable = 0;
for (var t = 0; t < 60; t++) {
  var n = document.querySelectorAll(ITEM).length;
  if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n;
  await new Promise(function (r) { setTimeout(r, 500); });
}

var TOKEN = '1EB6B34D-8783-4AD3-8SS80-7FA0CFA5DFC8';
var ACT = location.origin + '/Jobs/SubmitApplication';
var LANG_OK = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}]/u;
var LANG_BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;

function structuredText(el) {
  if (!el) return '';
  var c = el.cloneNode(true);
  c.querySelectorAll('style,script,meta').forEach(function (e) { e.remove(); });
  // "<br>\n" in the source: the newline after a <br> is formatting, not a second break.
  c.querySelectorAll('br').forEach(function (b) {
    var nx = b.nextSibling;
    if (nx && nx.nodeType === 3) nx.nodeValue = nx.nodeValue.replace(/^[^\S\n]*\n/, '');
  });
  // Source indentation between list items is not a paragraph break.
  c.querySelectorAll('ul,ol').forEach(function (u) {
    u.childNodes.forEach(function (x) { if (x.nodeType === 3 && !x.nodeValue.trim()) x.nodeValue = ''; });
  });
  c.querySelectorAll('p,div,ul,ol,li,br,h1,h2,h3,h4,h5,h6,tr').forEach(function (e) { e.insertAdjacentText('afterend', '\n'); });
  return c.textContent;
}
function put(item, cls, val) {
  var s = document.createElement('span');
  s.className = cls; s.style.display = 'none'; s.textContent = val;
  item.appendChild(s);
}

// Section labels. REQ_H opens requirements, DESC_H returns to the description; both labels are dropped.
// KEEP_H returns to the description and the heading line stays (it says something of its own).
var REQ_H = /^(למי מתאים התפקיד|את מי אנחנו מחפשים|מה אנחנו מחפשים|דרישות( ה?(משרה|תפקיד))?|כישורים( נדרשים)?)$/;
var DESC_H = /^תיאור ה?(משרה|תפקיד)$/;
var KEEP_H = /^(מיקום( ומודל עבודה)?|מיקום ה?משרה)$/;
// Inside requirements: hours, scope, pay and the office stay in the description, unless the line is a requirement.
var REQ_WORD = /(חובה|יתרון)|^(ניסיון|נסיון|ידע|רישיון|תואר|בעל|יכולת|נכונות|זמינות|שליטה|היכרות|הכרה)/;
var TERMS = /^משרה (מלאה|חלקית)|\d\d?:\d\d|שעות|היברידי|(?<![א-ת])שכר|תנאים סוציאליים|במשרדי החברה/;
var APPLY_LINE = /^שלח\/?י? אלינו את קורות החיים/;
function norm(l) { return l.replace(/[\s:?\-–]+$/, '').replace(/\s+/g, ' ').trim(); }

// Area tag -> its region row (as the config's locationMap reads it); cue-line place -> [city.csv row, region].
var M = 'אזור מרכז', N = 'אזור צפון';
var TAG_REGION = { 'גוש דן': M, 'מרכז': M, 'צפון': N, 'כל הארץ': '*' };
var CITY = { 'תל אביב': ['תל אביב-יפו', M], 'תל אביב-יפו': ['תל אביב-יפו', M], 'ת"א': ['תל אביב-יפו', M],
  'רמת החייל': ['תל אביב-יפו', M], 'חיפה': ['חיפה', N] };
// All or nothing: a cue line with a part we cannot map verbatim yields no city.
function cityList(s) {
  var out = [], ok = true;
  s.split(/,/).forEach(function (p) {
    p = p.replace(/^[\s\-–(]+|[\s.)]+$/g, '').replace(/^ב(?=(תל אביב|רמת החייל|חיפה|ת"א))/, '');
    if (!p || /מודל עבודה|היברידי/.test(p)) return;
    if (CITY[p]) out.push(CITY[p]); else ok = false;
  });
  return ok ? out : [];
}

document.querySelectorAll(ITEM).forEach(function (item) {
  if (item.querySelector('.__ai-jobid')) return;
  var titleEl = item.querySelector('h4.job-title-button');
  var title = titleEl ? titleEl.textContent.replace(/\s+/g, ' ').trim() : '';
  if (!LANG_OK.test(title) || LANG_BAD.test(title)) { item.remove(); return; }
  var id = (item.getAttribute('data-job-id') || '').trim();
  var printed = '', tag = '', chips = [];
  item.querySelectorAll('.job-meta > span').forEach(function (s) {
    var tx = s.textContent.replace(/\s+/g, ' ').trim();
    if (s.querySelector('.fa-hashtag')) { var m = tx.match(/(\d+)/); if (m) printed = m[1]; }
    else if (s.querySelector('.fa-map-marker-alt')) tag = tx;
    else if (s.querySelector('.fa-clock') && tx && tx !== 'משרה חמה') chips.push(tx);
  });
  if (printed && printed === id) put(item, '__ai-jobid', 'altshuler-' + printed);

  var body = structuredText(item.querySelector('.description-text'));
  var desc = [], req = [], mode = 'd', cue = [], nextCue = false;
  body.split('\n').forEach(function (raw) {
    var l = raw.replace(/[^\S\n]+/g, ' ').trim();
    if (!l) { (mode === 'r' ? req : desc).push(''); return; }
    if (!/[\p{L}\p{N}]/u.test(l)) return;
    if (APPLY_LINE.test(l)) return;
    var h = norm(l);
    if (nextCue) { nextCue = false; cue.push(l); }
    if (l.length < 60 && REQ_H.test(h)) { mode = 'r'; return; }
    if (l.length < 60 && DESC_H.test(h)) { mode = 'd'; return; }
    if (l.length < 60 && KEEP_H.test(h)) { mode = 'd'; nextCue = true; desc.push(l); return; }
    var c = l.match(/^המשרה ממוקמת ב(.+?)(?:,\s*במודל[^,]*)?\.?$/);
    if (c) cue.push(c[1]);
    c = l.match(/ שלנו ב(תל אביב-יפו|תל אביב|חיפה)(?![א-ת])/);
    if (c) cue.push(c[1]);
    if (mode === 'r' && !REQ_WORD.test(l) && TERMS.test(l)) { desc.push(l); return; }
    (mode === 'r' ? req : desc).push(l);
  });
  function join(a) { return a.join('\n').replace(/\n{3,}/g, '\n\n').trim(); }
  var d = join(desc), r = join(req);
  // The card's job-type chips (משרה מלאה, קבועה) travel with the text when the body does not already say them.
  chips.forEach(function (x) { if (d.indexOf(x) < 0) d = d ? d + '\n\n' + x : x; });
  if (d === r) r = '';
  if (d) put(item, '__ai-description', d);
  if (r) put(item, '__ai-requirements', r);

  // Four-case rule: cue-line cities all inside the tag's area win; one outside keeps the tag; no tag -> cities.
  var tags = [], regions = [];
  tag.split('|').forEach(function (x) {
    x = x.replace(/\s+/g, ' ').trim();
    if (x && tags.indexOf(x) < 0) { tags.push(x); if (TAG_REGION[x]) regions.push(TAG_REGION[x]); }
  });
  var cities = [];
  cue.forEach(function (s) { cityList(s).forEach(function (cr) { if (!cities.some(function (o) { return o[0] === cr[0]; })) cities.push(cr); }); });
  var inside = cities.filter(function (cr) { return regions.indexOf('*') >= 0 || regions.indexOf(cr[1]) >= 0; });
  var locs;
  if (cities.length && (!tags.length || inside.length === cities.length)) locs = cities.map(function (cr) { return cr[0]; });
  else locs = tags;
  if (locs.length) put(item, '__ai-location', locs.join(' | '));

  // Per-job apply blob: the request the page's submit really sends (FormData of the form + OrderNo + Token).
  var F = [
    { name: 'domain', label: 'domain', fieldType: 'hidden', tagName: 'INPUT', required: false, value: '' },
    { name: 'shared', label: 'shared', fieldType: 'hidden', tagName: 'INPUT', required: false, value: '' },
    { name: 'isCampaign', label: 'isCampaign', fieldType: 'hidden', tagName: 'INPUT', required: false, value: '0' },
    { name: 'Fname', label: 'שם פרטי', fieldType: 'text', tagName: 'INPUT', required: true },
    { name: 'Lname', label: 'שם משפחה', fieldType: 'text', tagName: 'INPUT', required: true },
    { name: 'Phone', label: 'טלפון', fieldType: 'text', tagName: 'INPUT', required: true },
    { name: 'Email', label: 'דוא"ל', fieldType: 'email', tagName: 'INPUT', required: true },
    { name: 'Agreement1', label: 'אני מסכים לתנאי שימוש', fieldType: 'checkbox', tagName: 'INPUT', required: true },
    { name: 'Agreement2', label: 'אני מסכים שהפרטים ישמרו במאגר החברה', fieldType: 'checkbox', tagName: 'INPUT', required: true },
    { name: 'CvFile', label: 'צרף קורות חיים', fieldType: 'file', tagName: 'INPUT', required: false },
    { name: 'cf-turnstile-response', label: 'Cloudflare Turnstile token', fieldType: 'hidden', tagName: 'INPUT', required: true },
    { name: 'OrderNo', label: 'OrderNo', fieldType: 'hidden', tagName: 'INPUT', required: false, value: id },
    { name: 'Token', label: 'Token', fieldType: 'hidden', tagName: 'INPUT', required: false, value: TOKEN },
  ];
  if (id) {
    var link = item.querySelector('a.job-detail-link');
    var blob = JSON.stringify({ actionUrl: ACT, actionAttribute: '/Jobs/SubmitApplication', formTag: 'form', method: 'POST',
      enctype: 'multipart/form-data', pageUrl: link ? link.href : location.href, fields: F });
    put(item, '__ai-applicationInfo', blob);
    put(item, '__ai-formData', blob);
  }
});
