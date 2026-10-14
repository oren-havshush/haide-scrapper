// siel (Civi board VJEZQHAV5J/10963), listing only. All cards in one request (&r=300); city tags from the
// board's own "ישוב המשרה" filter, one request per city; requirements and the apply form from each job page.
// A job page nobody has opened yet redirects to "הדף אינו קיים": one POST openPromo (what a visitor's click
// sends) opens it, then it is read again. Requests are paced (3 at a time, 200 ms apart) and stop at 150 s.
var SRC = '10963', BOARD = 'https://app.civi.co.il/promos/id=VJEZQHAV5J&src=' + SRC;
var CITIES = ["ירושלים","תל אביב - יפו","חיפה","באר שבע","אילת","אשדוד","אשקלון","הרצליה","חדרה","חולון","כפר סבא","נצרת","נתניה","פתח תקווה","ראשון לציון","רחובות","רמת גן","אבן יהודה","אום אל-פחם","אופקים","אור יהודה","אור עקיבא","אכסאל","אריאל","באקה אל-גרביה","באר יעקב","בית אל","בית שאן","בית שמש","ביתר עילית","בני ברק","בת ים","גבעת זאב","גבעת שמואל","גבעתיים","גדרה","גן יבנה","דאלית אל-כרמל","דימונה","הוד השרון","זכרון יעקב","חורה","חצור הגלילית","טבריה","טירת כרמל","יבנה","יהוד-מונוסון","ירוחם","ירכא","כוכב יאיר","כפר יונה","כפר קרע","כפר תבור","כרמיאל","להבים","לוד","מבשרת ציון","מגדל העמק","מודיעין-מכבים-רעות","מזכרת בתיה","מיתר","מעלה אדומים","מעלות-תרשיחא","משהד","נהריה","נוף הגליל","נס ציונה","נשר","נתיבות","עומר","עכו","עפולה","עראבה","ערד","עתלית","פרדס חנה-כרכור","פרדסיה","צפת","קדימה-צורן","קיסריה","קצרין","קרית אונו","קרית אתא","קרית ביאליק","קרית גת","קרית טבעון","קרית ים","קרית מוצקין","קרית מלאכי","קרית עקרון","קרית שמונה","ראש העין","רהט","רמלה","רמת השרון","רמת ישי","רעננה","שדרות","שוהם","שפרעם","תל מונד","כפר נטר","אזור","בני ראם","בית דגן","חריש","יקום","אלעד","בית ג'ן","יקנעם עילית","כעביה-טבאש-חג'אג'רה"], SENT = ["תרום","אבטין"];
var T0 = Date.now(), STOP_MS = 150000;
var parse = function (t) { return new DOMParser().parseFromString(t, 'text/html'); };
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var mk = function (cls, val) { var s = document.createElement('span'); s.className = cls; s.textContent = val; return s; };
var idOf = function (el) { var tc = el.querySelector('.thumb-content'); var m = tc && (tc.getAttribute('onclick') || '').match(/openPromo\(event,(\d+),(\d+)/); return m ? m[1] : null; };
var pool = async function (arr, fn) { var i = 0; await Promise.all([0, 1, 2].map(async function () { while (i < arr.length && Date.now() - T0 < STOP_MS) { var x = arr[i++]; try { await fn(x); } catch (e) { } await sleep(200); } })); };
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
  // city tags
  var tags = {}, sent = {};
  await pool(CITIES.concat(SENT), async function (c) {
    var t = await (await fetch(BOARD + '&p=1&r=300&f=' + encodeURIComponent('promocity,' + c))).text();
    var ids = {}, m, re = /openPromo\(event,(\d+),/g;
    while ((m = re.exec(t))) ids[m[1]] = 1;
    Object.keys(ids).forEach(function (id) {
      if (SENT.indexOf(c) >= 0) sent[id] = (sent[id] || 0) + 1; else (tags[id] = tags[id] || []).push(c);
    });
  });
  // job pages
  var stat = { read: 0, unlocked: 0, locked: 0, unread: 0 };
  var readPage = async function (u) { return parse(await (await fetch(u, { cache: 'no-store' })).text()); };
  await pool(items, async function (it) {
    var id = idOf(it), u = 'https://app.civi.co.il/promo/id=' + id + '&src=' + SRC;
    var d = await readPage(u);
    if (!d.querySelector('#je-descr')) {
      await fetch(BOARD, { method: 'POST', headers: { 'Content-type': 'application/x-www-form-urlencoded' },
        body: 'randStrToPreventCache=' + Math.round(Math.random() * 1e10) + '&command=openPromo&job_public_id=' + id + '&source_id=' + SRC + '&button=1' });
      await sleep(400);
      d = await readPage(u);
      if (!d.querySelector('#je-descr')) { stat.locked++; it.setAttribute('data-ai-page', 'locked'); return; }
      stat.unlocked++; it.setAttribute('data-ai-page', 'unlocked');
    }
    stat.read++;
    var req = d.querySelector('#je-details');
    if (req && req.textContent.trim()) { var box = document.createElement('div'); box.className = '__ai-requirements'; box.style.display = 'none'; box.innerHTML = req.innerHTML; it.appendChild(box); }
    var form = d.querySelector('form.Form');
    if (form) {
      var fl = [{ name: 'Form_submitted', label: '', tagName: 'INPUT', required: false, fieldType: 'hidden' }];
      [].forEach.call(form.querySelectorAll('.field[data-id]'), function (f) {
        var lb = f.querySelector('.label'), ip = f.querySelector('input,textarea,select');
        fl.push({ name: f.getAttribute('data-id'), label: lb ? lb.textContent.replace(/[*]|\s*:\s*$/g, '').replace(/\s+/g, ' ').trim() : '',
          tagName: ip ? ip.tagName : 'INPUT', required: !!(lb && lb.querySelector('.required')), fieldType: ip ? (ip.getAttribute('type') || ip.tagName.toLowerCase()) : 'text' });
      });
      it.appendChild(mk('__ai-applicationInfo', JSON.stringify({ actionUrl: u, method: 'POST', fields: fl })));
    }
  });
  for (var j = 0; j < items.length; j++) {
    var it = items[j], id = idOf(it);
    if (!it.hasAttribute('data-ai-page') && !it.querySelector('.__ai-applicationInfo')) stat.unread++;
    it.appendChild(mk('__ai-jobid', 'siel-' + id));
    // a job tagged with every city carries both sentinels; CITIES order keeps the list stable night to night
    var loc = sent[id] === SENT.length ? 'כל הארץ' : (tags[id] || []).sort(function (a, b) { return CITIES.indexOf(a) - CITIES.indexOf(b); }).join(' | ');
    if (loc) it.appendChild(mk('__ai-location', loc));
    var a = document.createElement('a'); a.className = '__ai-detailurl'; a.href = 'https://app.civi.co.il/promo/id=' + id + '&src=' + SRC; it.appendChild(a);
  }
  list.setAttribute('data-ai-stat', JSON.stringify(stat) + ' ' + (Date.now() - T0) + 'ms');
}
