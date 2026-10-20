// benatav / בנטב (Civi board UZETVNCR6Q/9559; the employer is Benatav Ltd., Civi is the vendor), listing only.
// All cards in one request (&r=300), checked against the board's own "N משרות" count; then each job page for its
// title, description (#je-descr), requirements (#je-details) and its own apply form.
// Fetches: credentials 'omit' (no session cookie), 20 s limit on each, 3 at a time 200 ms apart (LRN-WAF-10).
// ALL-OR-NOTHING: a failed, slow, non-2xx, redirected or unreadable answer anywhere removes every card (no jobs this
// run) rather than publishing a partial set. Exceptions: a job page that redirects to the board with &fallback=1 is a
// closed job (LRN-SPA-26) and only that card is dropped (all of them closed = failure); a job page nobody has opened
// yet (no #je-descr) gets ONE openPromo POST, what a visitor's click sends (Civi exception, LRN-SPA-22, Shay
// 2026-10-14), and is read again; still unreadable -> failure.
// Id: the Civi public id (openPromo's first argument = the page's printed "(n)") as benatav-<n>.
// Location: work-location cue lines only ("לאתר שב<place>", "משרה מלאה ב<place>", a מיקום line, "הממוקמת ב",
// " ב<place>" in the title), through a closed table of verbatim city.csv rows; no cue -> NO_PLACE.
// Apply: the job page's own Civi form (multipart POST to the job's own page; CV uploaded first by the page's script),
// fields read per job; no captcha, no consent box.
var SRC = '9559', BOARD = 'https://app.civi.co.il/promos/id=UZETVNCR6Q&src=' + SRC;
var NO_PLACE = 'Unknown'; // owner question (card 10): LRN-LOC-20 fallback for an ad that names no place
var T0 = Date.now(), STOP_MS = 75000, NL = String.fromCharCode(10);
var MQ = String.fromCharCode(0x5BE), GS = String.fromCharCode(0x5F4), NBSP = new RegExp(String.fromCharCode(0xA0), 'g');
var parse = function (t) { return new DOMParser().parseFromString(t, 'text/html'); };
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var mk = function (cls, val) { var s = document.createElement('span'); s.className = cls; s.style.display = 'none'; s.textContent = val; return s; };
var idOf = function (el) { var tc = el.querySelector('.thumb-content'); var m = tc && (tc.getAttribute('onclick') || '').match(/openPromo\(event,(\d+),(\d+)/); return m ? m[1] : null; };
var get = async function (u, opt) {
  if (dead) throw new Error('stopped after a failure');
  if (Date.now() - T0 > STOP_MS) throw new Error('time budget spent');
  var ac = new AbortController(), timer = setTimeout(function () { ac.abort(); }, 20000);
  try {
    var o = { credentials: 'omit', cache: 'no-store', signal: ac.signal };
    if (opt) for (var k in opt) o[k] = opt[k];
    var r = await fetch(u, o);
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + u);
    return { url: r.url, redirected: r.redirected, text: await r.text() };
  } finally { clearTimeout(timer); }
};
var dead = false; // set on the first failure: the other two lanes stop taking jobs
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
 ['פתח תקוה', 'פתח תקווה'], ['פתח-תקווה', 'פתח תקווה'], ['פתח-תקוה', 'פתח תקווה'], ['פ"ת', 'פתח תקווה'], ['פ' + GS + 'ת', 'פתח תקווה'],
 ['כפר-סבא', 'כפר סבא'], ['כ"ס', 'כפר סבא'], ['כ' + GS + 'ס', 'כפר סבא'],
 ['קרית אונו', 'קריית אונו'], ['קרית שמונה', 'קריית שמונה'], ['טירת כרמל', 'טירת הכרמל'], ['בת ים', 'בת-ים']].forEach(function (p) { PLACE[p[0]] = p[1]; });
