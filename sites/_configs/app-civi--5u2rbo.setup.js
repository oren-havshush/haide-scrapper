// pandoor / דלתות פנדור, Civi board 2AAQQ8EBCH/4091 (Civi is the vendor), listing only. Whole board (&p=1&r=300) vs its
// "N משרות", then each job page. Fetches: credentials omit, 20 s each, 3 at a time 200 ms apart. ALL-OR-NOTHING: any
// failed/slow/non-2xx/unreadable answer -> no jobs. &fallback=1 = closed, that card only. Never-opened page: ONE
// openPromo POST (a visitor's click; Civi exception, LRN-SPA-22), then re-read. Id pandoor-<printed public id>.
// Location (owner 2026-10-21, no city tags read): title tail after the last dash, ' ב<place>' and 'אזור <region>' in the
// title, cue lines, showroom 'דיזיין סנטר' = סניף בני ברק (pandoor.co.il/showrooms), a route line 'בין מחסני/אתרי החברה
// X/Y' (each place emitted AS PRINTED, mapped by locationMap; owner 2026-10-21); closed table of city.csv rows; labels mapped by the config's
// locationMap; no cue -> Unknown. Apply: the job page's Civi form, fields per job; 540578 has a required privacy box
// (not pre-checked). No captcha.
var SRC = '4091', BOARD = 'https://app.civi.co.il/promos/id=2AAQQ8EBCH&src=' + SRC;
var T0 = Date.now(), STOP_MS = 75000, NL = String.fromCharCode(10);
var MQ = String.fromCharCode(0x5BE), GS = String.fromCharCode(0x5F4), NBSP = new RegExp(String.fromCharCode(0xA0), 'g');
var parse = function (t) { return new DOMParser().parseFromString(t, 'text/html'); };
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var mk = function (cls, val) { var s = document.createElement('span'); s.className = cls; s.style.display = 'none'; s.textContent = val; return s; };
var idOf = function (el) { var tc = el.querySelector('.thumb-content'); var m = tc && (tc.getAttribute('onclick') || '').match(/openPromo\(event,(\d+),(\d+)/); return m ? m[1] : null; };
var dead = false;
var get = async function (u, opt) {
if (dead) throw new Error('stopped after a failure');
if (Date.now() - T0 > STOP_MS) throw new Error('time budget spent');
var ac = new AbortController(), timer = setTimeout(function () { ac.abort(); }, 20000);
try {
var o = { credentials: 'omit', cache: 'no-store', signal: ac.signal };
if (opt) for (var k in opt) o[k] = opt[k];
var r = await fetch(u, o);
if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + u);
return { url: r.url, text: await r.text() };
} finally { clearTimeout(timer); }
};
var pool = async function (arr, fn) {
var i = 0;
await Promise.all([0, 1, 2].map(async function () {
while (i < arr.length && !dead) { var x = arr[i++]; try { await fn(x); } catch (e) { dead = true; throw e; } await sleep(200); }
}));
};
// closed place table: every value is a verbatim row of CSV files/city.csv
var CANON = "נשר|עכו|ערד|צפת|רהט|אילת|אלעד|גדרה|חדרה|חורה|חיפה|חריש|יבנה|יקום|ירכא|מיתר|משהד|נצרת|שוהם|בת-ים|אכסאל|אריאל|אשדוד|חולון|טבריה|ירוחם|להבים|נהריה|נתניה|עפולה|עראבה|עתלית|קצרין|רעננה|שדרות|שפרעם|בית אל|רמת גן|אופקים|אשקלון|בית ג'אן|דימונה|הרצליה|כרמיאל|נתיבות|פרדסיה|קיסריה|רחובות|באר שבע|בית דגן|בית שאן|בית שמש|בני ברק|בני ראם|גן יבנה|כפר נטר|כפר סבא|כפר קרע|קרית גת|קרית ים|רמת ישי|תל מונד|גבעתיים|ירושלים|באר יעקב|גבעת זאב|כפר יונה|כפר תבור|נס ציונה|קרית אתא|ראש העין|אבן יהודה|אור יהודה|אור עקיבא|הוד השרון|טירת הכרמל|כוכב יאיר|מגדל העמק|נוף הגליל|פתח תקווה|קריית אונו|רמת השרון|אום אל-פחם|ביתר עילית|גבעת שמואל|זכרון יעקב|מבשרת ציון|מזכרת בתיה|קדימה צורן|קרית טבעון|קרית מלאכי|קרית עקרון|קריית שמונה|יוקנעם|מעלה אדומים|קרית ביאליק|קרית מוצקין|ראשון לציון|תל אביב-יפו|חצור הגלילית|יהוד|מעלות תרשיחא|באקה אל-גרבייה|פרדס חנה כרכור|מודיעין";
var PLACE = {};
CANON.split('|').forEach(function (c) { PLACE[c] = c; });
[['תל אביב', 'תל אביב-יפו'], ['תל-אביב', 'תל אביב-יפו'], ['תל אביב יפו', 'תל אביב-יפו'], ['תל אביב - יפו', 'תל אביב-יפו'], ['ת"א', 'תל אביב-יפו'], ['ת' + GS + 'א', 'תל אביב-יפו'],
['פתח תקוה', 'פתח תקווה'], ['פתח-תקווה', 'פתח תקווה'], ['פ"ת', 'פתח תקווה'], ['פ' + GS + 'ת', 'פתח תקווה'], ['כפר-סבא', 'כפר סבא'],
['קרית אונו', 'קריית אונו'], ['קרית שמונה', 'קריית שמונה'], ['טירת כרמל', 'טירת הכרמל'], ['בת ים', 'בת-ים'],
['קריית גת', 'קרית גת'], ['ראשל"צ', 'ראשון לציון'], ['ראשל' + GS + 'צ', 'ראשון לציון'], ['זיכרון יעקב', 'זכרון יעקב']].forEach(function (p) { PLACE[p[0]] = p[1]; });
var KEYS = Object.keys(PLACE).sort(function (a, b) { return b.length - a.length; });
var LETTER = /\p{L}/u;
// the place a string STARTS with (after an optional ב and hyphen/maqaf), whole words only; rest = what follows it
var placeAt = function (s, whole) {
s = s.replace(/^\s+/, '');
var tries = [s, s.replace(new RegExp('^ב[-' + MQ + ']?\\s*'), '')];
for (var t = 0; t < tries.length; t++) for (var k = 0; k < KEYS.length; k++) {
var key = KEYS[k], rest = tries[t].slice(key.length);
if (tries[t].indexOf(key) === 0 && !LETTER.test(rest.charAt(0) || '') && (!whole || !rest.trim())) return PLACE[key];
}
return null;
};
var add = function (out, p) { if (p && out.indexOf(p) < 0) out.push(p); };
var REGION = { 'מרכז': 'אזור מרכז', 'המרכז': 'אזור מרכז', 'צפון': 'אזור צפון', 'הצפון': 'אזור צפון', 'דרום': 'אזור דרום', 'הדרום': 'אזור דרום', 'שרון': 'אזור השרון', 'השרון': 'אזור השרון', 'שפלה': 'אזור שפלה', 'השפלה': 'אזור שפלה' };
var SHOWROOM = [['דיזיין סנטר', 'בני ברק']];
var ROUTE_CUE = /בין\s+(?:מחסני|אתרי|מפעלי|סניפי|משרדי)\s+החברה\s+(.+)$/u;
var CUE = new RegExp('(?:^|[\\s(,])(?:לאתר|באתר|למפעל|במפעל|לסניף|בסניף|למשרדי|במשרדי|למשרדינו|במשרדינו|משרה(?:\\s+מלאה|\\s+חלקית)?|המשרה|העבודה|הממוקמ(?:ת|ים|ות)?)\\s+(?:ש(?=ב))?(?=ב)', 'gu');
var locate = function (title, text) {
var out = [], segs = title.split(/\s*[-–]\s+|\s+[-–]\s*|–/), tail = segs.length > 1 ? segs[segs.length - 1].split('/') : [];
var tp = tail.map(function (p) { return placeAt(p, true); });
if (tp.length && tp.every(Boolean)) tp.forEach(function (p) { add(out, p); });
var re = new RegExp('(?:^|[\\s(,])ב[-' + MQ + ']?(?=\\p{L})', 'gu'), mt;
while ((mt = re.exec(title))) add(out, placeAt(title.slice(mt.index + mt[0].length)));
var rg = title.match(/(?:^|\s)ב?אזור\s+(\p{L}+)/u);
if (rg && REGION[rg[1]]) add(out, REGION[rg[1]]);
text.split(NL).forEach(function (l) {
var m = l.match(/^[^\p{L}]*(?:מיקום(?: המשרה| העבודה)?|מקום העבודה)\s*[:\-–]\s*(.+)$/u);
if (m) m[1].split(/[,\/|]|\s+ו(?=\p{L})/u).forEach(function (part) { add(out, placeAt(part)); });
var c;
var rc = l.match(ROUTE_CUE);
if (rc) rc[1].split(/\s*[\/,]\s*|\s+ו?ל(?=\p{L})|\s+ו(?=\p{L})/u).forEach(function (part) { part = part.trim(); if (placeAt(part, true)) add(out, part); });
CUE.lastIndex = 0;
while ((c = CUE.exec(l))) add(out, placeAt(l.slice(c.index + c[0].length)));
});
SHOWROOM.forEach(function (s) { if ((title + NL + text).indexOf(s[0]) >= 0) add(out, s[1]); });
return out;
};
// body rules: a label that only says "description" is dropped; a standalone requirements heading opens requirements
// (in the description, its block moves to requirements; at the top of requirements the label is dropped); the pay
// block, a full/part-time hours line and the equal-opportunity line printed under the requirements go to description
var HEAD_DESC = /^[^\p{L}]*(?:תיאור (?:ה)?משרה|תיאור (?:ה)?תפקיד|הגדרת (?:ה)?תפקיד)\s*[:\-–]?\s*$/u;
var HEAD_REQ = /^[^\p{L}]*(?:דרישות(?: התפקיד| המשרה)?|מה אנחנו מחפשים|כישורים נדרשים|דרישות וכישורים)\s*[:\-–?]?\s*$/u;
var HEAD_PAY = /^[^\p{L}]*(?:שכר ותנאים נלווים|שכר ונלווים מוצעים|שכר ותנאים|תנאים נלווים|אנו מציעים|מה אנחנו מציעים)\s*[:\-–]?\s*$/u;
var EQUAL = /(?:מיועדת|פונה)\s.*כאחד/u, HOURS = /^[^\p{L}]*משרה\s+(?:מלאה|חלקית)/u;
var lines = function (s) {
return String(s || '').replace(/\r/g, '').replace(NBSP, ' ').split(NL).map(function (l) { return l.replace(/[ \t]+/g, ' ').replace(/\s+$/, '').replace(/^ /, ''); });
};
var join = function (arr) { return arr.join(NL).replace(/\n{3,}/g, NL + NL).trim(); };
var list = document.querySelector('.proflist');
if (location.pathname.indexOf('/promos/') === 0 && list && !document.querySelector('.__ai-jobid')) {
var stat = { cards: 0, read: 0, unlocked: 0, closed: 0, dropped_language: [] };
try {
var have = {}, cur = list.querySelectorAll('.thumb');
for (var i = 0; i < cur.length; i++) { var k0 = idOf(cur[i]); if (k0) have[k0] = 1; }
var all = parse((await get(BOARD + '&p=1&r=300')).text);
var rows = all.querySelectorAll('.proflist .thumb');
if (!rows.length) throw new Error('the full board returned no card');
for (var q = 0; q < rows.length; q++) { var k = idOf(rows[q]); if (k && !have[k]) { have[k] = 1; list.appendChild(document.importNode(rows[q], true)); } }
var ids = Object.keys(have);
var loc = all.querySelector('.page-locator') || document.querySelector('.page-locator');
var tm = loc && (loc.textContent || '').match(/(\d+)\s*משרות/);
if (!tm || +tm[1] !== ids.length) throw new Error('board says ' + (tm ? tm[1] : '?') + ' jobs, read ' + ids.length);
stat.cards = ids.length;
var OK = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}]/u, BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var items = [].filter.call(list.querySelectorAll('.thumb'), function (it) {
var tt = ((it.querySelector('.title') || {}).textContent || '').trim();
if (!idOf(it)) { it.remove(); return false; }
if (!OK.test(tt) || BAD.test(tt)) { stat.dropped_language.push(idOf(it)); it.remove(); return false; }
return true;
});
var readPage = async function (u) { var g = await get(u); return { d: parse(g.text), url: g.url }; };
await pool(items, async function (it) {
var id = idOf(it), u = 'https://app.civi.co.il/promo/id=' + id + '&src=' + SRC;
var pg = await readPage(u), opened = false;
if (!pg.d.querySelector('#je-descr') && pg.url.indexOf('fallback=1') < 0) {
opened = true;
await get(BOARD, { method: 'POST', headers: { 'Content-type': 'application/x-www-form-urlencoded' },
body: 'randStrToPreventCache=' + Math.round(Math.random() * 1e10) + '&command=openPromo&job_public_id=' + id + '&source_id=' + SRC + '&button=1' });
await sleep(400);
pg = await readPage(u);
if (!pg.d.querySelector('#je-descr')) { await sleep(1500); pg = await readPage(u); }
}
if (pg.url.indexOf('fallback=1') >= 0 && !pg.d.querySelector('#je-descr')) { stat.closed++; it.remove(); return; }
var d = pg.d, de = d.querySelector('#je-descr');
if (!de || !de.textContent.trim()) throw new Error('job page ' + id + ' unreadable (' + pg.url + ')');
if (opened) stat.unlocked++;
stat.read++;
var title = ((d.querySelector('#je-title') || it.querySelector('.title') || {}).textContent || '').replace(/\s+/g, ' ').trim();
if (!title) throw new Error('job ' + id + ' has no title');
var dl = lines(de.textContent), detEl = d.querySelector('#je-details');
var rl = detEl && detEl.textContent.trim() ? lines(detEl.textContent) : [];
for (var h = 0; h < dl.length; h++) if (HEAD_REQ.test(dl[h])) { rl = dl.slice(h).concat([''], rl); dl = dl.slice(0, h); break; }
while (rl.length && !rl[0].trim()) rl.shift();
if (rl.length && HEAD_REQ.test(rl[0])) rl.shift();
var tail = [];
for (var p = 0; p < rl.length; p++) if (HEAD_PAY.test(rl[p])) { tail = rl.slice(p); rl = rl.slice(0, p); break; }
var mv = rl.filter(function (l) { return EQUAL.test(l) || HOURS.test(l); });
rl = rl.filter(function (l) { return !(EQUAL.test(l) || HOURS.test(l)); });
dl = dl.filter(function (l) { return !HEAD_DESC.test(l); });
var dOut = join(dl.concat(tail.length ? [''] : [], tail, mv.length ? [''] : [], mv)), rOut = join(rl);
var txt = locate(title, lines(de.textContent).join(NL) + NL + (detEl ? lines(detEl.textContent).join(NL) : ''));
var out = txt;
it.appendChild(mk('__ai-title', title));
it.appendChild(mk('__ai-description', dOut));
if (rOut) it.appendChild(mk('__ai-requirements', rOut));
if (out.length) it.appendChild(mk('__ai-location', out.join(' | ')));
var form = d.querySelector('form.Form');
if (!form) throw new Error('job ' + id + ' has no apply form');
var fl = [{ name: 'Form_submitted', label: '', tagName: 'INPUT', required: false, fieldType: 'hidden', value: '1' }];
[].forEach.call(form.querySelectorAll('.field[data-id]'), function (f) {
var lb = f.querySelector('.label') || f.querySelector('label'), cb = f.querySelector('input[type=checkbox]'), fi = f.querySelector('input[type=file]'), nx = f.nextElementSibling;
var ip = cb || f.querySelector('input:not([type=file]):not([type=hidden]),textarea,select');
var rec = { name: f.getAttribute('data-id'), label: lb ? (lb.textContent + (cb && nx && nx.tagName === 'A' ? ' ' + nx.textContent : '')).replace(/[*]|\s*:\s*$/g, '').replace(/\s+/g, ' ').trim() : '',
tagName: ip ? ip.tagName : 'INPUT', required: !!f.querySelector('.required'), fieldType: fi ? 'file' : ip ? (ip.getAttribute('type') || ip.tagName.toLowerCase()) : 'text' };
if (fi && fi.getAttribute('accept')) rec.accept = fi.getAttribute('accept');
if (cb) rec.value = cb.value;
fl.push(rec);
});
if (fl.length < 2) throw new Error('job ' + id + ' form has no field');
it.appendChild(mk('__ai-applicationInfo', JSON.stringify({ actionUrl: u, method: 'POST', enctype: 'multipart/form-data', fields: fl })));
it.appendChild(mk('__ai-jobid', 'pandoor-' + id));
var a = document.createElement('a'); a.className = '__ai-detailurl'; a.href = u; it.appendChild(a);
});
if (!list.querySelector('.thumb .__ai-jobid')) throw new Error('no open job on the board');
} catch (e) {
dead = true;
console.warn('[pandoor] ' + (e && e.name === 'AbortError' ? 'fetch timed out' : e) + ' -> no items');
[].forEach.call(list.querySelectorAll('.thumb'), function (it) { it.remove(); });
stat.failed = String(e);
}
[].forEach.call(list.querySelectorAll('.thumb'), function (it) { if (!it.querySelector('.__ai-jobid') || !it.querySelector('.__ai-applicationInfo')) it.remove(); });
list.setAttribute('data-ai-stat', JSON.stringify(stat) + ' ' + (Date.now() - T0) + 'ms');
}
