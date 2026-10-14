// efshar-a: the listing's cards + older jobs shown on a visibly linked archive page. Body/date from REST
// (a card REST lacks fails the run). All-or-nothing. Id efshar-a-<printed n> (unique only). Location: tags + ad lines, four-case. Per-job CV form.
if (document.getElementById('haide-efshar')) return;
var T0 = Date.now();
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
for (var w = 0; w < 20 && !document.querySelector('.single-job a.job-title'); w++) await sleep(500);
var NB = String.fromCharCode(160);
var WS = new RegExp('[ \\t' + NB + ']+', 'g');
var OK1 = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var MATH = new RegExp('[' + String.fromCodePoint(0x1D400) + '-' + String.fromCodePoint(0x1D7FF) + ']', 'gu');
var get = async function (url, json) {
  for (var a = 0; a < 2; a++) {
    try {
      var r = await fetch(url, { credentials: 'include', cache: 'no-store' });
      if (r.ok && !r.redirected) return json ? await r.json() : await r.text();
    } catch (e) {}
    await sleep(1500);
  }
  return null;
};
var parse = function (h) { return new DOMParser().parseFromString(h, 'text/html'); };
var key = function (u) { try { u = decodeURIComponent(new URL(u, location.href).pathname); } catch (e) {} return String(u).toLowerCase().replace(/\/+$/, ''); };
var dec = function (s) { var t = document.createElement('textarea'); t.innerHTML = s || ''; return t.value; };
var cardOf = function (c, from) {
  var a = c.querySelector('a.job-title');
  var tags = Array.prototype.map.call(c.querySelectorAll('a[href*="/joblocation/"]'), function (t) { return t.textContent.replace(WS, ' ').trim(); });
  return { url: a ? new URL(a.getAttribute('href'), location.href).href : '', title: a ? a.textContent.replace(WS, ' ').trim() : '', tags: tags, from: from };
};
var cards = Array.prototype.map.call(document.querySelectorAll('.single-job'), function (c) { return cardOf(c, ''); });
if (!cards.length || cards.some(function (c) { return !c.url || !c.title; })) { console.warn('[efshar] no cards'); return; }
var rest = {}, posts = [], fail = false;
for (var p = 1; p < 20; p++) {
  var js = await get(location.origin + '/wp-json/wp/v2/jobs?per_page=100&page=' + p + '&_fields=id,date_gmt,link,title,content,jobcat,joblocation', true);
  if (js === null) { fail = true; break; }
  if (!Array.isArray(js) || !js.length) break;
  js.forEach(function (j) { if (j && j.link) { posts.push(j); rest[key(j.link)] = { id: j.id, title: dec(j.title && j.title.rendered), html: (j.content && j.content.rendered) || '', date: j.date_gmt ? j.date_gmt + 'Z' : '' }; } });
  if (js.length < 100) break;
}
if (fail || !posts.length) { console.warn('[efshar] REST failed'); return; }
var shown = {};
cards.forEach(function (c) { shown[key(c.url)] = 1; });
var vis = {};
document.querySelectorAll('a[href*="/jobcat/"], a[href*="/joblocation/"]').forEach(function (x) {
  var q = x.getBoundingClientRect(), s = getComputedStyle(x);
  if (q.width > 0 && q.height > 0 && s.visibility !== 'hidden' && s.display !== 'none') vis[key(x.href)] = x.href;
});
var older = posts.filter(function (j) { return !shown[key(j.link)]; });
var termLink = {};
if (older.length) {
  var txs = ['jobcat', 'joblocation'];
  for (var t = 0; t < txs.length && !fail; t++) {
    for (var tp = 1; tp < 10; tp++) {
      var ts = await get(location.origin + '/wp-json/wp/v2/' + txs[t] + '?per_page=100&page=' + tp + '&_fields=id,link', true);
      if (ts === null) { fail = true; break; }
      if (!Array.isArray(ts) || !ts.length) break;
      ts.forEach(function (x) { termLink[txs[t] + x.id] = x.link; });
      if (ts.length < 100) break;
    }
  }
}
var archive = {};
var readArchive = async function (url) {
  var k = key(url);
  if (archive[k] !== undefined) return archive[k];
  var todo = [url], done = {}, found = {};
  while (todo.length) {
    var u = todo.shift();
    if (done[key(u)]) continue;
    done[key(u)] = 1;
    var h = await get(u);
    if (h === null) { archive[k] = null; return null; }
    var d = parse(h);
    d.querySelectorAll('.single-job').forEach(function (c) { var cc = cardOf(c, url); if (cc.url) found[key(cc.url)] = cc; });
    d.querySelectorAll('a.page-numbers[href]').forEach(function (a) { var v = new URL(a.getAttribute('href'), u).href; if (key(v).indexOf(k) === 0 && !done[key(v)]) todo.push(v); });
  }
  archive[k] = found;
  return found;
};
for (var o = 0; o < older.length && !fail; o++) {
  var tids = (older[o].jobcat || []).map(function (i) { return 'jobcat' + i; }).concat((older[o].joblocation || []).map(function (i) { return 'joblocation' + i; }));
  for (var q2 = 0; q2 < tids.length; q2++) {
    var tl = termLink[tids[q2]];
    if (!tl || !vis[key(tl)]) continue;
    var ar = await readArchive(vis[key(tl)]);
    if (ar === null) { fail = true; break; }
    var hit = ar[key(older[o].link)];
    if (hit) { cards.push(hit); shown[key(hit.url)] = 1; break; }
  }
}
if (fail) { console.warn('[efshar] archive read failed'); return; }
var miss = cards.filter(function (c) { return !rest[key(c.url)]; });
if (miss.length) { console.warn('[efshar] REST lacks ' + miss.length + ' cards'); return; }
var fh = await get(cards[0].url), formDoc = fh && parse(fh);
var fm = formDoc && Array.prototype.filter.call(formDoc.querySelectorAll('form.wpcf7-form'), function (f) { return f.querySelector('input[type="file"]') && f.querySelector('input[name="job"]'); })[0];
if (!fm) { console.warn('[efshar] CV form not found'); return; }
var FIELDS = [];
fm.querySelectorAll('input, select, textarea').forEach(function (e) {
  var ft = (e.tagName === 'INPUT' ? (e.getAttribute('type') || 'text') : e.tagName.toLowerCase()).toLowerCase();
  if (/^(submit|button|reset|image)$/.test(ft) || !e.name) return;
  var lb = (e.id && fm.querySelector('label[for="' + e.id + '"]')) || e.closest('label');
  var o = { name: e.name, label: ((lb ? lb.textContent : '') || e.getAttribute('placeholder') || e.name).replace(/\s+/g, ' ').trim(),
    fieldType: ft, tagName: e.tagName,
    required: e.hasAttribute('required') || e.getAttribute('aria-required') === 'true' || !!e.closest('.wpcf7-acceptance:not(.optional)') };
  // a browser-made token is never stored
  if (ft === 'hidden') o.value = /recaptcha|posted_data_hash/.test(e.name) ? '' : (e.getAttribute('value') || '');
  FIELDS.push(o);
});
var TAG = (/#wpcf7-f\d+-o\d+/.exec(fm.getAttribute('action') || '') || [''])[0];
var RLAB = /^(דרישות|דרושות|כישורים|Requirements|Qualifications|Background and experience required|רקע וניסיון נדרש|השכלה|ניסיון מקצועי|ידע נדרש|דגשים|Emphasis)([^:\-–]{0,20})?\s*[:\-–]?\s*/i;
var DLAB = /^(תיאור|תאור|Company Description|Role Description|אופי התפקיד|פירוט המשימות|במסגרת התפקיד|מיקום המשרה|תנאים|תנאי|יעוד העיסוק)([^:\-–]{0,20})?\s*[:\-–]?\s*$/i;
var PURE = /^(תיאור|תאור)( ה)?(חברה|תפקיד|משרה)\s*[:\-–]?$|^(Company|Role) Description$|^(אופי|תיאור|תאור) (ה)?תפקיד\s*:?$|^תיאור\s*:$/;
var TERMS = /^[\s\-–—•*.]*(משרה מלאה|משרה חלקית|היקף משרה|שכר|תנאים|תנאי|ימים|שעות|א['׳]?\s*-\s*ה)/;
var APPLY = /@|קו["״]ח|קורות חיים|resume|לציין|בציון|specify/i;
var NUMLINE = /^[\s(]*(משרה\s*)?(\d{4,6}|JB-\d+)[\s)]*$/;
var EMPTY = /^[\s\-–—•●·o§*.:]*$/;
var REQEND = /(^|[\s\-–—•●*(])(יתרון|חובה)( משמעותי)?\s*[!.)]*$|[\-–]\s*(mandatory|required|an advantage)\s*\.?$/i;
var EQ = /לנשים וגברים|לגברים ולנשים|לנשים ולגברים/;
var split = function (html) {
  var c = document.createElement('div');
  c.innerHTML = html;
  c.querySelectorAll('script, style, form').forEach(function (e) { e.remove(); });
  c.querySelectorAll('input').forEach(function (e) { e.replaceWith(' ' + (e.getAttribute('value') || '')); });
  c.querySelectorAll('br').forEach(function (e) { e.replaceWith('\n'); });
  c.querySelectorAll('p, li, div, h1, h2, h3, h4, h5, h6, tr').forEach(function (e) { e.appendChild(document.createTextNode('\n')); });
  var sec = 'D', D = [], R = [], all = [], moved = [];
  (c.textContent || '').split('\n').forEach(function (l) {
    l = l.replace(WS, ' ').trim();
    if (EMPTY.test(l) || NUMLINE.test(l)) return;
    all.push(l);
    if (PURE.test(l)) { sec = 'D'; return; }
    var rm = RLAB.exec(l);
    if (rm && (rm[0].length === l.length || /[:\-–]\s*$/.test(rm[0]))) { sec = 'R'; l = l.slice(rm[0].length).trim(); if (!l) return; }
    else if (DLAB.test(l)) { sec = 'D'; return; }
    if (sec === 'R' && (TERMS.test(l) || APPLY.test(l) || EQ.test(l))) { D.push(l); return; }
    if (sec === 'D' && REQEND.test(l) && !TERMS.test(l)) { moved.push(l); return; }
    (sec === 'R' ? R : D).push(l);
  });
  moved = moved.filter(function (l) { return R.indexOf(l) < 0; });
  return { d: D.join('\n'), r: moved.concat(R).join('\n'), lines: all };
};
var PL = [['תל[ -]אביב|ת["״]א', 'תל אביב-יפו', 'אזור מרכז'], ['רמת[ -]גן|ר["״]ג', 'רמת גן', 'אזור מרכז'], ['בני[ -]ברק', 'בני ברק', 'אזור מרכז'],
  ['פתח[ -]תקו?וה|פ["״]ת', 'פתח תקווה', 'אזור מרכז'], ['גבעת שמואל', 'גבעת שמואל', 'אזור מרכז'], ['ראשון לציון|ראשל["״]צ', 'ראשון לציון', 'אזור מרכז'],
  ['אור יהודה', 'אור יהודה', 'אזור מרכז'], ['ראש העין', 'ראש העין', 'אזור מרכז'], ['חולון', 'חולון', 'אזור מרכז'], ['גבעתיים', 'גבעתיים', 'אזור מרכז'],
  ['בת[ -]ים', 'בת-ים', 'אזור מרכז'], ['יהוד', 'יהוד', 'אזור מרכז'], ['מודיעין', 'מודיעין', 'אזור ירושלים'], ['ירושלים', 'ירושלים', 'אזור ירושלים'],
  ['בית שמש', 'בית שמש', 'אזור ירושלים'], ['יבנה', 'יבנה', 'אזור שפלה'], ['אשדוד', 'אשדוד', 'אזור שפלה'], ['רחובות', 'רחובות', 'אזור שפלה'],
  ['באר שבע|ב["״]ש', 'באר שבע', 'אזור דרום'], ['דימונה', 'דימונה', 'אזור דרום'], ['קרית גת|קריית גת', 'קרית גת', 'אזור דרום'],
  ['קיסריה', 'קיסריה', 'אזור השרון'], ['נחשונים', 'נחשונים', 'אזור השרון'], ['רמת השרון', 'רמת השרון', 'אזור השרון'], ['כפר סבא', 'כפר סבא', 'אזור השרון'],
  ['רעננה', 'רעננה', 'אזור השרון'], ['הרצליה', 'הרצליה', 'אזור השרון'], ['הוד השרון', 'הוד השרון', 'אזור השרון'], ['נתניה', 'נתניה', 'אזור השרון'],
  ['חיפה', 'חיפה', 'אזור צפון'], ['אריאל', 'אריאל', 'אזור יהודה ושומרון'], ['לוד', 'רמלה לוד', 'אזור מרכז'], ['גוש דן', 'אזור מרכז', 'אזור מרכז']
].map(function (q) { return { re: new RegExp('(?:^|[^א-ת])(?:ו?ב|ל)?(?:' + q[0] + ')(?![א-ת])'), row: q[1], area: q[2] }; });
var RG = { 'מרכז': 'אזור מרכז', 'דרום': 'אזור דרום', 'צפון': 'אזור צפון', 'שרון': 'אזור השרון', 'שפלה': 'אזור שפלה' };
var RGRE = /(?:^|[^א-ת])(?:ב|ל)?(?:אזור|איזור)\s+ה?(מרכז|דרום|צפון|שרון|שפלה)((?:\s*[\/,]\s*ה?(?:מרכז|דרום|צפון|שרון|שפלה))*)(?![א-ת])|(?:^|[^א-ת])ב(מרכז|דרום|צפון) הארץ/;
var CUE = /(^|[\s(])(ל|ב)?(חבר[הת]|משרד|סוכנות|מפעל|רשות|מכללה|מוסך|חנות|פרויקט|ארגון|קבוצת)|דרוש|מחפש|מיקום|ממוקמ|המשרה|משרה מלאה|משרה חלקית|העבודה|עבודה ב|position/i;
var NOT = /מגורים|הסעות|הגעה|אצל (ה)?לקוח|באתרי (ה)?לקוח|המשרדים נמצאים|משרדי החברה|קו קבוע/;
var textPlaces = function (lines) {
  var cs = [], rs = [];
  // the title (line 0) always counts as a cue line
  lines.forEach(function (l, i) {
    if ((i && !CUE.test(l)) || NOT.test(l)) return;
    var g = RGRE.exec(l);
    if (g) (g[1] ? [g[1]].concat((g[2] || '').split(/[\/,]/).map(function (x) { return x.replace(/^\s*ה?/, '').trim(); })) : [g[3]])
      .forEach(function (x) { if (RG[x] && rs.indexOf(RG[x]) < 0) rs.push(RG[x]); });
    else PL.forEach(function (q) { if (q.re.test(l) && cs.indexOf(q) < 0) cs.push(q); });
  });
  var out = cs.map(function (q) { return { row: q.row, area: q.area }; });
  rs.forEach(function (r) { if (!cs.some(function (q) { return q.area === r; })) out.push({ row: r, area: r }); });
  return out;
};
// tags: city.csv rows, or mapped; others dropped
var TROWS = 'אור יהודה|אורנית|אזור|אילת|אריאל|אשדוד|אשקלון|באר יעקב|באר שבע|בית שמש|בני ברק|בת חפר|גבעת שמואל|גבעתיים|גדרה|גן יבנה|דימונה|הוד השרון|הרצליה|חדרה|חולון|חיפה|טבריה|יבנה|יהוד|יחיעם|ירוחם|ירושלים|כפר יונה|כפר סבא|כפר קאסם|כרמיאל|מודיעין|מזכרת בתיה|נהריה|נחשונים|נצרת|נתניה|עין דור|עכו|עמק חפר|עפולה|ערד|פתח תקווה|צופית|צפת|קיסריה|קרית גת|קרית טבעון|ראש העין|ראשון לציון|רחובות|רמת גן|רמת השרון|רמת ישי|רעננה|שוהם|שומרון|תל מונד'.split('|');
var TMAP = { 'תל אביב': 'תל אביב-יפו', 'בת ים': 'בת-ים', 'לוד': 'רמלה לוד', 'מרכז': 'אזור מרכז', 'דרום': 'אזור דרום', 'צפון': 'אזור צפון',
  'שרון': 'אזור השרון', 'שפלה': 'אזור שפלה', 'יהודה ושומרון': 'אזור יהודה ושומרון', 'ירושלים והסביבה': 'ירושלים', 'כל הארץ': 'פריסה ארצית' };
// per-job owner rulings: 9582 field work (client city does not count); 9824 = the role of 9817/9543;
// 9818-9823: their default list sits in two regions
var MS = ['אזור מרכז', 'אזור השרון'];
var OVR = { 9582: ['אזור דרום'], 9824: ['גבעת שמואל'], 9818: MS, 9819: MS, 9820: MS, 9821: MS, 9822: MS, 9823: MS };
var LONG = 20;
// four-case; the long default list (20+) with no place in the ad -> Unknown
var place = function (tags, lines) {
  var T = [];
  tags.forEach(function (n) { var r = TMAP[n] || (TROWS.indexOf(n) >= 0 ? n : ''); if (r && T.indexOf(r) < 0) T.push(r); });
  var X = textPlaces(lines), xr = X.map(function (x) { return x.row; });
  var long = tags.length >= LONG;
  if (!T.length) return xr.length ? xr : ['Unknown'];
  if (!X.length) return long ? ['Unknown'] : T;
  // a region word in the ad keeps the tag (it narrows only a nationwide tag)
  if (X.every(function (x) { return x.row === x.area; }) && T.indexOf('פריסה ארצית') < 0) return long ? xr : T;
  var inArea = function (x) { return T.indexOf(x.row) >= 0 || T.indexOf(x.area) >= 0 || T.indexOf('פריסה ארצית') >= 0; };
  if (X.every(inArea)) return xr;
  if (!long && X.some(function (x) { return T.indexOf(x.row) >= 0; })) return T.concat(xr.filter(function (r) { return T.indexOf(r) < 0; }));
  return long ? ['Unknown'] : T;
};
var NUM = /\(\s*(?:משרה\s*)?(\d{4,6}|JB-\d+)\s*\)/;
var NCOUNT = {};
cards.forEach(function (c) { var n = (NUM.exec(c.title) || [])[1]; c.num = n || ''; if (n) NCOUNT[n] = (NCOUNT[n] || 0) + 1; });
var root = document.createElement('div');
root.id = 'haide-efshar';
root.style.display = 'none';
var dropped = [];
cards.forEach(function (c) {
  var b = rest[key(c.url)];
  var title = c.title.replace(MATH, function (ch) { return ch.normalize('NFKC'); });
  if (!OK1.test(title) || BAD.test(title)) { dropped.push(c.url + ':lang'); return; }
  title = title.replace(new RegExp('\\s*' + NUM.source + '\\s*'), ' ').replace(WS, ' ').trim() || title;
  var s = split(b.html);
  var loc = OVR[b.id] || place(c.tags, [c.title].concat(s.lines));
  var dt = new Date(b.date);
  var act = c.url + TAG;
  var blob = JSON.stringify({ actionUrl: act, actionAttribute: act, formClass: fm.getAttribute('class') || '', formTag: 'form',
    method: 'POST', enctype: 'multipart/form-data', pageUrl: c.url,
    fields: FIELDS.map(function (o) { var k = Object.assign({}, o); if (k.name === 'job') k.value = b.title || c.title; return k; }) });
  var it = document.createElement('div');
  it.className = 'haide-job';
  var add = function (cls, v) { var e = document.createElement('span'); e.className = cls; e.textContent = v; it.appendChild(e); };
  var a = document.createElement('a');
  a.className = 'haide-link'; a.href = c.url; a.textContent = title;
  it.appendChild(a);
  if (c.num && NCOUNT[c.num] === 1) add('__ai-externalJobId', 'efshar-a-' + c.num);
  if (s.d) add('__ai-description', s.d);
  if (s.r) add('__ai-requirements', s.r);
  add('__ai-location', loc.join(', '));
  if (!isNaN(dt)) add('__ai-publishDate', dt.toISOString());
  add('__ai-applicationInfo', blob);
  add('__ai-formData', blob);
  root.appendChild(it);
});
document.body.appendChild(root);
console.log('[efshar] cards ' + cards.length + ' (from archives ' + cards.filter(function (c) { return c.from; }).length + '), rest-missing ' + miss.length + ', jobs ' + root.children.length + ', dropped ' + dropped.join(' ') + ', ' + (Date.now() - T0) + ' ms');
