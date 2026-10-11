// Israel Railways on AdamTotal. Listing-only: each card holds the full body.
var ITEM = 'article.job-card', prev = -1, stable = 0;
for (var t = 0; t < 60; t++) {
  var n = document.querySelectorAll(ITEM).length;
  if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n;
  await new Promise(function (r) { setTimeout(r, 500); });
}
function each(s, f, root) { (root || document).querySelectorAll(s).forEach(f); }

// Pages 2..last (from the pager) are appended here; the worker does not re-run the
// script after paging. All or nothing: a bad page empties the grid, the run refuses.
var first = document.querySelector(ITEM);
if (first && !document.querySelector('.__ai-paged')) {
  var box = first.parentElement, byId = {}, last = 1, ok = true;
  each(ITEM, function (a) { byId[a.getAttribute('data-job-id')] = 1; });
  each('a[href*="page="]', function (a) { var m = (a.getAttribute('href') || '').match(/[?&]page=(\d+)/); if (m && +m[1] > last) last = +m[1]; });
  for (var pg = 2; pg <= last && pg <= 40; pg++) {
    var u = new URL('/Home/Index', location.origin), cards = [];
    u.searchParams.set('page', String(pg));
    u.searchParams.set('token', new URL(location.href).searchParams.get('token') || '');
    try {
      var res = await fetch(u.href, { credentials: 'same-origin' });
      if (!res.ok || res.redirected) { ok = false; break; }
      cards = new DOMParser().parseFromString(await res.text(), 'text/html').querySelectorAll(ITEM);
    } catch (e) { ok = false; break; }
    if (!cards.length) { ok = false; break; }
    // A job that moved pages between fetches is appended once.
    cards.forEach(function (a) { var k = a.getAttribute('data-job-id'); if (k && !byId[k]) { byId[k] = 1; box.appendChild(document.importNode(a, true)); } });
  }
  if (!ok) each(ITEM, function (a) { a.remove(); });
  put(document.body, '__ai-paged', '');
}

function structuredText(el) {
  if (!el) return '';
  var c = el.cloneNode(true);
  each('style,script,meta', function (e) { e.remove(); }, c);
  // Dates are printed as <input value="dd/mm/yyyy">.
  each('input', function (e) { e.replaceWith(' ' + (e.getAttribute('value') || '')); }, c);
  each('br', function (b) { var x = b.nextSibling; if (x && x.nodeType === 3) x.nodeValue = x.nodeValue.replace(/^[^\S\n]*\n/, ''); }, c);
  each('p,div,ul,ol,li,br,h1,h2,h3,h4,h5,h6,tr', function (e) { e.insertAdjacentText('afterend', '\n'); }, c);
  return c.textContent;
}
function put(item, cls, val) {
  var s = document.createElement('span');
  s.className = cls; s.style.display = 'none'; s.textContent = val;
  item.appendChild(s);
}
function addU(a, v) { if (a.indexOf(v) < 0) a.push(v); }

var DESC_H = /^(תיאור( ה?(משרה|תפקיד))?|תחומי אחריות|הערה)$/;
var REQ_H = /^(דרישות סף|דרישות המהוות יתרון|יתרונות|כישורים נדרשים לתפקיד|דרישות נוספות לתפקיד)$/;
function norm(l) { return l.replace(/[\s:]+$/, '').replace(/\s+/g, ' ').trim(); }

// Places -> city.csv entries + their regions. Lod is only "רמלה לוד" (owner).
var M = 'אזור מרכז', SH = 'אזור שפלה', S = 'אזור השרון', N = 'אזור צפון', D = 'אזור דרום', J = 'אזור ירושלים';
var REGION = { 'גוש דן': M, 'השפלה': SH, 'השרון': S, 'צפון': N, 'חיפה והקריות': N, 'דרום': D, 'ירושלים יו"ש': J };
var CITY_REG = { 'רמלה לוד': [SH, M], 'חיפה': [N], 'טירת הכרמל': [N], 'נתניה': [S], 'חדרה': [S, N],
  'קרית גת': [D, SH], 'בני ברק': [M], 'תל אביב-יפו': [M], 'באר שבע': [D], 'בית שמש': [J, SH] };
// Rail sites on the tag; a facility with no defensible city stays unmapped.
var SITE = { 'משרדי הנהלה ראשית לוד': 'רמלה לוד', 'לוד': 'רמלה לוד', 'בת גלים': 'חיפה', 'חיפה מרכז': 'חיפה',
  'חיפה מזרח': 'חיפה', 'נתניה': 'נתניה', 'בני ברק': 'בני ברק', 'קרית גת': 'קרית גת', 'חדרה מזרח': 'חדרה',
  'תל אביב דרום': 'תל אביב-יפו', 'תל אביב מרכז': 'תל אביב-יפו' };
