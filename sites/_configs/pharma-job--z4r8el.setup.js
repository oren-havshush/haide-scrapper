var ITEM = '.awsm-job-listing-item';
var prev = -1, stable = 0;
for (var t = 0; t < 60; t++) {
  var n = document.querySelectorAll(ITEM).length;
  if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n;
  await new Promise(function (r) { setTimeout(r, 500); });
}
if (!document.querySelector(ITEM)) return;
// A group posting defers its tracks to a standalone posting with the same number, and the
// standalone may sit behind "Load more" — so the whole listing is loaded before any card is read.
for (var c = 0; c < 20; c++) {
  var btn = document.querySelector('.awsm-load-more-btn');
  if (!btn || btn.offsetParent === null) break;
  var before = document.querySelectorAll(ITEM).length;
  btn.click();
  for (var w = 0; w < 30 && document.querySelectorAll(ITEM).length === before; w++) await new Promise(function (r) { setTimeout(r, 500); });
  if (document.querySelectorAll(ITEM).length === before) break;
}

function haideHash(s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); }
function sq(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
function mk(item, cls, v) { if (!v) return; var s = document.createElement('span'); s.className = cls; s.style.display = 'none'; s.textContent = v; item.appendChild(s); }
function terms(root, key) { return Array.prototype.map.call(root.querySelectorAll('.awsm-job-specification-' + key + ' .awsm-job-specification-term'), function (e) { return sq(e.textContent); }).filter(Boolean); }

// The site's "אזור המשרה" is a region taxonomy -> city.csv region buckets, verbatim.
var AREA = { 'מרכז': 'אזור מרכז', 'שפלה': 'אזור שפלה', 'השפלה': 'אזור שפלה', 'דרום': 'אזור דרום', 'השרון': 'אזור השרון', 'ירושלים': 'אזור ירושלים', 'כל הארץ': 'פריסה ארצית' };
var HE_EN = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u;
var OTHER = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var NUM = /משרה\s*(\d{4,6})/;
// The printed job number leaves the stored title once it is read for the id (addsite2 Job body rule 7):
// "– משרה N", "- מספר משרה N", "מס משרה N", "( משרה N)", and a bare trailing "– N". No \b: it never fires after Hebrew.
var TITLE_NUM = /[\s\-–—]*\(?\s*((מספר|מס['׳]?)\s*)?משרה\s*\d{4,6}\s*\)?\s*$/;
var TITLE_BARE = /\s*[\-–—]\s*\d{4,6}\s*$/;
function cleanTitle(t) { var s = t.replace(TITLE_NUM, '').replace(TITLE_BARE, '').trim(); return s || t; }
var TRACK = /^(.+?\(\s*משרה\s*(\d{4,6})\s*\))\s*(.*)$/;
var REQ_HEAD = /^(דרישות|כישורים)(\s+ה?(תפקיד|משרה))?\s*:?\s*$/;
var LABEL = /^((תיאור|הגדרת|במסגרת)\s+ה?(תפקיד|משרה)|לכל המשרות)\s*:?\s*$/;
var KEEP = /^\*?\s*(שכר|תנאים|המשרה מיועדת|משרה זו (מיועדת|פונה)|משרה (מלאה|זמנית|חלקית)|אפשרות עבודה|לחלק מהמשרות)/;
var APPLY = /^(בבקשה|נא) לציין/;
var REQ_START = /^(ניסיון|נסיון|ידע|רישיון|רשיון|תעודה|תעודת|תואר|בעל|בעלת|בעלי|יכולת|נכונות|זמינות|שליטה|הכרה|הכרת|היכרות|הכרות|מגורים|מאזור|מאיזור|דובר|עדיפות|נדרש|רצוי|אנגלית|עברית|רקע)/;
function isReq(l) {
  if (/דרוש/.test(l) || l.length > 150 || KEEP.test(l)) return false;
  return /חובה|יתרון/.test(l) || REQ_START.test(l);
}
function bodyLines(el) {
  var c = el.cloneNode(true);
  Array.prototype.forEach.call(c.querySelectorAll('script,style'), function (e) { e.remove(); });
  Array.prototype.forEach.call(c.querySelectorAll('br'), function (e) { e.replaceWith('\n'); });
  Array.prototype.forEach.call(c.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6'), function (e) { e.insertAdjacentText('afterend', '\n'); });
  return (c.textContent || '').split('\n').map(sq).filter(Boolean);
}
// Under a דרישות heading every line is a requirement except pay/terms/scope; with no heading, classify each line (LRN-SETUP-18).
// An apply instruction stays in the description: applicationInfo carries the captured AWSM form, and injecting text there displaces it.
function split(lines) {
  var desc = [], req = [], head = lines.some(function (l) { return REQ_HEAD.test(l); }), inReq = false;
  lines.forEach(function (l) {
    if (LABEL.test(l)) return;
    if (REQ_HEAD.test(l)) { inReq = true; return; }
    if (APPLY.test(l) || KEEP.test(l)) { desc.push(l); return; }
    if (inReq || !head && isReq(l)) req.push(l); else desc.push(l);
  });
  return { desc: desc, req: req };
}

var items = Array.prototype.slice.call(document.querySelectorAll(ITEM)).filter(function (i) { return !i.hasAttribute('data-haide'); });
var standalone = {};
Array.prototype.forEach.call(document.querySelectorAll(ITEM + ' .awsm-job-post-title a'), function (a) { var m = sq(a.textContent).match(NUM); if (m) standalone[m[1]] = 1; });

async function one(item) {
  item.setAttribute('data-haide', '1');
  var a = item.querySelector('.awsm-job-post-title a');
  if (!a) return;
  var title = sq(a.textContent), href = a.href;
  if (!HE_EN.test(title) || OTHER.test(title)) { item.remove(); return; }
  var locs = [];
  terms(item, 'job-location').forEach(function (x) { var v = AREA[x]; if (v && locs.indexOf(v) < 0) locs.push(v); });
  var loc = locs.length ? locs.join(', ') : 'Unknown';
  var dept = terms(item, 'job-category').filter(function (x, i, arr) { return arr.indexOf(x) === i; }).join(', ');
  var doc;
  try { doc = new DOMParser().parseFromString(await (await fetch(href, { credentials: 'same-origin' })).text(), 'text/html'); } catch (e) { return; }
  var body = doc.querySelector('.awsm-job-entry-content');
  if (!body) return;
  var date = '';
  var ld = doc.documentElement.innerHTML.match(/"datePublished":"(\d{4}-\d\d-\d\d)/);
  if (ld) date = ld[1];
  var meta = [];
  [['job-type', 'היקף משרה'], ['job-experience', 'נסיון']].forEach(function (k) { var v = terms(doc, k[0]); if (v.length) meta.push(k[1] + ': ' + v.join(', ')); });
  var lines = bodyLines(body);
  var tracks = lines.filter(function (l) { return TRACK.test(l); });
  function emit(el, t, id, cardHref, r, extraReq, tail) {
    var anchor = document.createElement('a');
    anchor.className = '__ai-title'; anchor.href = cardHref; anchor.style.display = 'none'; anchor.textContent = cleanTitle(t);
    el.appendChild(anchor);
    mk(el, '__ai-url', href);
    mk(el, '__ai-eid', id);
    mk(el, '__ai-location', loc);
    mk(el, '__ai-dept', dept);
    mk(el, '__ai-date', date);
    mk(el, '__ai-description', r.desc.concat(meta, tail ? [tail] : []).join('\n'));
    mk(el, '__ai-requirements', (extraReq ? [extraReq] : []).concat(r.req).join('\n'));
  }
  if (tracks.length >= 2) {
    // Group posting: one job per numbered track; a number also used by a standalone posting belongs to it.
    var shared = split(lines.filter(function (l) { return !TRACK.test(l); }));
    shared.desc.unshift(title);
    tracks.forEach(function (l) {
      var m = l.match(TRACK);
      if (standalone[m[2]]) return;
      var el = item.cloneNode(false);
      el.id = item.id + '-' + m[2];
      el.setAttribute('data-haide', '1');
      item.parentNode.insertBefore(el, item);
      // The ad asks applicants to quote the track number, and the form sends only the group's post id
      // (awsm_job_id, the same for every track), so the number stays visible, in the ad's own words (rule 7).
      emit(el, sq(m[1]), 'pharma-job-' + m[2], href + '#' + m[2], shared, sq(m[3]), sq(m[1].match(/משרה\s*\d{4,6}/)[0]));
    });
    item.remove();
    return;
  }
  var num = title.match(NUM);
  var slug = decodeURIComponent(new URL(href).pathname.replace(/\/+$/, '').split('/').pop());
  emit(item, title, 'pharma-job-' + (num ? num[1] : haideHash(slug)), href, split(lines));
}
await Promise.all(items.map(one));