var KEYS = Object.keys(PLACE).sort(function (a, b) { return b.length - a.length; });
var LETTER = /\p{L}/u;
// the place a string STARTS with (after an optional ב and hyphen/maqaf), whole words only
var placeAt = function (s) {
  s = s.replace(/^\s+/, '');
  var tries = [s, s.replace(new RegExp('^ב[-' + MQ + ']?\\s*'), '')];
  for (var t = 0; t < tries.length; t++) for (var k = 0; k < KEYS.length; k++) {
    var key = KEYS[k];
    if (tries[t].indexOf(key) === 0 && !LETTER.test(tries[t].charAt(key.length) || '')) return PLACE[key];
  }
  return null;
};
var add = function (out, p) { if (p && out.indexOf(p) < 0) out.push(p); };
var CUE = new RegExp('(?:^|[\\s(,])(?:לאתר|באתר|למפעל|במפעל|לסניף|בסניף|למשרדי|במשרדי|למשרדינו|במשרדינו|משרה(?:\\s+מלאה|\\s+חלקית)?|המשרה|העבודה|הממוקמ(?:ת|ים|ות)?)\\s+(?:ש(?=ב))?(?=ב)', 'gu');
var locate = function (title, text) {
  var out = [];
  text.split(NL).forEach(function (l) {
    var m = l.match(/^[^\p{L}]*(?:מיקום(?: המשרה| העבודה)?|מקום העבודה)\s*[:\-–]\s*(.+)$/u);
    if (m) m[1].split(/[,\/|]|\s+ו(?=\p{L})/u).forEach(function (part) { add(out, placeAt(part)); });
    var c;
    CUE.lastIndex = 0;
    while ((c = CUE.exec(l))) add(out, placeAt(l.slice(c.index + c[0].length)));
  });
  var re = new RegExp('(?:^|[\\s(,])ב[-' + MQ + ']?(?=\\p{L})', 'gu'), mt;
  while ((mt = re.exec(title))) add(out, placeAt(title.slice(mt.index + mt[0].length)));
  return out;
};
// body rules: labels that only say "description" are dropped; a standalone requirements heading opens requirements
// when the page has no #je-details; the equal-opportunity line printed under the requirements goes to description
var HEAD_DESC = /^[^\p{L}]*(?:תיאור (?:ה)?משרה|תיאור (?:ה)?תפקיד|הגדרת (?:ה)?תפקיד)\s*[:\-–]?\s*$/u;
var HEAD_REQ = /^[^\p{L}]*(?:דרישות(?: התפקיד| המשרה)?|מה אנחנו מחפשים|כישורים נדרשים|דרישות וכישורים)\s*[:\-–?]?\s*$/u;
var EQUAL = /(?:מיועדת|פונה)\s.*כאחד/u;
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
    if (tm && +tm[1] !== ids.length) throw new Error('board says ' + tm[1] + ' jobs, read ' + ids.length);
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
      if (!rl.length) for (var h = 0; h < dl.length; h++) if (HEAD_REQ.test(dl[h])) { rl = dl.slice(h); dl = dl.slice(0, h); break; }
      while (rl.length && !rl[0].trim()) rl.shift();
      if (rl.length && HEAD_REQ.test(rl[0])) rl.shift();
      var eq = rl.filter(function (l) { return EQUAL.test(l); });
      rl = rl.filter(function (l) { return !EQUAL.test(l); });
      dl = dl.filter(function (l) { return !HEAD_DESC.test(l); });
      var dOut = join(dl.concat(eq.length ? [''] : [], eq)), rOut = join(rl);
      var place = locate(title, lines(de.textContent).join(NL) + NL + (detEl ? lines(detEl.textContent).join(NL) : ''));
      it.appendChild(mk('__ai-title', title));
      it.appendChild(mk('__ai-description', dOut));
      if (rOut) it.appendChild(mk('__ai-requirements', rOut));
      it.appendChild(mk('__ai-location', place.length ? place.join(', ') : NO_PLACE));
      var form = d.querySelector('form.Form');
      if (!form) throw new Error('job ' + id + ' has no apply form');
      var fl = [{ name: 'Form_submitted', label: '', tagName: 'INPUT', required: false, fieldType: 'hidden' }];
      [].forEach.call(form.querySelectorAll('.field[data-id]'), function (f) {
        var lb = f.querySelector('.label'), ip = f.querySelector('input:not([type=file]),textarea,select');
        fl.push({ name: f.getAttribute('data-id'), label: lb ? lb.textContent.replace(/[*]|\s*:\s*$/g, '').replace(/\s+/g, ' ').trim() : '',
          tagName: ip ? ip.tagName : 'INPUT', required: !!(lb && lb.querySelector('.required')), fieldType: f.classList.contains('file') ? 'file' : ip ? (ip.getAttribute('type') || ip.tagName.toLowerCase()) : 'text' });
      });
      it.appendChild(mk('__ai-applicationInfo', JSON.stringify({ actionUrl: u, method: 'POST', fields: fl })));
      it.appendChild(mk('__ai-jobid', 'benatav-' + id));
      var a = document.createElement('a'); a.className = '__ai-detailurl'; a.href = u; it.appendChild(a);
    });
    if (!list.querySelector('.thumb .__ai-jobid')) throw new Error('no open job on the board');
  } catch (e) {
    dead = true;
    console.warn('[benatav] ' + (e && e.name === 'AbortError' ? 'fetch timed out' : e) + ' -> no items');
    [].forEach.call(list.querySelectorAll('.thumb'), function (it) { it.remove(); });
    stat.failed = String(e);
  }
  // a card the script did not finish is never shipped half-read
  [].forEach.call(list.querySelectorAll('.thumb'), function (it) { if (!it.querySelector('.__ai-jobid')) it.remove(); });
  list.setAttribute('data-ai-stat', JSON.stringify(stat) + ' ' + (Date.now() - T0) + 'ms');
}
