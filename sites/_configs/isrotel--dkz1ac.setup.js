// Isrotel careers (Umbraco). The /careers/ hub has one card per hotel/area
// page; each area page's "משרות נוספות" cards link to one job page each. The
// area cards are replaced here by the job cards of every area page (fetched,
// same origin, deduped by path) - listingUrls holds only 10 pages and this
// employer has 14 (owner, 2026-09-29). Then every field is read from the job
// page and injected into its card. Non-job cards are removed.
var ITEM = 'section.deals_inner ul.deals > div';
// A missing page redirects to the hub with 200, so a redirect is a failure.
async function get(u) {
  var f = function (r) { if (!r.ok || r.redirected) throw 0; return r.text(); };
  try { return await fetch(u).then(f); } catch (e) { return await fetch(u).then(f); }
}
var grid = document.querySelector('section.deals_inner ul.deals');
if (grid && !grid.hasAttribute('data-pooled')) {
  grid.setAttribute('data-pooled', '1');
  var areas = Array.prototype.map.call(grid.querySelectorAll(':scope > div a[href*="/careers/job/"]'), function (x) { return x.href; });
  grid.innerHTML = '';
  var seen = {}, failed = [];
  for (var ai = 0; ai < areas.length; ai++) {
    try {
      var ad = new DOMParser().parseFromString(await get(areas[ai]), 'text/html');
      if (!ad.querySelector(ITEM + ' a[href*="/careers/job-res/"]')) throw 0;
      ad.querySelectorAll(ITEM).forEach(function (c) {
        var l = c.querySelector('a[href*="/careers/job-res/"]');
        var key = l && new URL(l.getAttribute('href'), location.href).pathname;
        if (key && !seen[key]) { seen[key] = 1; grid.appendChild(document.importNode(c, true)); }
      });
    } catch (e) { failed.push(areas[ai]); }
  }
  // A dead area page must not quietly unpublish its jobs: extract nothing, so
  // the run ends empty_results and the stored jobs stay.
  if (failed.length || !areas.length) { console.warn('isrotel: area pages failed, extracting nothing: ' + failed.join(' ')); grid.innerHTML = ''; }
}

// Area folder -> verbatim city.csv entry. Carmim = אזור ירושלים (the site says
// both "בירושלים" and "סמוך למבשרת ציון"); Goma = מגדל (hotel address "חוף
// מגדל"); Dead Sea has no city.csv entry. Owner decisions, 2026-09-29.
var LOC = {
  'eilat': 'אילת', 'haifa': 'חיפה', 'herzliya': 'הרצליה', 'tel-aviv': 'תל אביב-יפו',
  'mitzpe': 'מצפה רמון', 'rosh-pinna': 'ראש פינה', 'קדמא-שדה-בוקר': 'שדה בוקר',
  'עבודה-באיילת-השחר': 'איילת השחר', 'or-je': 'ירושלים', 'jerusalemcr': 'אזור ירושלים',
  'עבודה-בכינרת': 'מגדל', 'dead-sea': 'Unknown'
};
// Management pages bundle one area's roles; located by the hotels they list.
var MGMT = {
  'eilatmanagement1': 'אילת', 'bershitmitzperamonmanagement': 'מצפה רמון',
  'sdebokermanagement': 'שדה בוקר', 'telavivmanagement': 'תל אביב-יפו',
  'jerusalemmanagement1': 'ירושלים, אזור ירושלים', 'dead-seamanagement': 'Unknown',
  'northmanagement': 'חיפה', 'managementjobsinayelethashachar': 'איילת השחר',
  'managementjobsinkinneret': 'מגדל', 'managementjobsinroshpina': 'ראש פינה'
};
// Info/promo pages linked from the same card grids. jerusalemneeded is a
// recruiting promo ("משרה מספר 11") with no role.
var NONJOB_DIR = { 'fun': 1, 'fun-in-isrotel': 1, 'offers': 1, 'nationwide': 1 };
var NONJOB_SLUG = { 'jerusalemneeded': 1 };

