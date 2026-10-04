(function () {
  try {
    // shapir.co.il careers: one server-rendered accordion, .job-collapsible per job; no detail pages
    // (the /משרות/<slug>/ share links return 500). Id = printed number "משרה [מס] N" -> shapir-N;
    // numbers shared by two different postings (3582/3644/3645, plus any new clash on the page) get
    // shapir-N-haideHash(share-URL slug) so both ship (owner, 2026-10-04).
    // Location (manager rule, 2026-10-04): the card's region wins. A city from the closed PLACES list named
    // in the title, else on a body line that starts with a cue (מיקום / המשרה ממוקמת ב) and is nothing but
    // that name, is used only if AREA puts it inside the card's region (פריסה ארצית holds all; no known
    // region -> the city). Else the region mapped to its city.csv entry; else Unknown. Quarry/plant names (עציונה, ורד, נטוף, זנוח, קציר ים המלח, מרחבים) are deliberately not
    // places. "למפעלי הבטון בירושלים" keeps the region (owner). Titles are read, never changed.
    // Body: description/requirements split by headings, labels dropped; "התפקיד כולל:" after a
    // description heading opens requirements (the employer's second label, like a repeated תיאור).
    var NBSP = String.fromCharCode(160);
    var HE = 'א-ת';
    var PINNED = { '3582': 1, '3644': 1, '3645': 1 };
    var REGION = { 'אזור מרכז': 'אזור מרכז', 'אזור השרון': 'אזור השרון', 'אזור ירושלים': 'אזור ירושלים',
      'אזור צפון': 'אזור צפון', 'אזור דרום': 'אזור דרום', 'שפלה': 'אזור שפלה', 'אזור שפלה': 'אזור שפלה',
      'כל הארץ': 'פריסה ארצית' };
    var PLACES = { 'ירושלים': 'ירושלים', 'בית שמש': 'בית שמש', 'נס ציונה': 'נס ציונה', 'רמת השרון': 'רמת השרון',
      'יהוד': 'יהוד', 'עפולה': 'עפולה', 'חיפה': 'חיפה', 'פתח תקווה': 'פתח תקווה', 'תל אביב': 'תל אביב-יפו', 'יוקנעם': 'יוקנעם' };
    var ALT = Object.keys(PLACES).map(function (k) { return k.replace(/ /g, '\\s+'); }).join('|');
    var TITLE_PLACE = new RegExp('(^|[^' + HE + '])([ובלה]{0,2})(' + ALT + ')(?![' + HE + '])', 'g');
    var CUE = /^[^\p{L}\d]*(?:מיקום(?:\s+המשרה)?\s*[:\-–]?\s*|המשרה\s+ממוקמת\s+ב)(.+)$/u;
    function canon(s) { return PLACES[s.replace(/\s+/g, ' ')] || null; }
    var M = 'אזור מרכז', S = 'אזור שפלה', J = 'אזור ירושלים', N = 'אזור צפון';
    var AREA = { 'ירושלים': [J], 'בית שמש': [J, S], 'נס ציונה': [S, M], 'רמת השרון': ['אזור השרון', M], 'יהוד': [M, S],
      'עפולה': [N], 'חיפה': [N], 'יוקנעם': [N], 'פתח תקווה': [M], 'תל אביב-יפו': [M] };
    function inside(p, reg) { return !!p && (!reg || reg === 'פריסה ארצית' || AREA[p].indexOf(reg) >= 0); }
    function one(list) { var u = list.filter(function (v, i) { return list.indexOf(v) === i; }); return u.length === 1 ? u[0] : null; }
    function titlePlace(t) {
      var out = [], m;
      TITLE_PLACE.lastIndex = 0;
      while ((m = TITLE_PLACE.exec(t))) {
        if (!/מפעלי\s+הבטון\s*$/.test(t.slice(0, m.index + m[1].length))) out.push(canon(m[3]));
      }
      return one(out);
    }
    function cuePlace(ls) {
      var out = [];
      ls.forEach(function (l) { var c = CUE.exec(l); if (c) { var v = canon(c[1].split(/[,.;(]/)[0].trim()); if (v) out.push(v); } });
      return one(out);
    }
    var NUM =/\s*[-–]?\s*\(?\s*משרה\s+(?:מס['׳]?\s+)?(\d{3,5})\s*\)?\s*$/;
    function haideHash(s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); }
    function clean(s) { return (s || '').split(NBSP).join(' ').replace(/[ \t]+/g, ' ').trim(); }
    function lines(el) {
      var c = el.cloneNode(true);
      Array.prototype.forEach.call(c.querySelectorAll('p,div,li,br,h1,h2,h3,h4,h5,tr'), function (e) { e.insertAdjacentText('afterend', '\n'); });
      return c.textContent.split('\n').map(clean).filter(function (l) { return l && !/^[:\-–•]+$/.test(l); });
    }
    var DESC_H = /^(תי?אור\s+(ה)?(משרה|תפקיד)|על\s+התפקיד|מהות\s+התפקיד|התפקיד)\s*[:\-–]?\s*$/;
    var ROLE_INCL = /^התפקיד\s+כולל\s*[:\-–]?\s*$/;
    var REQ_H = /^(דרישות(\s+(ה)?תפקיד)?|מה\s+אנחנו\s+מחפשים\??|כישורים(\s+נדרשים)?)\s*[:\-–?]?\s*$/;
    var REQ_INLINE = /^דרישות(\s+(ה)?תפקיד)?\s*[:\-–]\s*(\S.*)$/;
    var DESC_SUB = /^(יי?תרונות\s+(ה)?תפקיד|למה\s+אצלנו\??|שכר\s+ותנאים|תחומי\s+(ה)?אחריות.*|היקף\s+(ה)?משרה|עבודה\s+במשמרות.*)\s*[:\-–?]?\s*$/;
    // lines that stay in the description even under a requirements heading (place, pay, hours, equal opportunity)
    var STAY = /^(מיקום|המשרה\s+ממוקמת|המשרה\s+מיועדת\s+ל|שכר|היקף\s+(ה)?משרה)|\d:\d\d|לנשים\s+ו?ל?גברים/;
    var REQ_WORD = new RegExp('^(ניסיון|נסיון|ידע|רישיון|רשיון|תעודה|תעודת|תואר|בעל|בעלת|בעל/ת|יכולת|יכולות|נכונות|זמינות|שליטה|הכרה|הכרת|דובר|דוברת|עדיפות|נדרש|נדרשת|רצוי)(?![' + HE + '])');
    function isReq(l) {
      var t = l.replace(/^[^\p{L}\d]+/u, '');
      if (STAY.test(t) || /דרוש/.test(t) || t.length > 150) return false;
      return /חובה|יתרון/.test(t) || REQ_WORD.test(t);
    }
    var items = document.querySelectorAll('.job-collapsible');
    var count = {};
    Array.prototype.forEach.call(items, function (it) {
      var p = it.querySelector('.collapse-toggler .top p');
      var m = p && NUM.exec(clean(p.textContent));
      if (m) count[m[1]] = (count[m[1]] || 0) + 1;
    });
    Array.prototype.forEach.call(items, function (it) {
      if (it.querySelector('.__ai-title')) return;
      var p = it.querySelector('.collapse-toggler .top p');
      if (!p) return;
      var raw = clean(p.textContent);
      var m = NUM.exec(raw);
      var title = m ? raw.slice(0, m.index).replace(/[\s\-–]+$/, '').trim() : raw;
      if (!/(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u.test(title) || /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u.test(title)) return;
      var share = it.querySelector('a[href*="api.whatsapp.com"]');
      var slug = '';
      if (share) {
        try { slug = decodeURIComponent(share.getAttribute('href').replace(/^.*?text=/, '')).replace(/\/+$/, '').split('/').pop(); } catch (e) { slug = ''; }
      }
      var id = null;
      if (m) {
        id = 'shapir-' + m[1];
        if ((PINNED[m[1]] || count[m[1]] > 1) && slug) id += '-' + haideHash(slug);
      } else if (slug) {
        id = 'shapir-' + haideHash(slug);
      }
      var groups = it.querySelectorAll('.collapse-toggler .bottom .group:not(.clicked_here) p');
      var region = groups[0] ? clean(groups[0].textContent) : '';
      var type = groups[1] ? clean(groups[1].textContent) : '';
      var body = it.querySelector('.collapse .top');
      var desc = [], req = [], all = [], bucket = 'desc', sawDesc = false;
      if (body) {
        Array.prototype.forEach.call(body.querySelectorAll(':scope > div'), function (d) {
          lines(d).forEach(function (l) {
            all.push(l);
            if (DESC_H.test(l)) { bucket = 'desc'; sawDesc = true; return; }
            if (ROLE_INCL.test(l)) { bucket = sawDesc ? 'req' : 'desc'; sawDesc = true; return; }
            if (REQ_H.test(l)) { bucket = 'req'; return; }
            var ri = REQ_INLINE.exec(l);
            if (ri) { bucket = 'req'; l = ri[3]; }
            if (DESC_SUB.test(l)) { bucket = 'sub'; desc.push(l); return; }
            if (/^משרה\s+(מס['׳]?\s+)?\d{3,5}$/.test(l)) return;
            if (bucket === 'req') { (STAY.test(l.replace(/^[^\p{L}\d]+/u, '')) ? desc : req).push(l); }
            else { (bucket === 'desc' && isReq(l) ? req : desc).push(l); }
          });
        });
      }
      function add(cls, v) { if (!v) return; var s = document.createElement('span'); s.className = cls; s.style.display = 'none'; s.textContent = v; it.appendChild(s); }
      add('__ai-title', title);
      add('__ai-id', id);
      var reg = REGION[region], tp = titlePlace(title), cp = cuePlace(all);
      add('__ai-location', (inside(tp, reg) ? tp : inside(cp, reg) ? cp : null) || reg || 'Unknown');
      add('__ai-type', type);
      add('__ai-description', desc.join('\n'));
      add('__ai-requirements', req.join('\n'));
    });
  } catch (e) { }
})();
