if (!/^\/jobs\/(page\/\d+\/?)?$/.test(location.pathname) || document.querySelector('.__ai-done')) return;
var CARD = 'a.post-card[data-id]', first = document.querySelector(CARD);
if (!first) return;
var grid = first.closest('.post-col').parentElement;
var parse = h => new DOMParser().parseFromString(h, 'text/html');
var hh = s => { var h = 5381, i = s.length; while (i) h = (h * 33) ^ s.charCodeAt(--i); return (h >>> 0).toString(36); };
var get = u => fetch(u, { credentials: 'same-origin' }).then(r => r.ok ? r.text() : '').catch(() => '');
var last = 1, seen = {}, pages = [];
document.querySelectorAll('a.page-numbers').forEach(a => { var m = /\/page\/(\d+)\//.exec(a.href); if (m) last = Math.max(last, +m[1]); });
grid.querySelectorAll(CARD).forEach(a => { seen[a.href] = 1; });
for (var p = 2; p <= Math.min(last, 40); p++) pages.push(get('/jobs/page/' + p + '/'));
(await Promise.all(pages)).forEach(h => h && parse(h).querySelectorAll(CARD).forEach(a => {
  if (!seen[a.href]) { seen[a.href] = 1; grid.appendChild(document.importNode(a.closest('.post-col'), true)); }
}));

var D = {};
'ראשון לציון|חולון|פתח תקווה|מודיעין|נס ציונה|בית דגן|יהוד|רחובות|באר שבע|נהריה|רעננה|אשדוד|נתניה|עמק חפר|בני ברק|יבנה|רמת השרון|שוהם|חיפה|כפר סבא|ירושלים|רמת גן|בת-ים|הרצליה|חדרה|ראש העין|הוד השרון|גבעתיים|אשקלון|קריית אונו|איירפורט סיטי|אזור מרכז|אזור דרום|אזור השרון|פריסה ארצית|תל אביב-יפו|רמלה לוד|אור יהודה|גדרה'.split('|').forEach(c => { D[c] = c; });
var A = { 'תל אביב|תל-אביב|ת"א': 'תל אביב-יפו', 'קרית אונו|ק.אונו': 'קריית אונו', 'פתח-תקווה|פתח תקוה': 'פתח תקווה', 'ראשון-לציון|ראשל"צ': 'ראשון לציון', 'בת ים': 'בת-ים', 'רמלה|לוד': 'רמלה לוד', 'מרכז|המרכז|אזור המרכז': 'אזור מרכז', 'דרום|הדרום|אזור הדרום': 'אזור דרום', 'השרון': 'אזור השרון', 'כל הארץ|בכל הארץ': 'פריסה ארצית', 'קרית שדה התעופה|אייפורט סיטי': 'איירפורט סיטי' };
Object.keys(A).forEach(k => k.split('|').forEach(v => { D[v] = A[k]; }));
var toCity = raw => {
  var w = (raw || '').replace(/[״”“]/g, '"').replace(/[(),/]/g, ' , ').replace(/\s+/g, ' ').trim().split(' '), out = [], i = 0;
  while (i < w.length) {
    if (!w[i] || w[i] === ',' || /^ו?(הסביבה)?$/.test(w[i])) { i++; continue; }
    var hit = 0;
    for (var n = Math.min(4, w.length - i); n > 0 && !hit; n--) {
      var ph = w.slice(i, i + n).join(' '), c = D[ph] || (ph[0] === 'ו' && D[ph.slice(1)]);
      if (c) { if (out.indexOf(c) < 0) out.push(c); i += n; hit = 1; }
    }
    if (!hit) return 'Unknown';
  }
  return out.join(', ') || 'Unknown';
};

var lines = el => {
  if (!el) return [];
  var c = el.cloneNode(true);
  c.querySelectorAll('br').forEach(b => b.replaceWith('\n'));
  c.querySelectorAll('p,li,div,h1,h2,h3,h4,h5,h6,ol,ul').forEach(e => e.insertAdjacentText('afterend', '\n'));
  c.querySelectorAll('li').forEach(e => e.insertAdjacentText('afterbegin', '• '));
  return c.textContent.split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
};
var REQ = /^(?:להלן\s+)?דרישות(?:\s+התפקיד)?\s*(?:[:\-–]\s*(.*))?$/;
var END = /איי פורס|^טל|^פקס|^רכז|^סוג משרה|^מגורי מועמדים|^מיקום המשרה|^לפרטים/;
var PAY = { test: l => /שכר|₪|ש"ח|^[*•▪\s]*תנאים|\+\s*תנאים|תנאים\s*\+/.test(l.replace(/חשב\S*\s+שכר|תוכנת\s+שכר/g, '')) };
var DROP = /^לשליחת פניה בנוגע למשרה|^(?:הגדרת|תיאור)\s+ה?תפקיד\s*:?$/;
var AGN = /03-95031(?:84|85|69)/g, AG = /^["״]?איי פורס בע["״]מ["״]?$|^רכזת מטפלת:|^(?:טל\S?:|פקס:|אור|פרטים נוספים בטל\S?)?[\s,]*(?:03-95031(?:84|85|69)(?:\/5)?[\s,]*)+$/;
var BUL = /^[*•▪–-]/;
var RSTART = /^[*•▪–-]?\s*(?:ניסיון|נסיון|ידע|רישיון|רשיון|תעודת|תעודה|בעל\/ת|בעלי|בעל|יכולת|נכונות|זמינות|שליטה|הכרת|הכרה|מגורים|מאזור|דובר|דוברי|עדיפות|נדרש|נדרשת|יוצא|יוצאי|רצוי|יתרון|גישה|חובה|דרישות|"?ראש גדול"?|עם (?:ידע|ניסיון|נסיון))(?=[\s/,.:!-]|$)/;
var isReq = l => !(/דרוש|\d:\d\d/.test(l) || PAY.test(l) || END.test(l) || l.length > 150 || /[–-]\s*חובה(?:\s+[^\s!]+){3}/.test(l)) && (RSTART.test(l) || /חובה|יתרון/.test(l));

var mk = (item, cls, val, attr) => {
  if (!val) return;
  var e = document.createElement(attr ? 'a' : 'span');
  e.className = cls; e.style.display = 'none';
  if (attr) e.setAttribute('href', val); else e.textContent = val;
  item.appendChild(e);
};

var cls = L => {
  for (var i = 0; i < L.length; i++) {
    if (L[i][1] !== 'x') continue;
    if (BUL.test(L[i][0]) && !PAY.test(L[i][0])) {
      var j = i, hits = 0;
      while (j < L.length && L[j][1] === 'x' && BUL.test(L[j][0]) && !PAY.test(L[j][0])) { if (isReq(L[j][0])) hits++; j++; }
      for (var q = i; q < j; q++) L[q][1] = hits * 2 >= j - i && !/דרוש/.test(L[q][0]) ? 'r' : 'd';
      i = j - 1;
    } else L[i][1] = isReq(L[i][0]) ? 'r' : 'd';
  }
};
var items = [...grid.querySelectorAll(CARD)], k = 0;
var work = async () => {
  while (k < items.length) {
    var a = items[k++];
    if (a.querySelector('.__ai-description')) continue;
    var h = await get(a.href);
    var doc = parse(h), R = [], inReq = false, tail = false;
    lines(doc.querySelector('.property-page-content .base-output')).forEach(l => {
      if (DROP.test(l)) return;
      var m = REQ.exec(l);
      if (m) { inReq = true; tail = false; if (m[1]) R.push([m[1], 'r']); return; }
      if (END.test(l)) { inReq = false; tail = true; }
      R.push([l, tail ? 'd' : inReq ? (PAY.test(l) ? 'd' : 'r') : 'x']);
    });
    var head = [], T = [], shared = [];
    R.forEach(x => { var m = x[1] === 'x' && /^(\d+)\.\s*(\S.*)$/.exec(x[0]); if (m) T.push({ n: m[1], L: [[m[2], 'x']] }); else (T.length ? T[T.length - 1].L : head).push(x); });
    if (T.length > 1 && T.slice(0, -1).every(t => t.L.length === 1)) shared = T[T.length - 1].L.splice(1);
    var jobs = T.length > 1 ? T.map(t => ({ n: t.n, own: t.L.map(x => x[0]).join(' '), L: head.concat(t.L, shared).map(x => x.slice()) })) : [{ L: R }];
    var other = R.some(x => /0\d{1,2}-\d{7}/.test(x[0].replace(AGN, ''))), meta = {};
    doc.querySelectorAll('.property-data-block .data-pro-item').forEach(d => {
      var t = d.querySelector('.benefit-title'), v = d.querySelector('.prop-data-text');
      if (t && v) meta[t.textContent.trim()] = v.textContent.replace(/\s+/g, ' ').trim();
    });
    var ct = ((a.querySelector('.post-item-content .date-card-title') || {}).textContent || '').trim();
    // LRN-LOC-10
    var tx = ct ? '' : R.map(x => x[0]).join('\n');
    var loc = ct == 'צומת כנות' ? 'אזור תעשיה כנות' : ct ? toCity(ct) : /ממוק(ם|מ\S*)\s+באזור\s*([,.](?!\s*(ליד|סמוך|בקרבת))|$)/m.test(tx) ? 'אזור' : /בכל רחבי הארץ|ברחבי הארץ|בכל הארץ|פריסה ארצית/.test(tx) ? 'פריסה ארצית' : 'Unknown';
    var ld = /"datePublished":"([^"]+)"/.exec(h), id = 'iforc-' + hh(decodeURIComponent(a.pathname.replace(/\/+$/, '').split('/').pop()));
    var el = a, col = a.closest('.post-col');
    jobs.forEach((jb, t) => {
      if (t) { // #n vs worker href dedup
        var c2 = col.cloneNode(true);
        c2.querySelectorAll('[class^="__ai-"]').forEach(e => e.remove());
        col.after(c2); col = c2; el = c2.querySelector(CARD); el.setAttribute('href', a.href + '#' + jb.n);
      }
      cls(jb.L);
      var K = jb.L.filter(x => other || !AG.test(x[0]));
      var desc = K.filter(x => x[1] !== 'r').map(x => x[0]), req = K.filter(x => x[1] === 'r').map(x => x[0]);
      if (meta['סוג המשרה'] && !/סוג\s*ה?משרה/.test(desc.join('\n'))) desc.push('סוג המשרה: ' + meta['סוג המשרה']);
      var hit = jb.own ? loc.split(', ').filter(c => Object.keys(D).some(w => D[w] === c && jb.own.indexOf(w) >= 0)) : [];
      mk(el, '__ai-jobid', id + (jb.n ? '-' + jb.n : ''));
      mk(el, '__ai-url', a.href, 1);
      mk(el, '__ai-apply', a.href);
      mk(el, '__ai-location', hit.length === 1 ? hit[0] : loc);
      mk(el, '__ai-description', desc.join('\n'));
      mk(el, '__ai-requirements', req.join('\n'));
      mk(el, '__ai-department', (meta['קטגוריות'] || '').split(/\s*,\s*/).filter(v => v && v !== 'חיפוש משרות').join(', '));
      mk(el, '__ai-date', ld && ld[1]);
    });
  }
};
await Promise.all([...Array(8)].map(work));
mk(grid, '__ai-done', '1');
