// Pelephone on AdamTotal, listing-only.
var ITEM = 'article.job-card', prev = -1, stable = 0;
for (var t = 0; t < 60; t++) {
  var n = document.querySelectorAll(ITEM).length;
  if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n;
  await new Promise(function (r) { setTimeout(r, 500); });
}
function each(s, f, root) { (root || document).querySelectorAll(s).forEach(f); }
var TOK = new URL(location.href).searchParams.get('token') || '';
// Per-job form: [name, type, value, label]
var H = 'hidden', TS = 'cf-turnstile-response', FB = [['domain', H, ''], ['shared', H, ''], ['isCampaign', H, '0'],
  ['Fname', 'text', , 'שם פרטי'], ['Lname', 'text', , 'שם משפחה'], ['Phone', 'text', , 'טלפון'], ['Email', 'email', , 'דוא"ל'],
  ['CvFile', 'file', '.pdf,.doc,.docx', 'צרף קורות חיים'], [TS, H, , 'Cloudflare Turnstile token']];
function form(no) {
  return JSON.stringify({ formSelector: 'form#ajax-cv-form', actionUrl: location.origin + '/Jobs/SubmitApplication', method: 'POST', enctype: 'multipart/form-data',
    fields: FB.concat([['OrderNo', H, no], ['Token', H, TOK]]).map(function (f) {
      var o = { name: f[0], label: f[3] || f[0], tagName: 'input', required: f[0] === TS, fieldType: f[1] };
      if (f[2] != null) o[f[1] === 'file' ? 'accept' : 'value'] = f[2];
      return o;
    }) });
}

// Pages 2+ appended, all or nothing.
var first = document.querySelector(ITEM);
if (first && !document.querySelector('.__ai-paged')) {
  var box = first.parentElement, byId = {}, last = 1, ok = true;
  each(ITEM, function (a) { byId[a.getAttribute('data-job-id')] = 1; });
  each('a[href*="page="]', function (a) { var m = (a.getAttribute('href') || '').match(/[?&]page=(\d+)/); if (m && +m[1] > last) last = +m[1]; });
  for (var pg = 2; pg <= last && pg <= 40; pg++) {
    var cards = [];
    try {
      var res = await fetch('/Home/Index?page=' + pg + '&token=' + encodeURIComponent(TOK), { credentials: 'same-origin' });
      if (!res.ok || res.redirected) { ok = false; break; }
      cards = new DOMParser().parseFromString(await res.text(), 'text/html').querySelectorAll(ITEM);
    } catch (e) { ok = false; break; }
    if (!cards.length) { ok = false; break; }
    cards.forEach(function (a) { var k = a.getAttribute('data-job-id'); if (k && !byId[k]) { byId[k] = 1; box.appendChild(document.importNode(a, true)); } });
  }
  if (!ok) each(ITEM, function (a) { a.remove(); });
  put(document.body, '__ai-paged', '');
}

