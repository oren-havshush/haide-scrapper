// or-ganize (Civi board N42BXPBXDG/8958), listing only. All cards in one request (&r=300); requirements and the
// apply form from each job page. A job page nobody has opened yet redirects to "?ERROR 404": one POST openPromo
// (what a visitor's click sends) opens it, then it is read again. A page still locked after two tries leaves the
// job out of this run (no job ships without its requirements); a page that falls back to the board is a closed job.
// The board carries no city tags; the place comes only from work-location cue lines, through a closed table.
var SRC = '8958', BOARD = 'https://app.civi.co.il/promos/id=N42BXPBXDG&src=' + SRC;
var T0 = Date.now(), STOP_MS = 75000;
var MQ = String.fromCharCode(0x5BE), GS = String.fromCharCode(0x5F4);
var parse = function (t) { return new DOMParser().parseFromString(t, 'text/html'); };
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var mk = function (cls, val) { var s = document.createElement('span'); s.className = cls; s.style.display = 'none'; s.textContent = val; return s; };
var idOf = function (el) { var tc = el.querySelector('.thumb-content'); var m = tc && (tc.getAttribute('onclick') || '').match(/openPromo\(event,(\d+),(\d+)/); return m ? m[1] : null; };
var pool = async function (arr, fn) { var i = 0; await Promise.all([0, 1, 2].map(async function () { while (i < arr.length && Date.now() - T0 < STOP_MS) { var x = arr[i++]; try { await fn(x); } catch (e) { } await sleep(200); } })); };
// closed place table: every value is a verbatim row of CSV files/city.csv
var CANON = "נשר|עכו|ערד|צפת|רהט|אילת|אלעד|גדרה|חדרה|חורה|חיפה|חריש|יבנה|יקום|ירכא|מיתר|משהד|נצרת|שוהם|בת-ים|אכסאל|אריאל|אשדוד|חולון|טבריה|ירוחם|להבים|נהריה|נתניה|עפולה|עראבה|עתלית|קצרין|רעננה|שדרות|שפרעם|בית אל|רמת גן|אופקים|אשקלון|בית ג'אן|דימונה|הרצליה|כרמיאל|נתיבות|פרדסיה|קיסריה|רחובות|באר שבע|בית דגן|בית שאן|בית שמש|בני ברק|בני ראם|גן יבנה|כפר נטר|כפר סבא|כפר קרע|קרית גת|קרית ים|רמת ישי|תל מונד|גבעתיים|ירושלים|באר יעקב|גבעת זאב|כפר יונה|כפר תבור|נס ציונה|קרית אתא|ראש העין|אבן יהודה|אור יהודה|אור עקיבא|הוד השרון|טירת הכרמל|כוכב יאיר|מגדל העמק|נוף הגליל|פתח תקווה|קריית אונו|רמת השרון|אום אל-פחם|ביתר עילית|גבעת שמואל|זכרון יעקב|מבשרת ציון|מזכרת בתיה|קדימה צורן|קרית טבעון|קרית מלאכי|קרית עקרון|קריית שמונה|יוקנעם|מעלה אדומים|קרית ביאליק|קרית מוצקין|ראשון לציון|תל אביב-יפו|חצור הגלילית|יהוד|מעלות תרשיחא|באקה אל-גרבייה|פרדס חנה כרכור|מודיעין";
var PLACE = {};
CANON.split('|').forEach(function (c) { PLACE[c] = c; });
[['תל אביב', 'תל אביב-יפו'], ['תל-אביב', 'תל אביב-יפו'], ['תל אביב יפו', 'תל אביב-יפו'], ['תל אביב - יפו', 'תל אביב-יפו'], ['ת"א', 'תל אביב-יפו'], ['ת' + GS + 'א', 'תל אביב-יפו'],
 ['פתח תקוה', 'פתח תקווה'], ['קרית אונו', 'קריית אונו'], ['קרית שמונה', 'קריית שמונה'], ['טירת כרמל', 'טירת הכרמל'], ['בת ים', 'בת-ים'],
 ['אזור המרכז', 'אזור מרכז'], ['אזור מרכז', 'אזור מרכז'], ['מרכז הארץ', 'אזור מרכז'], ['אזור השרון', 'אזור השרון'], ['אזור הצפון', 'אזור צפון'], ['צפון הארץ', 'אזור צפון'],
 ['אזור הדרום', 'אזור דרום'], ['דרום הארץ', 'אזור דרום'], ['אזור השפלה', 'אזור שפלה'],
 // owner 2026-10-14: the bare town name "קדימה" is the row "קדימה צורן" (whole word, only after a cue: a מיקום line, הממוקמת ב, or a ב prefix)
 ['קדימה', 'קדימה צורן'], ['קדימה-צורן', 'קדימה צורן'], ['קדימה - צורן', 'קדימה צורן']].forEach(function (p) { PLACE[p[0]] = p[1]; });
var KEYS = Object.keys(PLACE).sort(function (a, b) { return b.length - a.length; });
var LETTER = /[\p{L}]/u;
// the place a string STARTS with (after an optional ב/ל and hyphen), whole words only
var placeAt = function (s) {
  s = s.replace(/^\s+/, '');
  var tries = [s, s.replace(new RegExp('^[בל][-' + MQ + ']?\\s*'), '')];
  for (var t = 0; t < tries.length; t++) for (var k = 0; k < KEYS.length; k++) {
    var key = KEYS[k];
    if (tries[t].indexOf(key) === 0 && !LETTER.test(tries[t].charAt(key.length) || '')) return PLACE[key];
  }
  return null;
};
// every " ב<place>" inside a string
var placesIn = function (s, out) {
  var re = new RegExp('(?:^|[\\s(,])ב[-' + MQ + ']?(?=\\p{L})', 'gu'), m;
  while ((m = re.exec(s))) { var p = placeAt(s.slice(m.index + m[0].length)); if (p && out.indexOf(p) < 0) out.push(p); }
};
var locate = function (title, text) {
  var out = [], lines = text.split('\n');
  // (a) a "מיקום:" line
  lines.forEach(function (l) {
    var m = l.match(/^[^\p{L}]*מיקום(?: המשרה| העבודה)?\s*[:\-–]\s*(.+)$/u);
    // owner 2026-10-14 (inference): "תא" read as Tel Aviv ONLY when it is the whole value of a מיקום line
    if (m && m[1].replace(/[\s.]+$/, '') === 'תא') { if (out.indexOf('תל אביב-יפו') < 0) out.push('תל אביב-יפו'); return; }
    if (m) m[1].split(/[,\/|]|\s+ו(?=\p{L})/u).forEach(function (part) { var p = placeAt(part); if (p && out.indexOf(p) < 0) out.push(p); });
  });
  // field work: the company's town is not the place of work
  if (/מכירות שטח|עבודת שטח|עבודה בשטח/.test(title + '\n' + text)) return out;
  // (b) "הממוקמת ב<place>"
  var rb = new RegExp('הממוקמ(?:ת|ים|ות)?\\s+ב[-' + MQ + ']?\\s*', 'gu'), mb;
  while ((mb = rb.exec(text))) { var pb = placeAt(text.slice(mb.index + mb[0].length)); if (pb && out.indexOf(pb) < 0) out.push(pb); }
  // (c) "לחברת/לקבוצת/למשרד … ב<place>" in the same sentence
  text.split(/[\n.!?]/).forEach(function (sn) {
    var m = sn.match(/(?:^|\s)ל(?:חברת|חברה|קבוצת|משרד|רשת|ארגון|מפעל)(?=\s)/u);
    if (m) placesIn(sn.slice(m.index), out);
  });
  // (d) the title: " ב<place>" or a " - <place>" tail
  placesIn(title, out);
  var mt = title.match(/\s[-–]\s*([^-–]+?)[.\s]*$/u);
  if (mt) { var pt = placeAt(mt[1]); if (pt && out.indexOf(pt) < 0) out.push(pt); }
  return out;
};
var HEAD_REQ = /^[^\p{L}]*(?:דרישות(?: התפקיד| המשרה)?|מה אנחנו מחפשים|כישורים נדרשים|דרישות וכישורים)\s*[:\-–?]?\s*$/u;
var HEAD_DESC = /^[^\p{L}]*(?:תיאור התפקיד|תיאור המשרה)\s*[:\-–]?\s*$/u;
var TERMS = /^(?:מיקום|שעות|היקף משרה|משרה מלאה|משרה חלקית|ומה מחכה|מה מחכה|מה אנחנו מציעים|אם את|שכר|ציפיות השכר|ניתן לשקול העסקה|תנאים)/u;
var EMPTY_BULLET = /^[\s•●▪*\-–✔️]*$/u;
var clean = function (arr) {
  return arr.filter(function (l) { return !(l.trim() && EMPTY_BULLET.test(l)) && !HEAD_DESC.test(l); }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
};
var list = document.querySelector('.proflist');
if (location.pathname.indexOf('/promos/') === 0 && list && !document.querySelector('.__ai-jobid')) {
  var have = {}, cur = list.querySelectorAll('.thumb');
  for (var i = 0; i < cur.length; i++) { var k0 = idOf(cur[i]); if (k0) have[k0] = 1; }
  try {
    var rows = parse(await (await fetch(BOARD + '&p=1&r=300')).text()).querySelectorAll('.proflist .thumb');
    for (var q = 0; q < rows.length; q++) { var k = idOf(rows[q]); if (k && !have[k]) { have[k] = 1; list.appendChild(document.importNode(rows[q], true)); } }
  } catch (e) { }
  // fallback: walk &p=N, stop when a page adds nothing (past the end it re-serves the last page)
  if (list.querySelectorAll('.thumb').length % 20 === 0) {
    for (var p = 2; p <= 40; p++) {
      var added = 0;
      try {
        var pr = parse(await (await fetch(BOARD + '&p=' + p)).text()).querySelectorAll('.proflist .thumb');
        for (var r = 0; r < pr.length; r++) { var k2 = idOf(pr[r]); if (k2 && !have[k2]) { have[k2] = 1; list.appendChild(document.importNode(pr[r], true)); added++; } }
      } catch (e) { }
      if (!added) break;
    }
  }
  var HEB_LAT = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, OTHER = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
  var items = [].filter.call(list.querySelectorAll('.thumb'), function (it) {
    var tt = (it.querySelector('.title') || {}).textContent || '';
    if (!idOf(it) || !HEB_LAT.test(tt) || OTHER.test(tt)) { it.remove(); return false; }
    return true;
  });
  var stat = { read: 0, unlocked: 0, locked: 0, closed: 0 };
  var readPage = async function (u) { var r = await fetch(u, { cache: 'no-store' }); return { d: parse(await r.text()), url: r.url }; };
  var openIt = async function (id) {
    await fetch(BOARD, { method: 'POST', headers: { 'Content-type': 'application/x-www-form-urlencoded' },
      body: 'randStrToPreventCache=' + Math.round(Math.random() * 1e10) + '&command=openPromo&job_public_id=' + id + '&source_id=' + SRC + '&button=1' });
  };
  await pool(items, async function (it) {
    var id = idOf(it), u = 'https://app.civi.co.il/promo/id=' + id + '&src=' + SRC;
    var pg = await readPage(u), tries = 0;
    while (!pg.d.querySelector('#je-descr') && pg.url.indexOf('fallback=1') < 0 && tries < 2) {
      tries++; await openIt(id); await sleep(tries === 1 ? 400 : 1500); pg = await readPage(u);
    }
    if (pg.url.indexOf('fallback=1') >= 0 && !pg.d.querySelector('#je-descr')) { stat.closed++; it.setAttribute('data-ai-page', 'closed'); return; }
    if (!pg.d.querySelector('#je-descr')) { stat.locked++; it.setAttribute('data-ai-page', 'locked'); return; }
    if (tries) stat.unlocked++;
    stat.read++;
    var d = pg.d, title = (d.querySelector('#je-title') || it.querySelector('.title')).textContent.trim();
    var descr = ((it.querySelector('.descr') || {}).textContent || d.querySelector('#je-descr').textContent || '').replace(/\r/g, '');
    var det = ((d.querySelector('#je-details') || {}).textContent || '').replace(/\r/g, '');
    var dl = descr.split('\n'), rl = [];
    if (det.trim()) rl = det.split('\n');
    else for (var h = 0; h < dl.length; h++) if (HEAD_REQ.test(dl[h])) { rl = dl.slice(h); dl = dl.slice(0, h); break; }
    while (rl.length && !rl[0].trim()) rl.shift();
    if (rl.length && HEAD_REQ.test(rl[0])) rl.shift();
    var tail = [];
    for (var x = 0; x < rl.length; x++) if (TERMS.test(rl[x].replace(/^[^\p{L}\p{N}]+/u, ''))) { tail = rl.slice(x); rl = rl.slice(0, x); break; }
    var dOut = clean(dl.concat([''], tail)), rOut = clean(rl);
    var loc = locate(title, descr + '\n' + det);
    it.setAttribute('data-ai-page', tries ? 'unlocked' : 'read');
    it.appendChild(mk('__ai-title', title));
    it.appendChild(mk('__ai-description', dOut));
    if (rOut) it.appendChild(mk('__ai-requirements', rOut));
    it.appendChild(mk('__ai-location', loc.length ? loc.join(', ') : 'Unknown'));
    var form = d.querySelector('form.Form');
    if (form) {
      var fl = [{ name: 'Form_submitted', label: '', tagName: 'INPUT', required: false, fieldType: 'hidden' }];
      [].forEach.call(form.querySelectorAll('.field[data-id]'), function (f) {
        var lb = f.querySelector('.label'), ip = f.querySelector('input:not([type=file]),textarea,select');
        fl.push({ name: f.getAttribute('data-id'), label: lb ? lb.textContent.replace(/[*]|\s*:\s*$/g, '').replace(/\s+/g, ' ').trim() : '',
          tagName: ip ? ip.tagName : 'INPUT', required: !!(lb && lb.querySelector('.required')), fieldType: f.classList.contains('file') ? 'file' : ip ? (ip.getAttribute('type') || ip.tagName.toLowerCase()) : 'text' });
      });
      it.appendChild(mk('__ai-applicationInfo', JSON.stringify({ actionUrl: u, method: 'POST', fields: fl })));
    }
    it.appendChild(mk('__ai-jobid', 'or-ganize-' + id));
    var a = document.createElement('a'); a.className = '__ai-detailurl'; a.href = u; it.appendChild(a);
  });
  // a job whose page could not be read this run is left out rather than shipped without its requirements
  items.forEach(function (it) { if (!it.querySelector('.__ai-jobid')) it.remove(); });
  list.setAttribute('data-ai-stat', JSON.stringify(stat) + ' ' + (Date.now() - T0) + 'ms');
}
