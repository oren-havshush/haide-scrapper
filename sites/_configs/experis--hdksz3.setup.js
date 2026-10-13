// experis.co.il/search: Next.js over WPGraphQL. All listed jobs come from the endpoint (GET, 100 a call),
// all-or-nothing: an error or a count unequal to its total leaves no rows. Rows rebuilt under #haide-jobs-root.
// id experis-<job code> (printed "מספר משרה"). Url /job/<slug>: the code, except where a deleted copy holds
// the code's slug (/job/<code> shows "page gone"); then the live copy's own page.
// location: area tags -> region rows; a cue line naming a city inside the tag areas wins (4-case rule).
// body: requirements sections -> requirements, field labels dropped. form: per job, as the modal posts it.
if (!document.getElementById('haide-jobs-root')) {
  var R0 = document.createElement('div'); R0.id = 'haide-jobs-root'; R0.style.display = 'none'; document.body.appendChild(R0);
  var get = function (o) {
    return fetch('https://experiscontent.experis.co.il/graphql?query=' + encodeURIComponent('{allJob(where:{offsetPagination:{offset:' + o + ',size:100},taxQuery:{relation:AND,taxArray:[{field:NAME,taxonomy:JOBSTATUS,terms:"published"}]}}){nodes{title databaseId slug date jobFields{jobcode jobdescription} jobAreas{nodes{name}} jobScopes{nodes{name}}} pageInfo{offsetPagination{total}}}}'))
      .then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (j) { return j.data.allJob; });
  };
  var N = null;
  for (var at = 0; at < 2 && !N; at++) {
    try {
      var f0 = await get(0), tot = f0.pageInfo.offsetPagination.total, os = [];
      for (var o = 100; o < tot; o += 100) os.push(o);
      var all = f0.nodes.concat.apply(f0.nodes, (await Promise.all(os.map(get))).map(function (x) { return x.nodes; }));
      if (tot > 0 && all.length === tot) N = all;
    } catch (e) { N = null; }
  }
  var TG = { 'תל אביב והמרכז': 'M', 'שפלה': 'P', 'שרון': 'S', 'חיפה והצפון': 'Z', 'באר שבע והדרום': 'D', 'ירושלים והסביבה': 'J' };
  var RN = { M: 'אזור מרכז', P: 'אזור שפלה', S: 'אזור השרון', Z: 'אזור צפון', D: 'אזור דרום', J: 'אזור ירושלים' };
  // city.csv row|other spellings:regions. A place not listed is never written.
  var V = [];
  ('תל אביב-יפו|תל אביב|Tel Aviv:M;בני ברק:M;רמת גן:M;חולון:M;הרצליה|Herzliya:MS;רמת השרון:MS;פתח תקווה|פתח תקוה|Petah Tikva:M;ראש העין:MS;' +
   'יהוד:MP;באר יעקב:MP;שוהם|Shoham:MP;איירפורט סיטי|Airport City:MP;בית דגן:MP;נס ציונה:MP;רחובות:MP;מודיעין:MPJ;' +
   "רעננה|Ra'anana|Ra’anana|Raanana:MS;כפר סבא:MS;נתניה:MS;עמק חפר:S;אשדוד:PD;קרית גת|קריית גת:PD;ירוחם:D;באר שבע:D;ירושלים|Jerusalem:J;חיפה|Haifa:Z;כרמיאל:Z;יוקנעם:Z")
    .split(';').forEach(function (e) { var p = e.split(':'), r = p[0].split('|'); r.forEach(function (s) { V.push([s, r[0], p[1]]); }); });
  V.sort(function (a, b) { return b[0].length - a[0].length; });
  var pin = function (s, pre) {
    var out = [];
    V.forEach(function (v) {
      var e = v[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp('(^|[\\s,/(|:–-])' + (pre ? '(ב|(?<=/ ?))' : '(ו?ב)?') + e + '(?=$|[\\s,.!)|:;/–-])').test(s)) { if (out.indexOf(v[1]) < 0) out.push(v[1]); s = s.split(v[0]).join(' '); }
    });
    return out;
  };
  var M1 = '@@li@@';
  var lines = function (h) {
    var d = new DOMParser().parseFromString(h || '', 'text/html').body;
    d.querySelectorAll('br').forEach(function (b) { b.replaceWith('\n'); });
    d.querySelectorAll('li').forEach(function (l) { l.prepend(M1); });
    d.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,tr,ul,ol').forEach(function (b) { b.append('\n'); });
    return d.textContent.split('\n').map(function (t) {
      return { li: t.indexOf(M1) >= 0, t: t.split(M1).join('').replace(/[^\S\n]+/g, ' ').trim() };
    }).filter(function (x) { return /[\p{L}\d]/u.test(x.t); });
  };
  var REQ = /^(דרישות|דרישה|כישורים|השכלה|ניסיון נדרש|ניסיון מקצועי|יתרון|יתרונות|תכונות אישיות|המועמד האידיאלי|מה אנחנו מחפשים|מה חשוב לנו|מה חייב|מה נדרש|עמידה לפחות|(Minimum |Required |Preferred )?(Requirements|Qualifications)|Rrequirements|Nice to have|Must have|Bonus Points|Education|Skills|What you.ll bring|What we.re looking for)/i;
  var DSC = /^(תיאור|במסגרת התפקיד|תחומי אחריות|התפקיד כולל|על התפקיד|חשוב לדעת|המשרה כוללת|בתפקיד|מה בתפקיד|מה כולל|מה עושים|מהות|עיקרי|אחריות עיקריות|היקף המשרה|שעות העבודה|אופי העבודה|Job description|(Key )?Responsibilities|What you.ll do|About the role)/i;
  var LBL = /^(תיאור( ה?(תפקיד|משרה))?|דרישות( ה?(תפקיד|משרה|חובה|הסף))?|Job description|(Minimum )?Requirements( (&|and) Qualifications)?|Rrequirements|Qualifications)\s*:?$/i;
  var KEEP = /^(מיקום|Location|מקום העבודה|המשרה מיועדת|המשרה פונה|המשרה מנוסחת|אם התפקיד|נשמע מעניין|מוזמנ|שלחו|היקף|משרה מלאה|משרה חלקית|שכר|סודיות|יום עבודה|עבודה היברידית|נוכחות|הגעה|אין שום בעיה להגיע|מספר נילוסופט)/i;
  var mk = function (it, c, v) { var s = document.createElement('span'); s.className = c; s.textContent = v; it.appendChild(s); };
  var box = function (it, c, a) {
    while (a.length && a[a.length - 1].h) a.pop(); // a closing heading with nothing under it
    if (!a.length) return;
    var d = document.createElement('div'), ul = null; d.className = c;
    a.forEach(function (x) {
      if (x.li) { if (!ul) { ul = document.createElement('ul'); d.appendChild(ul); } var l = document.createElement('li'); l.textContent = x.t; ul.appendChild(l); }
      else { ul = null; var p = document.createElement('p'); p.textContent = x.t; d.appendChild(p); }
    });
    it.appendChild(d);
  };
  var F = function (n, l, t, r, v) { var o = { name: n, label: l, fieldType: t, required: r, tagName: 'INPUT' }; if (v !== undefined) o.value = v; return o; };
  (N || []).forEach(function (n) {
    try {
      var code = String(n.jobFields.jobcode || '').trim(), title = (n.title || '').trim();
      if (!code || !title) return;
      var it = document.createElement('div'); it.className = 'hj';
      var a = document.createElement('a'); a.href = location.origin + '/job/' + encodeURIComponent(n.slug || code); a.textContent = title; it.appendChild(a);
      mk(it, '__ai-title', title); mk(it, '__ai-jobid', 'experis-' + code);
      if (n.date) mk(it, '__ai-date', String(n.date).slice(0, 10));
      var sc = n.jobScopes.nodes.map(function (x) { return x.name; }); if (sc.length) mk(it, '__ai-type', sc.join(', '));
      var L = lines(n.jobFields.jobdescription), D = [], Rq = [], st = 'D', sawD = false;
      L.forEach(function (x) {
        var m, k = x.t.replace(/^[^\p{L}\d]+/u, ''), sh = (k.length <= 40 || (k.length < 60 && /:\s*$/.test(k))) && !/:\s*\S/.test(k);
        if (sh && REQ.test(k) && !/^יתרון ל/.test(k)) { st = 'R'; if (LBL.test(k)) return; x = { li: x.li, t: x.t, h: 1 }; }
        else if (sh && DSC.test(k)) { if (/^תיאור/.test(k) && sawD && LBL.test(k)) { st = 'R'; return; } st = 'D'; if (/^תיאור/.test(k)) sawD = true; if (LBL.test(k)) return; x = { li: x.li, t: x.t, h: 1 }; }
        else if ((m = k.match(/^(דרישות|תיאור)[^:]{0,20}:\s*\S/))) { st = m[1] === 'תיאור' ? 'D' : 'R'; x = { li: x.li, t: x.t.replace(/^[^:]*:\s*/, '') }; }
        (st === 'R' && !KEEP.test(k) ? Rq : D).push(x);
      });
      box(it, '__ai-description', D); box(it, '__ai-requirements', Rq);
      var tg = n.jobAreas.nodes.map(function (x) { return TG[x.name]; }).filter(function (g, i, s) { return g && s.indexOf(g) === i; }), fd = [];
      [{ t: title }].concat(L).forEach(function (x) {
        var t = x.t.replace(/^[^\p{L}\d]+/u, ''), sg = [], m;
        if (/(^|\s)עד\s|מגורים|הגעה עצמאית/.test(t)) return;
        if ((m = t.match(/^(מיקום( המשרה)?|Location|מקום העבודה|אזור העבודה)\s*[:\-–]\s*(.*)$/i))) sg.push([m[3]]);
        else if (x.t !== t && x.t.length - t.length <= 4 && /^(המשרה|העבודה|משרה מלאה|משרת)\s|^\S+( \S+)?$/.test(t)) sg.push([t]);
        else if (t.length <= 120 && /[|–]/.test(t)) t.split(/\s*[|–]\s*/).forEach(function (s) { s = s.replace(/[!.]+$/, '').trim(); if (V.some(function (v) { return v[0] === s; })) sg.push([s]); });
        if (!sg.length && /(^|\s)(המשרה|העבודה|למשרה|משרת On Site מלאה|באתר|לאתר החברה|ממשרדי החברה)\s+ב/.test(t)) sg.push([t, 1]);
        if (!sg.length && /(^|\s)(יושבים|יושבת)\s/.test(t)) sg.push([t]);
        if (!sg.length) t.split(/[.!?]\s/).forEach(function (s) { if (/(^|\s)(ל|עבור |ב)?(חבר[הת]|ארגון|מפעל|לקוח|תעשייה|בנק)/.test(s) && /(דרוש|מגייס|מחפש)/.test(s)) sg.push([s.replace(/(באזור|באיזור) /g, 'ב'), 1]); });
        sg.forEach(function (s) { pin(s[0], s[1]).forEach(function (p) { if (fd.indexOf(p) < 0) fd.push(p); }); });
      });
      var inT = function (p) { return V.some(function (v) { return v[1] === p && tg.some(function (g) { return v[2].indexOf(g) >= 0; }); }); };
      var ins = fd.filter(inT), loc = ins.length ? ins : tg.map(function (g) { return RN[g]; });
      mk(it, '__ai-location', loc.length ? loc.join(', ') : 'Unknown');
      var b = JSON.stringify({ actionUrl: location.origin + '/api/cv/applyForJob', actionAttribute: location.origin + '/api/cv/applyForJob', method: 'POST', enctype: 'multipart/form-data', fields: [
        F('firstName', 'שם פרטי', 'text', true), F('lastName', 'שם משפחה', 'text', true), F('email', 'מייל', 'email', true), F('phone', 'נייד', 'tel', true),
        { name: 'file', label: 'העלאת קורות חיים', fieldType: 'file', required: true, tagName: 'INPUT', accept: 'application/pdf, .docx, application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        F('linkedin', 'פרופיל לינקדאין (במקום קובץ)', 'text', false),
        F('agreement1', 'המידע אודותיי כפוף למדיניות הפרטיות; הכללת קו"ח במאגר המועמדים של קבוצת מנפאואר ומשלוחם ללקוחות', 'checkbox', true),
        F('agreement2', 'קבלת הצעות עבודה במסרון ובמייל מהקבוצה', 'checkbox', false), F('agreement3', 'אני מסכים/ה לתנאי השימוש של האתר', 'checkbox', true),
        F('cvDetails', '', 'hidden', false, '{"areas":null,"experience":null,"jobType":null,"interestedRoles":null}'),
        F('jobIds', '', 'hidden', true, String(n.databaseId)), F('jobsCodes', '', 'hidden', true, code), F('recaptchaToken', '', 'hidden', true, '')] });
      mk(it, '__ai-applicationInfo', b); mk(it, '__ai-formData', b);
      R0.appendChild(it);
    } catch (e) { }
  });
}