var SPACES = new RegExp('[ \\t' + String.fromCharCode(160) + ']+', 'g');
function structuredText(node) {
  if (!node) return '';
  var c = node.cloneNode(true);
  c.querySelectorAll('style,script').forEach(function (e) { e.remove(); });
  c.querySelectorAll('p,div,ul,ol,li,br,h1,h2,h3,h4,h5,h6,tr')
    .forEach(function (e) { e.insertAdjacentText('afterend', '\n'); });
  return c.textContent.replace(SPACES, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
// How-to-apply lines: pointers to the form below, the WhatsApp link, "attach a CV".
var APPLY = /וואטס ?אפ|^\**\s*רוצים לשמוע עוד\??$|(מגישים|הגישו|להגשת) מועמדות|(השאירו|משאירים) פרטים|רשמו פה את הפרטים|^י?ש לצרף (קו"ח|קורות חיים)/;
// A heading is a short line ending in ':' or '?' (an emoji may follow).
var HEAD = /^.{1,45}[:?][^א-תA-Za-z0-9]{0,4}$/;
var REQ = /נדרש|מחפשים|כישורים|דרישות|תנאי סף|מביא/;
// Inside a requirements list: equal-opportunity, scope/hours and a closing
// exclamation are not requirements - they end the list and stay in desc.
var NOTREQ = /לנשים וגברים|לגברים ונשים|לשני המינים|משרה מלאה|משרה חלקית|ימים בשבוע|[!…]$/;
var LABEL = /^(תיאור( ה?תפקיד| ה?משרה)?|על התפקיד)\s*:?\s*$/;

var cards = Array.prototype.slice.call(document.querySelectorAll(ITEM));
for (var i = 0; i < cards.length; i++) {
  var card = cards[i];
  if (card.querySelector('.__ai-jobid')) continue;
  var a = card.querySelector('a[href*="/careers/job-res/"]');
  if (!a) { card.remove(); continue; }
  var parts = decodeURIComponent(new URL(a.href).pathname).split('/').filter(Boolean);
  var dir = parts[2] || '', slug = parts[parts.length - 1] || '';
  if (parts.length !== 4 || NONJOB_DIR[dir] || NONJOB_SLUG[slug]) { card.remove(); continue; }
  try {
    var doc = new DOMParser().parseFromString(await get(a.href), 'text/html');
    var li = doc.querySelector('#job-description ul.activity_info > li');
    var body = li && li.querySelector('.long_description');
    var head = li ? li.cloneNode(true) : null;
    if (head) head.querySelectorAll('.long_description').forEach(function (e) { e.remove(); });
    var headText = head ? head.textContent.replace(/\s+/g, ' ').trim() : '';
    var m = /משרה מספר\s*(\d+)\s*-?\s*(.*)$/.exec(headText);
    if (!m || !body || !/^[a-z0-9-]+$/i.test(slug)) { console.warn('isrotel: no job number/body ' + a.href); card.remove(); continue; }

    // Requirements run from a requirements heading (label dropped) to the next
    // heading - or to the end of the heading's own paragraph when its items
    // share it (<br> lists), so a closing line after the list stays in desc.
    var desc = [], req = [];
    if (m[2]) desc.push(m[2]);
    var blocks = Array.prototype.slice.call(body.querySelectorAll('p,li,div,h1,h2,h3,h4,h5,h6'))
      .filter(function (e) { return !e.querySelector('p,li,div'); });
    if (!blocks.length) blocks = [body];
    var inReq = false, sameBlock = false;
    for (var b = 0; b < blocks.length; b++) {
      if (inReq && sameBlock) inReq = false;
      var ls = structuredText(blocks[b]).split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      for (var k = 0; k < ls.length; k++) {
        var s = ls[k];
        if (APPLY.test(s)) continue;
        var core = s.replace(/^[^א-תA-Za-z0-9]+/, '');
        if (HEAD.test(core)) {
          if (REQ.test(core)) { inReq = true; sameBlock = k < ls.length - 1; continue; }
          inReq = false;
          if (LABEL.test(core)) continue;
        }
        if (inReq && NOTREQ.test(s)) inReq = false;
        (inReq ? req : desc).push(s);
      }
    }
    var mk = function (cls, val) {
      if (!val) return;
      var e = document.createElement('span');
      e.className = cls; e.style.display = 'none'; e.textContent = val; card.appendChild(e);
    };
    mk('__ai-title', (doc.title || '').trim());
    mk('__ai-jobid', 'isrotel-' + m[1] + '-' + slug.toLowerCase());
    mk('__ai-description', desc.join('\n'));
    mk('__ai-requirements', req.join('\n'));
    mk('__ai-location', dir === 'management' ? (MGMT[slug] || 'Unknown') : (LOC[dir] || 'Unknown'));
  } catch (e) { console.warn('isrotel: fetch failed ' + a.href); card.remove(); }
}
