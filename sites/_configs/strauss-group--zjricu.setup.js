// strauss-group.co.il: listing-only. id = strauss-group-<job no>. location: four-case rule, tag = card region,
// cues = title after dash, opening line, office line; closed city.csv list. Body split by headings.
var ITEM = 'div.jobs_list_order_wrap';
var prev = -1, stable = 0;
for (var t = 0; t < 40; t++) {
  var n0 = document.querySelectorAll(ITEM).length;
  if (n0 > 0 && n0 === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n0;
  await new Promise(function (r) { setTimeout(r, 500); });
}
var REGION = { 'מרכז': 'אזור מרכז', 'צפון': 'אזור צפון', 'דרום': 'אזור דרום', 'שפלה': 'אזור שפלה',
  'שרון': 'אזור השרון', 'ירושלים': 'אזור ירושלים', 'ארצי': 'פריסה ארצית' };
var TP = [[/נוף הגליל/, 'נוף הגליל', 'צפון'], [/שוהם/, 'שוהם', 'מרכז שפלה'], [/עכו/, 'עכו', 'צפון'],
  [/בית שמש/, 'בית שמש', 'ירושלים שפלה'], [/שדרות/, 'שדרות', 'דרום'], [/פתח תקווה|Petah Tikva/i, 'פתח תקווה', 'מרכז'],
  [/כרמיאל/, 'כרמיאל', 'צפון'], [/באר שבע/, 'באר שבע', 'דרום'], [/אחיהוד/, 'אחיהוד', 'צפון'],
  [/רמת גן/, 'רמת גן', 'מרכז'], [/גבעתיים/, 'גבעתיים', 'מרכז'], [/אור יהודה/, 'אור יהודה', 'מרכז'],
  [/(?:^|[^א-ת])[בל]?לוד(?![א-ת])/, 'רמלה לוד', 'מרכז שפלה'], [/נתיב הל"ה/, 'נתיב הל"ה', 'שפלה ירושלים'], [/כפר יהושו?ע/, 'כפר יהושע', 'צפון'],
  [/(?:^|[^א-ת])[בל]?יטבתה(?![א-ת])/, 'קיבוץ יטבתה', 'דרום'], [/(?:^|[^א-ת])[בל]?(?:כפר )?מסריק/, 'כפר מסריק', 'צפון']];
var RG = /(?:^|[^א-ת])(?:אזור\s+)?ו?ה?(צפון|דרום|מרכז|שפלה|שרון)(?![א-ת])|אזור\s+(ירושלים)/g;
var CUE = /^(?:•\s*)?ה?עבודה\s+(?:במשרה מלאה\s+)?במשרדי החברה ב(אור יהודה)(?![א-ת])/;
var DESC_L = /^(מה כולל התפקיד|תיאור התפקיד|תיאור המשרה|איך י?יראה (?:היום שלך|היומיום|היום-יום שלך|היום יום שלך)|Role Description|Job Description|Key Responsibilities|Job Responsibilities|Responsibilities|About the Role|What You'll Do)\s*[?:]?\s*/i;
var REQ_L = /^(מה חשוב להביא(?: איתך)?(?: לתפקיד)?|מה חשוב לנו|דרישות(?: התפקיד| המשרה| חובה)?|כישורים(?: נדרשים)?|למי מתאימה המשרה|Job Requirements|Required Qualifications|Requirements|Qualifications|What We're Looking For|What You Bring)\s*[?:]?\s*/i;
var ASK_L = /^(מה נבקש ממך)\s*[?:]?\s*/;
var ABOUT = /^(קצת עלינו|About us|Why Strauss Water)\s*[?:]?$/i;
var EQUAL = /(פונה לנשים וגברים|לנשים ולגברים כאחד|לנשים וגברים כאחד)/;
var NUMLINE = /^מספר משרה\s*:?\s*\d+$/;
var TERMS = /(שעות|משמרת ערב|משרת (?:בוקר|ערב)|משרה מלאה|ימי שישי|עבודה במשרדי|רילוקיישן)|^\P{L}*\p{Extended_Pictographic}/u;
var MATH = new RegExp('[' + String.fromCodePoint(0x1D400) + '-' + String.fromCodePoint(0x1D7FF) + ']', 'gu');
var HE_LA = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u;
var OTHER = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var items = document.querySelectorAll(ITEM);
for (var i = 0; i < items.length; i++) {
  var item = items[i];
  try {
    if (item.querySelector('.__ai-title')) continue;
    var tx = function (el) { return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : ''; };
    var title = tx(item.querySelector('.warp_jobs_list_order h2')).replace(MATH, function (c) { return c.normalize('NFKC'); });
    if (!title || !HE_LA.test(title) || OTHER.test(title)) { item.remove(); continue; }
    var num = '', date = '';
    var metas = item.querySelectorAll('.warp_jobs_list_order .details_item');
    for (var m = 0; m < metas.length; m++) {
      var mt = tx(metas[m]), mv = tx(metas[m].querySelector('.det_item'));
      if (/^מספר משרה/.test(mt) && /^\d+$/.test(mv)) num = mv;
      if (/^תאריך פרסום/.test(mt) && /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(mv)) date = mv;
    }
    var tag = tx(item.querySelector('.warp_jobs_list_order .location .det_item'));
    var body = item.querySelector('.jobs_list_order_desc');
    var lines = [];
    if (body) {
      var c = body.cloneNode(true);
      c.querySelectorAll('style, script, noscript, link, template, svg, iframe, img').forEach(function (e) { e.remove(); });
      var w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT), tn;
      while ((tn = w.nextNode())) {
        var s = tn.nodeValue || '', s0;
        if (s.indexOf('{') < 0 || !/\{[^{}]*[a-z-]+\s*:\s*[^;{}]+;?[^{}]*\}/i.test(s)) continue;
        do { s0 = s; s = s.replace(/[^{}א-ת]*\{[^{}]*\}/g, ' '); } while (s !== s0);
        tn.nodeValue = s;
      }
      c.querySelectorAll('br').forEach(function (e) { e.replaceWith('\n'); });
      c.querySelectorAll('li').forEach(function (e) { e.prepend('\n• '); });
      c.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, h5, h6, ul, ol').forEach(function (e) { e.prepend('\n'); e.append('\n'); });
      var raw = (c.textContent || '').split('\n');
      for (var r = 0; r < raw.length; r++) {
        var ln = raw[r].replace(/\s+/g, ' ').trim();
        if (ln && ln !== '•') lines.push(ln);
      }
    }
    var unb = function (l) { return l.replace(/^•\s*/, ''); };
    var hasReq = lines.some(function (l) { l = unb(l); var mm = REQ_L.exec(l); return mm && l.length < 200 && (l.length < 60 || /[?:]/.test(mm[0])); });
    var desc = [], req = [], mode = 'desc', place = '';
    for (var k = 0; k < lines.length; k++) {
      var L = lines[k];
      if (NUMLINE.test(unb(L))) continue;
      if (/^[?:]$/.test(L)) continue;
      var hit = null, U = unb(L);
      if (U !== L && U.length < 60 && (DESC_L.test(U) || REQ_L.test(U) || ASK_L.test(U)) && !U.replace(DESC_L, '').replace(REQ_L, '').replace(ASK_L, '').trim()) L = U;
      if (L.length < 200) {
        var md = DESC_L.exec(L), mr = REQ_L.exec(L), ma = ASK_L.exec(L);
        if (md && (L.length < 60 || /[?:]/.test(md[0]))) hit = ['desc', md[0]];
        else if (mr && (L.length < 60 || /[?:]/.test(mr[0]))) hit = ['req', mr[0]];
        else if (ma) hit = [hasReq ? 'desc' : 'req', ma[0]];
      }
      if (hit) { mode = hit[0]; L = L.slice(hit[1].length).replace(/^[\s?:]+/, '').trim(); if (!L) continue; }
      else if (ABOUT.test(L)) mode = 'desc';
      var cue = CUE.exec(L);
      if (cue) place = cue[1];
      var toReq = mode === 'req' && !EQUAL.test(L) && !(L.charAt(0) !== '•' && TERMS.test(L));
      (toReq ? req : desc).push(L);
    }
    var add = function (cls, val) {
      var el = document.createElement('div');
      el.className = cls; el.style.display = 'none';
      if (Array.isArray(val)) {
        val.forEach(function (v) { var p = document.createElement('p'); p.textContent = v; el.appendChild(p); });
      } else { el.textContent = val; }
      item.appendChild(el);
    };
    add('__ai-title', title);
    if (num) add('__ai-id', 'strauss-group-' + num);
    if (date) add('__ai-date', date);
    var dm = /[-–]/.exec(title), tt = dm ? title.slice(dm.index + 1) : '', op = lines[0] && lines[0].length <= 80 ? lines[0] : '', om = /[-–]/.exec(op), hits = [], had = {}, g;
    var push = function (v, t, r) { if (!had[v]) { had[v] = 1; hits.push({ v: v, t: t, r: r }); } }, vv = function (h) { return h.v; };
    var ct = tt + ' | ' + op + ' | ' + place, rt = tt + ' | ' + (om ? op.slice(om.index + 1) : '');
    TP.forEach(function (p) { if (p[0].test(ct)) push(p[1], p[2].split(' ')); });
    RG.lastIndex = 0;
    while ((g = RG.exec(rt))) { var rn = g[1] || g[2]; push(REGION[rn], [rn], 1); }
    var inA = hits.filter(function (h) { return tag === 'ארצי' || h.t.indexOf(tag) >= 0; }), out = hits.filter(function (h) { return inA.indexOf(h) < 0; });
    var cit = inA.filter(function (h) { return !h.r; }).map(vv), loc, cs;
    if (!REGION[tag]) { loc = hits.map(vv); cs = 4; }
    else if (inA.length && out.length) { loc = (cit.length ? cit : [REGION[tag]]).concat(out.map(vv)); cs = 2; }
    else if (inA.length) { loc = cit.length ? cit : [REGION[tag]]; cs = 1; }
    else { loc = [REGION[tag]]; cs = hits.length ? 3 : 0; }
    loc = loc.filter(function (v, x) { return loc.indexOf(v) === x; });
    item.setAttribute('data-ai-loc-case', cs);
    add('__ai-location', loc.join(', ') || 'Unknown');
    if (desc.length) add('__ai-description', desc);
    if (req.length) add('__ai-requirements', req);
  } catch (e) {
  }
}
