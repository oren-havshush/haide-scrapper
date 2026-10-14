// Mega Talents board on TalentFlow (Supabase SPA). One GET to the board's public jobs call
// (rpc get_public_jobs_safe), with the project URL and publishable key read from the page's own
// bundle on every run. FAILS CLOSED: no bundle, no key, a non-200 or a non-array answer builds no item.
// Id mega-talents-<printed #job_number>. Location = the job's city field through a closed city.csv map.
// Apply: the board's own submit (multipart POST to the edge function), one blob per job (job_id).
if (document.getElementById('haide-mt')) return;
var T0 = Date.now();
var OWNER = '9f1e20dd-d382-4174-88ce-c4d952aa54ce';
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var get = async function (url, hdr, json) {
  for (var a = 0; a < 2; a++) {
    try {
      var r = await fetch(url, { headers: hdr || {}, cache: 'no-store' });
      if (r.ok) return json ? await r.json() : await r.text();
    } catch (e) {}
    await sleep(1000);
  }
  return null;
};
var sc = null;
for (var w = 0; w < 20 && !sc; w++) {
  sc = document.querySelector('script[type="module"][src*="/assets/index-"]');
  if (!sc) await sleep(250);
}
var js = sc ? await get(sc.src) : null;
var km = js && /"(https:\/\/[a-z0-9]{8,}\.supabase\.co)",[\w$]+="(sb_publishable_[\w-]{16,})"/.exec(js);
if (!km) { console.warn('[mega-talents] bundle key not found'); return; }
var SB = km[1], KEY = km[2];
var list = await get(SB + '/rest/v1/rpc/get_public_jobs_safe?_owner_user_id=' + OWNER, { apikey: KEY }, true);
if (!Array.isArray(list) || !list.length) { console.warn('[mega-talents] jobs call failed'); return; }
var WS = new RegExp('[ \\t' + String.fromCharCode(160, 8203) + ']+', 'g');
var OK1 = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var MATH = new RegExp('[' + String.fromCodePoint(0x1D400) + '-' + String.fromCodePoint(0x1D7FF) + ']', 'gu');
// city field value -> verbatim city.csv row; a name not listed here ships Unknown (closed map)
var CITY = {};
('חיפה ראש_העין עפולה אשדוד באר_שבע גן_יבנה גבעת_ברנר ירושלים חדרה מעלה_אדומים רעננה אשקלון יבנה הוד_השרון חולון '
  + 'קרית_ביאליק נתניה כפר_סבא בני_ראם פתח_תקווה ראשון_לציון נצר_סרני אילת רחובות נתיבות רמת_גן עכו מודיעין '
  + 'גדרה פרדסיה אור_יהודה פלמחים הרצליה בית_שמש').split(' ').forEach(function (c) { c = c.replace(/_/g, ' '); CITY[c] = c; });
