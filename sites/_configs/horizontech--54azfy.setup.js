var SEL = 'section.JobsContainer .job-container';
var prev = -1, stable = 0;
for (var t = 0; t < 60; t++) {
  var n = document.querySelectorAll(SEL).length;
  if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n;
  await new Promise(function (r) { setTimeout(r, 500); });
}
var CARDS = document.querySelectorAll(SEL);
if (CARDS.length && !document.querySelector('.__ai-id')) {
  // Card area tags -> city.csv. Card wins: a listed place (title, מיקום/ממוקמ
  // line, "לארגון ממשלתי ... ב<place>" intro) replaces only a region the card has.
  var REG = {
    'area-10': ['אזור צפון'], 'area-20': ['אזור צפון'], 'area-30': ['אזור השרון'],
    'area-40': ['אזור מרכז'], 'area-50': ['אזור שפלה'],
    'area-60': ['אזור ירושלים', 'אזור יהודה ושומרון'], 'area-70': ['אזור דרום']
  };
  // Closed place list: [city.csv name, aliases, card regions it lies in].
  var PL = [
    ['ירושלים', [], [60]], ['תל אביב-יפו', ['תל אביב', 'תל-אביב', 'ת"א'], [40]],
    ['פתח תקווה', ['פתח תקוה', 'פ"ת'], [40]], ['בת-ים', ['בת ים'], [40]], ['רמת גן', ['ר"ג'], [40]],
    ['גבעתיים', [], [40]], ['בני ברק', [], [40]], ['חולון', [], [40]], ['אור יהודה', [], [40]],
    ['יהוד', [], [40]], ['ראשון לציון', ['ראשל"צ'], [40, 50]], ['הרצליה', [], [30, 40]],
    ['ראש העין', [], [30, 40]], ['נתניה', [], [30]], ['כפר סבא', ['כפ"ס'], [30]], ['רעננה', [], [30]],
    ['הוד השרון', [], [30]], ['רחובות', [], [50]], ['נס ציונה', [], [50]], ['יבנה', [], [50]],
    ['אשדוד', [], [50, 70]], ['בית שמש', [], [50, 60]], ['מעלה אדומים', [], [60]], ['אריאל', [], [60]],
    ['חיפה', [], [10, 20]], ['קרית אתא', ['קריית אתא'], [10, 20]], ['נצרת', [], [10]],
    ['נוף הגליל', [], [10]], ['עפולה', [], [10]], ['כרמיאל', [], [10]], ['בית שאן', [], [10]],
    ['באר שבע', ['ב"ש'], [70]], ['דימונה', [], [70]], ['אשקלון', [], [50, 70]], ['קרית גת', ['קריית גת'], [50, 70]]
  ];
  var SEP = '[\\s,()\\-–/.!?:;]';
  PL.forEach(function (p) { p.push(new RegExp(SEP + '(?:ב|ל|מ)?(?:' + [p[0]].concat(p[1]).join('|') + ')' + SEP)); });
  var GERSH = new RegExp(String.fromCharCode(0x5F4), 'g');
  function placesIn(text) {
    var t = ' ' + String(text).replace(GERSH, '"') + ' ';
    return PL.filter(function (p) { return p[3].test(t); });
  }
  function locate(areas, title, body) {
    if (!areas.length) return 'Unknown';
    var found = placesIn(title);
    var gov = (String(body || '').match(/לארגון ממשלתי[^.!\n]*/) || [''])[0].split('דרוש')[0];
    String(body || '').split(/\r?\n/).filter(function (l) { return /מיקום|ממוקמ/.test(l); }).concat([gov]).forEach(function (l) {
      placesIn(l).forEach(function (p) { if (found.indexOf(p) < 0) found.push(p); });
    });
    var out = [];
    areas.forEach(function (a) {
      var n = +a.slice(5), inA = found.filter(function (p) { return p[2].indexOf(n) >= 0; });
      var vals = inA.length ? inA.map(function (p) { return p[0]; }) : (REG[a] || []);
      if (!REG[a]) console.warn('[horizontech] unmapped region ' + a);
      vals.forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); });
    });
    return out.length ? out.join(', ') : 'Unknown';
  }
  var NB = new RegExp(String.fromCharCode(160), 'g');
  // Section labels route lines; labels dropped except advantage markers.
  var REQH = /^(דרישות|דרישת|יתרונות|יתרון ל|כישורים|תנאי סף|השכלה ודרישות|ניסיון נדרש)/;
  var ADV = /^(יתרונות|יתרון ל|דרישות יתרון)/;
  var DESCH = /^(תיאור (ה)?(משרה|תפקיד)|תחומי אחר[יא]+ות|עיקרי (ה)?(אחריות|תפקיד)|במסגרת התפקיד|על התפקיד|אחריות ותפקידים)/;
  // Pay/hours stay in description; narrow: budgets and "מערכות שכר" are requirements.
  var PAY = /^(שכר|תנאים)|שכר (של|גבוה|הולם|אטרקטיבי|החל|בהתאם)|לשעה|\d{1,2}:\d\d/;
  // No requirements label: classify by words (LRN-SETUP-18).
  var REQW = /^(מעל |לפחות |\d+\+? )?(שנות |שנים |שנתיים )?(ניסיון|נסיון|ידע |הכרות|הכרה|היכרות|תואר|השכלה|יכולת|שליטה|רישיון)|חובה|יתרון|שנות ניסיון|שנים ניסיון|שנתיים ניסיון/;
  var KEEP = /דרוש|בעל\/ת התפקיד/;
  function clean(s) { return String(s).replace(NB, ' ').replace(/[ \t]+/g, ' ').trim(); }
  function split(text) {
    var desc = [], req = [], cur = desc, heads = 0, sawReq = false;
    String(text).split(/\r?\n/).forEach(function (raw) {
      var l = clean(raw);
      if (!l) return;
      var m = l.match(/^([^:]{2,45}?)\s*:\s*(.*)$/);
      var head = m ? m[1] : l, rest = m ? m[2] : '';
      var isReq = REQH.test(head), isDesc = !isReq && DESCH.test(head);
      if ((isReq || isDesc) && (m || l.length <= 30)) {
        heads++;
        if (isReq) sawReq = true;
        cur = isReq ? req : desc;
        if (ADV.test(head)) { req.push(l); return; }
        if (rest) cur.push(rest);
        return;
      }
      if (cur === req && PAY.test(l)) { desc.push(l); return; }
      cur.push(l);
    });
    if (!sawReq) {
      var cand = desc.filter(function (l) { return !KEEP.test(l); });
      var hits = cand.filter(function (l) { return REQW.test(l); });
      var block = !heads && cand.length && hits.length * 2 >= cand.length;
      var moved = block ? cand : hits;
      desc = desc.filter(function (l) { return moved.indexOf(l) < 0; });
      req = moved.slice();
    }
    desc = desc.filter(function (l) { return req.indexOf(l) < 0; });
    return { desc: desc, req: req };
  }
  function box(item, cls, lines) {
    if (!lines.length) return;
    var b = document.createElement('div');
    b.className = cls; b.style.display = 'none';
    lines.forEach(function (l) { var d = document.createElement('div'); d.textContent = l; b.appendChild(d); });
    item.appendChild(b);
  }
  function span(item, cls, val) {
    if (!val) return;
    var s = document.createElement('span');
    s.className = cls; s.style.display = 'none'; s.textContent = val;
    item.appendChild(s);
  }
  var jobs = [];
  for (var i = 0; i < CARDS.length; i++) {
    var item = CARDS[i];
    var num = clean((item.querySelector('.job-ID') || {}).textContent || '');
    var a = item.querySelector('.job-link a[href]');
    if (!/^\d+$/.test(num) || !a) { console.warn('[horizontech] card without number/link skipped'); continue; }
    var areas = item.className.split(/\s+/).filter(function (c) { return /^area-\d+$/.test(c); });
    span(item, '__ai-id', 'horizontech-' + num);
    jobs.push({ item: item, num: num, url: a.href, areas: areas, title: clean((item.querySelector('.job-title') || {}).textContent || '') });
  }
  // Server does ~2 pages/s at any concurrency.
  var BATCH = 6, noDesc = 0;
  for (var k = 0; k < jobs.length; k += BATCH) {
    await Promise.all(jobs.slice(k, k + BATCH).map(async function (j) {
      var body = '';
      try {
        var html = await (await fetch(j.url, { credentials: 'omit' })).text();
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var idEl = doc.querySelector('.job-content .job-ID');
        var info = doc.querySelector('.job-content .job-info');
        if (!info || !idEl || clean(idEl.textContent) !== j.num) { noDesc++; return; }
        body = info.textContent;
        var p = split(body);
        box(j.item, '__ai-description', p.desc);
        box(j.item, '__ai-requirements', p.req);
        if (!p.desc.length) noDesc++;
      } catch (e) { noDesc++; }
      finally { span(j.item, '__ai-location', locate(j.areas, j.title, body)); }
    }));
  }
  console.info('[horizontech] cards ' + CARDS.length + ', jobs ' + jobs.length + ', no description ' + noDesc);
}