var CUE = [[/לוד/, 'רמלה לוד'], [/טירת הכרמל/, 'טירת הכרמל'], [/חיפה/, 'חיפה'], [/נתניה/, 'נתניה'], [/חדרה/, 'חדרה'],
  [/קרית גת|קריית גת/, 'קרית גת'], [/בני ברק/, 'בני ברק'], [/תל אביב|ת"א/, 'תל אביב-יפו'], [/באר שבע/, 'באר שבע'], [/בית שמש/, 'בית שמש']];
// The "מיקום" line split on , and /; one unmapped piece -> none.
function cueCities(s) {
  var out = [], ok = true;
  s.split(/[,\/]/).forEach(function (p) {
    p = p.trim(); if (!p) return;
    var hit = null;
    CUE.forEach(function (c) { if (!hit && c[0].test(p)) hit = c[1]; });
    if (hit) addU(out, hit); else ok = false;
  });
  return ok ? out : [];
}

each(ITEM, function (item) {
  if (item.querySelector('.__ai-jobid')) return;
  var id = (item.getAttribute('data-job-id') || '').trim(), printed = '', tag = '';
  each('.job-meta > span', function (s) {
    if (s.querySelector('.fa-hashtag')) { var m = s.textContent.match(/(\d+)/); if (m) printed = m[1]; }
    if (s.querySelector('.fa-map-marker-alt')) tag = s.textContent;
  }, item);
  if (printed && printed === id) put(item, '__ai-jobid', 'rail-' + printed);

  var desc = [], req = [], mode = 'd', reqSecs = 0, cue = '', wantCue = false, deadline = '', pub = '';
  function iso(s) { var m = s.match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{4}|\d{2})(?!\d)/); return m ? (m[3].length < 4 ? '20' : '') + m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) : ''; }
  // A "מיקום :" label with no value under it is dropped, like the other empty fields.
  function noCue() { if (wantCue) { wantCue = false; desc.pop(); } }
  var lines = structuredText(item.querySelector('.description-text')).split('\n').map(function (l) { return l.replace(/[^\S\n]+/g, ' ').trim(); });
  lines.forEach(function (l) { if (l.length < 60 && REQ_H.test(norm(l))) reqSecs++; });
  // Raw blank lines are list formatting; a break goes only where a section starts.
  function brk(a) { if (a.length && a[a.length - 1] !== '') a.push(''); }
  lines.forEach(function (l) {
    if (!l) return;
    var h = norm(l);
    var pd = l.match(/^תאריך\s*:\s*(.*)$/);
    if (pd) { noCue(); if (pd[1]) { pub = pub || iso(pd[1]); desc.push(l); } return; }
    var dl = l.match(/^ניתן להגיש מועמדות עד ליום\s*(.*)$/);
    if (dl) {
      noCue(); deadline = iso(dl[1]);
      if (dl[1]) { mode = 'd'; brk(desc); desc.push(l); }
      return;
    }
    var lc = l.match(/^מיקום\s*:\s*(.*)$/);
    if (lc) { noCue(); mode = 'd'; brk(desc); desc.push(l); if (lc[1]) cue = lc[1]; else wantCue = true; return; }
    if (l.length < 60 && DESC_H.test(h)) { noCue(); mode = 'd'; brk(desc); return; }
    if (l.length < 60 && REQ_H.test(h)) {
      // With 2+ requirement sections the label tells an advantage from a threshold; keep it.
      noCue(); mode = 'r'; brk(req); if (reqSecs > 1) req.push(h + ':'); return;
    }
    if (wantCue) { wantCue = false; cue = l; desc.push(l); return; }
    (mode === 'r' ? req : desc).push(l);
  });
  noCue();
  var d = desc.join('\n').replace(/\n{3,}/g, '\n\n').trim(), r = req.join('\n').trim();
  if (d) put(item, '__ai-description', d);
  if (r) put(item, '__ai-requirements', r);
  if (deadline) put(item, '__ai-deadline', deadline);
  if (pub) put(item, '__ai-publishDate', pub);

  // Owner's four cases: tag = regions + rail site(s); text = the "מיקום" line.
  var regions = [], sites = [], siteMissing = false;
  tag.split('|').forEach(function (x) {
    x = x.replace(/\s+/g, ' ').trim(); if (!x) return;
    if (REGION[x]) { addU(regions, REGION[x]); return; }
    x.split(',').forEach(function (s) { s = s.trim(); if (!s) return; if (SITE[s]) addU(sites, SITE[s]); else siteMissing = true; });
  });
  var text = cue ? cueCities(cue) : [], locs = [];
  if (text.length) {
    var shared = text.some(function (c) { return sites.indexOf(c) >= 0; });
    var inside = text.every(function (c) { return sites.indexOf(c) >= 0 || CITY_REG[c].some(function (g) { return regions.indexOf(g) >= 0; }); });
    if (shared || inside) { locs = text.slice(); sites.forEach(function (c) { addU(locs, c); }); }
  }
  if (!locs.length) locs = (sites.length && !siteMissing) ? sites : regions;
  put(item, '__ai-location', locs.length ? locs.join(', ') : 'Unknown');
});