CITY['תל אביב - יפו'] = CITY['תל אביב'] = CITY['תל אביב-יפו'] = 'תל אביב-יפו';
CITY['רמלה'] = CITY['לוד'] = 'רמלה לוד';
CITY['בת ים'] = 'בת-ים';
CITY['יהוד-מונוסון'] = CITY['יהוד'] = 'יהוד';
var AREA = { 'השרון': 'אזור השרון', 'המרכז': 'אזור מרכז', 'הצפון': 'אזור צפון', 'הדרום': 'אזור דרום', 'השפלה': 'אזור שפלה' };
var NAMES = Object.keys(CITY).sort(function (x, y) { return y.length - x.length; });
// work-location cue line ("מיקום המשרה: X", "מקום העבודה", "📍 מיקום"); only city names from CITY are read
var CUE = /^\W{0,3}(?:מיקום|מקום העבודה)/;
// body split (job body rules 1-2, LRN-SETUP-18): requirement sections -> requirements, labels dropped;
// hours, scope, pay/benefits and office lines inside a requirement section stay in the description
var REQH = /^(?:(?:דרישות|דרישת)(?:\s+\S+){0,2}|(?:ה)?כישורים(?:\s+\S+)?|Requirements|Qualifications)$/i;
var REQP = /^(?:דרישות|דרישת|כישורים|כישורי|הכישורים|Requirements|Qualifications)/i;
var LABEL = /^(?:תיאור|תאור)(?:\s+(?:ה)?(?:משרה|תפקיד))?$/;
var DESCH = /^(?:תחומי אחריות|מהות התפקיד|שעות|ימי עבודה|ימים ושעות|היקף|תנאי (?:ה)?(?:משרה|עבודה|העסקה)|תנאים(?:[\s,:]|$)|שכר|מיקום|מקום העבודה|מה אנחנו מציעים|אנחנו מציעים|מה מציעים|הטבות|המשימות|התפקיד כולל|העבודה כוללת|במסגרת התפקיד|מטרת התפקיד|אופי המשרה|שגרת יום|הדגשים|פרופיל משרה|כפיפות|על החברה|מאפיינים|המשרה$|\*\*|📍)/;
var BUL = new RegExp('^[•●▪*+✅ü' + String.fromCharCode(0xF0B7) + '\\-–]');
var NOPAY = function (l) { return l.replace(/חשב\S*\s+שכר/g, ''); };
var LEAD = /^(?:[^\p{L}\p{N}]|ü(?=\s))+/u;
var STAY = function (l) {
  var s = l.replace(LEAD, ''), q = /חובה|יתרון/.test(l);
  return /\d{1,2}:\d{2}/.test(l) || /^(?:שעות|ימים? |ימי |יום שישי|שישי|א['׳’]?\s*-\s*ה)/.test(s)
    || (!q && /^(?:משרה (?:מלאה|חלקית)|היקף|למשרה מלאה|העבודה (?:במשרה|במשרדי|מתבצעת|אינה)|עבודה בימי)/.test(s))
    || /₪|ש"ח/.test(l) || /^(?:שכר|מימון|מענק|בונוס|קרן השתלמות|פנסיה|הטבות|ביגוד|אוטובוס צמוד|רכב צמוד|לינה|אפשרות לגרירת|תנאים)/.test(NOPAY(s))
    || /^(?:משרדנו|המשרדים|מיקום|המשרה (?:מיועדת|פונה))/.test(s);
};
var REQW = /^(?:ניסיון|נסיון|ידע|רישיון|רשיון|תעודה|תעודת|בעל|יכולת|נכונות|זמינות|שליטה|הכרה|הכרת|היכרות|מגורים|דובר|עדיפות|נדרש|יוצא|רצוי|גישה|עם ידע|עם ניסיון|ראש גדול|אנגלית|עברית|שפות)/;
var QUAL = function (l) {
  var s = l.replace(LEAD, '');
  return (/חובה|יתרון/.test(l) || REQW.test(s)) && !/דרוש/.test(l) && l.length <= 150 && !STAY(l)
    && !/[-–]\s*חובה(?:\s+\S+){3,}/.test(l);
};
var lines = function (html) {
  var d = new DOMParser().parseFromString('<div>' + (html || '') + '</div>', 'text/html').body.firstChild;
  d.querySelectorAll('br').forEach(function (e) { e.replaceWith('\n'); });
  d.querySelectorAll('li').forEach(function (e) {
    if (!/^\s*[•●▪*\-–]/.test(e.textContent)) e.insertBefore(document.createTextNode('• '), e.firstChild);
  });
  d.querySelectorAll('p,li,ul,ol,div,hr,h1,h2,h3,h4,h5,h6').forEach(function (e) { e.after('\n'); });
  return d.textContent.split('\n').map(function (l) { return l.replace(WS, ' ').trim(); })
    .filter(function (l) { return l && !/^[•●▪*\-–.:\s]+$/.test(l); });
};
var split = function (ls) {
  // segments in page order; each line object {t, r}: r = goes to requirements
  var segs = [], cur = null, heads = 0;
  var open = function (r) { cur = { r: r, l: [] }; segs.push(cur); };
  open(false);
  ls.forEach(function (l) {
    var k = l.replace(/[\s:\-–—]+$/, '');
    var m = /^([^:]{2,30}):\s*(\S.*)$/.exec(l) || /^([^:\-–]{2,30})\s+[-–]\s+(\S.*)$/.exec(l);
    if ((k.length <= 30 && REQH.test(k)) || (k !== l && k.length <= 30 && REQP.test(k))) { heads++; open(true); return; }
    if (m && REQP.test(m[1].trim())) { heads++; open(true); cur.l.push({ t: m[2], r: true }); return; }
    if (LABEL.test(k)) { open(false); return; }
    if (m && LABEL.test(m[1].trim())) { open(false); cur.l.push({ t: m[2] }); return; }
    if (k.length <= 60 && DESCH.test(k)) { open(false); cur.l.push({ t: l }); return; }
    cur.l.push({ t: l, r: cur.r && !STAY(l) });
  });
  segs.forEach(function (s) {
    if (!s.r) return;
    // a requirement section's trailing prose (a long line that is not a requirement) is description
    for (var i = s.l.length - 1; i >= 0; i--) {
      var o = s.l[i];
      if (!o.r) continue;
      if (o.t.length >= 60 && !BUL.test(o.t) && !QUAL(o.t)) o.r = false; else break;
    }
  });
  var all = [].concat.apply([], segs.map(function (s) { return s.l; }));
  if (!heads) {
    // no requirements heading: classify the line; a bullet run where half qualify moves as one block
    all.forEach(function (o) { o.r = QUAL(o.t); });
    for (var i = 0; i < all.length;) {
      if (!BUL.test(all[i].t)) { i++; continue; }
      var e = i; while (e < all.length && BUL.test(all[e].t)) e++;
      var run = all.slice(i, e), q = run.filter(function (o) { return o.r; }).length;
      if (q * 2 >= run.length) run.forEach(function (o) { o.r = !STAY(o.t); });
      i = e;
    }
  }
  var join = function (want) {
    var a = all.filter(function (o) { return !!o.r === want; }).map(function (o) { return o.t; });
    while (a.length && /:\s*$/.test(a[a.length - 1]) && a[a.length - 1].length <= 25) a.pop();
    return a.join('\n');
  };
  return { d: join(false), r: join(true) };
};
var ACT = SB + '/functions/v1/submit-public-application';
var BASE = [['full_name', 'שם מלא', 'text'], ['phone', 'טלפון', 'tel'], ['email', 'אימייל', 'email'], ['resume', 'קורות חיים', 'file']];
var root = document.createElement('div');
root.id = 'haide-mt';
root.style.display = 'none';
var dropped = [], seenNum = {};
list.forEach(function (j) {
  var num = j && j.job_number;
  if (!j || j.status !== 'published' || !/^[0-9a-f-]{36}$/.test(j.id || '') || !(num > 0)) { dropped.push((j && j.id) + ':shape'); return; }
  var title = String(j.title || '').replace(MATH, function (c) { return c.normalize('NFKC'); }).replace(WS, ' ').trim();
  if (!OK1.test(title) || BAD.test(title)) { dropped.push(num + ':lang'); return; }
  var ls = lines(j.description && j.description.text), body = split(ls);
  if (!body.d && !body.r) { dropped.push(num + ':empty'); return; }
  // location: the city field (tag); a cue line adds cities only when it also names a tag city (case 2)
  var raw = String(j.city || '').split(',').map(function (c) { return c.replace(WS, ' ').trim(); }).filter(Boolean);
  var tag = raw.map(function (c) { return CITY[c]; }).filter(Boolean);
  if (tag.length < raw.length) tag = [];
  var txt = [];
  ls.filter(function (l) { return CUE.test(l); }).forEach(function (l) {
    // longest name first, and a matched name is blanked out ("גן יבנה" must not also read as "יבנה")
    NAMES.forEach(function (c) {
      var re = new RegExp('(^|[^א-ת])[ובל]?' + c + '(?![א-ת])');
      if (!re.test(l)) return;
      if (txt.indexOf(CITY[c]) < 0) txt.push(CITY[c]);
      l = l.replace(re, '$1 ');
    });
  });
  // owner 2026-10-14: 274 keeps the tag only ("מיקום- אשדוד, מעבר לגבעת ברנר" is a move, not a second place)
  if (num === 274) txt = [];
  var loc = !tag.length ? (raw.length ? [] : txt) : txt.some(function (c) { return tag.indexOf(c) >= 0; }) ? tag.concat(txt) : tag;
  // a cue line naming a tag city plus "ואזור X" gets the area too (LRN-LOC-21; owner 2026-10-14, 32 נתניה ואזור השרון)
  if (tag.length && txt.some(function (c) { return tag.indexOf(c) >= 0; })) ls.filter(function (l) { return CUE.test(l); }).forEach(function (l) {
    var m = /(?:^|[^א-ת])ו?(?:ב|ל)?אזור (השרון|המרכז|הצפון|הדרום|השפלה)(?![א-ת])/.exec(l);
    if (m) loc.push(AREA[m[1]]);
  });
  loc = loc.filter(function (v, i) { return loc.indexOf(v) === i; });
  var fs = j.form_schema || {}, bf = fs.baseFields || {};
  var fields = BASE.map(function (b) {
    return { name: b[0], label: b[1], fieldType: b[2], tagName: 'INPUT', required: !!(bf[b[0]] && bf[b[0]].required) };
  });
  (Array.isArray(fs.fields) ? fs.fields : []).forEach(function (f) {
    var o = { name: 'custom_data.' + f.id, label: f.label, fieldType: f.type === 'select' ? 'select' : 'text',
      tagName: f.type === 'select' ? 'SELECT' : 'INPUT', required: !!f.required };
    if (Array.isArray(f.options)) o.options = f.options;
    fields.push(o);
  });
  fields.push({ name: 'job_id', label: 'job_id', fieldType: 'hidden', tagName: 'INPUT', required: true, value: j.id });
  fields.push({ name: 'by', label: 'by', fieldType: 'hidden', tagName: 'INPUT', required: false, value: OWNER });
  var url = 'https://talentflow.co.il/job/' + j.id;
  var blob = JSON.stringify({ actionUrl: ACT, actionAttribute: ACT, formTag: 'div', method: 'POST', enctype: 'multipart/form-data',
    pageUrl: url, requestHeaders: { apikey: KEY, Authorization: 'Bearer ' + KEY },
    note: 'custom_data.* answers go JSON-encoded in one custom_data field, keyed by id, with _labels {id: label}', fields: fields });
  var it = document.createElement('div');
  it.className = 'haide-job';
  var add = function (cls, v) { var s = document.createElement('span'); s.className = cls; s.textContent = v; it.appendChild(s); };
  var a = document.createElement('a');
  a.className = 'haide-link'; a.href = url; a.textContent = title;
  it.appendChild(a);
  add('__ai-externalJobId', 'mega-talents-' + num);
  if (j.category_name) add('__ai-department', String(j.category_name).trim());
  if (body.d) add('__ai-description', body.d);
  if (body.r) add('__ai-requirements', body.r);
  add('__ai-location', loc.length ? loc.join(', ') : 'Unknown');
  var dt = new Date(j.created_at);
  if (!isNaN(dt)) add('__ai-publishDate', dt.toISOString());
  add('__ai-applicationInfo', blob);
  add('__ai-formData', blob);
  if (seenNum[num]) dropped.push(num + ':dupnum');
  seenNum[num] = 1;
  root.appendChild(it);
});
document.body.appendChild(root);
console.log('[mega-talents] api ' + list.length + ', jobs ' + root.children.length + ', dropped ' + dropped.join(' ') + ', ' + (Date.now() - T0) + ' ms');