function structuredText(el) {
  if (!el) return '';
  var c = el.cloneNode(true);
  each('style,script,meta', function (e) { e.remove(); }, c);
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

var DESC_H = /^((תיאור|תאור) ה?(תפקיד|משרה)|התפקיד כולל|במסגרת התפקיד|קצת על התפקיד|קצת עלינו\.*|אז מה עושים\??|תנאים והטבות)$/;
var REQ_H = /^(הניסיון הנדרש|מיומנויות|ה?כישורים ה?(דרושים|נדרשים)|דרישות ה?(תפקיד|משרה)|את מי אנחנו מחפשים\? אותך!?|ועכשיו קצת עליכם\/ן\.*)$/;
var REQ_WORD = /חובה|יתרון|^[\-*#\s]*(ניסיון|ידע|יכולת|נכונות|תואר|נדרש|ו?ותק|זמינות)/;
var TERMS = /^[\-\s]*(היקף|\*?מיקו[םמ]|מנהל|איוש|ניתן להגיש|תנאים|תהנו|תמריצ|תן ביס|חבילת|אפשרויות קידום|נופש|בעניין|שלחו|אז למה|למה אתם|מה צריך|זו הזדמנות|זוהי|פלאפון רשאית|הפנייה|המשרה|העבודה|המוקד|שעות|ימי|ללא סופ)|^\*+(?=\S)|ממחלקת גיוס/;
function norm(l) { return l.replace(/^[\s:]+|[\s:]+$/g, '').replace(/\s+/g, ' ').trim(); }

var M = 'אזור מרכז', N = 'אזור צפון', S = 'אזור השרון', D = 'אזור דרום', SH = 'אזור שפלה', J = 'אזור ירושלים';
var REGION = { 'גוש דן': M, 'מרכז': M, 'צפון': N, 'השרון': S, 'דרום': D, 'השפלה': SH, 'ירושלים יו"ש': [J, 'אזור יהודה ושומרון'] };
var CITY = [[/פתח תקו?וה|פ"ת/, 'פתח תקווה'], [/כפר סבא/, 'כפר סבא'], [/נתניה/, 'נתניה'], [/אשקלון/, 'אשקלון'],
  [/אשדוד/, 'אשדוד'], [/באר שבע|ב"ש/, 'באר שבע'], [/אילת/, 'אילת'], [/בת ים/, 'בת-ים'], [/רחובות/, 'רחובות'],
  [/קרי?ית שמונה/, 'קריית שמונה'], [/ירושלים/, 'ירושלים'], [/רמת גן/, 'רמת גן'], [/תל אביב/, 'תל אביב-יפו'],
  [/רמלה|(?<![א-ת])[במל]?לוד(?![א-ת])/, 'רמלה לוד'], [/נהריה/, 'נהריה'], [/טבריה/, 'טבריה'], [/חדרה/, 'חדרה'],
  [/בית שמש/, 'בית שמש'], [/כרמיאל/, 'כרמיאל'], [/חיפה/, 'חיפה'], [/נצרת/, 'נצרת']];
var AREA_TXT = { 'מרכז': M, 'צפון': N, 'דרום': D };
var FILLER = /פארק עופר|בית הלקוח|כוכב איילון|קניון|תלפיות|כולל נסיעות ברחבי הארץ/g;
function cueCities(v) {
  var out = [], rest = v.split('|')[0];
  CITY.forEach(function (c) { var g = new RegExp(c[0].source, 'g'); if (g.test(rest)) { out.push(c[1]); rest = rest.replace(g, ' '); } });
  rest = rest.replace(FILLER, ' ').replace(/(^|\s)ו(?=\s|$)/g, ' ').replace(/[\s,.\/\-–]+/g, '');
  return rest || !out.length ? [] : out;
}

each(ITEM, function (item) {
  if (item.querySelector('.__ai-jobid')) return;
  var id = (item.getAttribute('data-job-id') || '').trim(), printed = '', tag = '';
  each('.job-meta > span', function (s) {
    if (s.querySelector('.fa-hashtag')) { var m = s.textContent.match(/(\d+)/); if (m) printed = m[1]; }
    if (s.querySelector('.fa-map-marker-alt')) tag = s.textContent;
  }, item);
  if (printed && printed === id) { put(item, '__ai-jobid', 'pelephone-' + printed); put(item, '__ai-formData', form(printed)); }

  var lines = structuredText(item.querySelector('.description-text')).split('\n').map(function (l) { return l.replace(/[^\S\n]+/g, ' ').trim(); });
  // Internal postings out (owner).
  if (lines.some(function (l) { return /[מב]פתחי ה(שירות|שרות)(?![א-ת])|בידיעת ובהמלצת/.test(l); })) { item.remove(); return; }
  var desc = [], req = [], mode = 'd', text = [], ti = item.querySelector('h4').textContent.replace(/\s+/g, ' ').trim(), m;
  // Owner: a title/location-line place beats the tag.
  CITY.forEach(function (c) { if (new RegExp('(^|[ (\\-–])[בלו]?(' + c[0].source + ')(?=$|[ ,.!|)\\-–])').test(ti)) addU(text, c[1]); });
  if ((m = ti.match(/אזור (מרכז|צפון|דרום)/))) addU(text, AREA_TXT[m[1]]);
  function brk(a) { if (a.length && a[a.length - 1] !== '') a.push(''); }
  lines.forEach(function (l) {
    if (!l) return;
    var h = norm(l);
    if ((m = l.match(/^\*?מיקו[םמ]( ה?משרה)?\*?\s*[:\-–]?\*?\s*(.+)$/))) cueCities(m[2]).forEach(function (c) { addU(text, c); });
    else if ((m = l.match(/^ה?(עבודה|מוקד)\S* ממוק[םמ]\S* ב(.+)$/))) { var v = m[2].replace(/[\s.]+$/, ''); CITY.some(function (c) { if (new RegExp('(' + c[0].source + ')$').test(v)) { addU(text, c[1]); return true; } return false; }); }
    else if ((m = l.match(/^עבודה במרכז השירות פרונטלי ב(.+?) באווירה/))) cueCities(m[1]).forEach(function (c) { addU(text, c); });
    else if ((m = l.match(/^העבודה בעמדות מכירה ב(מרכז|צפון|דרום) הארץ/))) addU(text, AREA_TXT[m[1]]);
    if (l.length < 60 && DESC_H.test(h)) { mode = 'd'; brk(desc); return; }
    if (l.length < 60 && REQ_H.test(h)) { mode = 'r'; brk(req); return; }
    if (mode === 'r' && !REQ_WORD.test(l) && TERMS.test(l)) { desc.push(l); return; }
    (mode === 'r' ? req : desc).push(l);
  });
  var d = desc.join('\n').replace(/\n{3,}/g, '\n\n').trim(), r = req.join('\n').trim();
  if (d) put(item, '__ai-description', d);
  if (r) put(item, '__ai-requirements', r);

  // Else the tag: its city, else its areas.
  var regions = [], cities = [];
  tag.split('|').forEach(function (x) {
    x = x.replace(/\s+/g, ' ').trim(); if (!x) return;
    if (REGION[x]) [].concat(REGION[x]).forEach(function (g) { addU(regions, g); });
    else if (CITY.some(function (c) { return c[1] === x; })) addU(cities, x);
  });
  var locs = text.length ? text : cities.length ? cities : regions;
  put(item, '__ai-location', locs.length ? locs.join(', ') : 'Unknown');
});
