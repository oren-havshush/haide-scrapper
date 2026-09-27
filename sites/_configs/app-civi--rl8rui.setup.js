// alut - Civi FPEVT4D67N/8315 (why: sites/alut/notes.md). Symbols via
// String.fromCharCode: an escape here decodes to a raw char.
var C = String.fromCharCode;
var SEL = '.proflist .thumb';
var NBSP = C(0xa0), G = C(0x5f4), HEBR = C(0x590) + '-' + C(0x5ff);
// LEAD: dash stays LAST - '+-' before a char is a RANGE.
var LEAD = new RegExp('^[\\s*>' + C(0x2022) + C(0x25aa) + C(0x2714) + C(0x2705) + '+-]+');
var TOK = new RegExp('[^' + HEBR + '@0-9]+');
var REQ = /^(?:ה?דרישות(?:\s+ה?(?:תפקיד|משרה))?|כישורים(?:\s+נדרשים)?)\s*(?:[:-]\s*|$)/;
var DESC = /^(?:תיאור\s+ה?תפקיד|תחומי\s+אחריות(?:\s+עיקריים)?|(?:מה\s+)?התפקיד\s+[בכ]ולל)\s*:?\s*$/;
var REQ_LN =/חובה|יתרון|^(?:ניסיון|נסיון|ידע|רישיון|תעודה|בעל|יכולת|נכונות|שליטה|דובר|עדיפות|רצוי)/;
// Each canonical is VERBATIM on city.csv AND the worker list.
var PLACES = {};
('נתניה;הרצליה;באר שבע;רמת השרון;רחובות;גבעת ברנר|ג ברנר;מודיעין|מודיען;ירושלים;נס ציונה;' +
 'כרמיאל;רעננה;כפר סבא;חולון;נהריה;חגור;יבנה;בית חשמונאי;רמלה לוד|רמלה|לוד;גוש עציון;' +
 'אבן יהודה;גבעתיים;מגדל העמק;חדרה;ראש העין;ראשון לציון;פתח תקווה|פתח תקוה;' +
 'תל אביב-יפו|תל אביב;קרית אתא;חורה').split(';').forEach(function (e) {
  var f = e.split('|');
  for (var i = 0; i < f.length; i++) PLACES[f[i]] = f[0];
});
var AB = [['ת' + G + 'א', 'תל אביב-יפו'], ['ת"א', 'תל אביב-יפו'], ['פ' + G + 'ת', 'פתח תקווה'],
  ['פ"ת', 'פתח תקווה'], [C(0x62d, 0x648, 0x631, 0x629), 'חורה']];
var PRE = 'בלמוהכש';
function textOf(el) {
  if (!el) return '';
  var d = document.createElement('div');
  d.innerHTML = el.innerHTML.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(?:p|div|li|tr)>/gi, '\n');
  return (d.textContent || '').split(NBSP).join(' ')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function splitBody(body, inReq) {
  var bl = body.split(/\n\s*\n/), de = [], rq = [];
  for (var i = 0; i < bl.length; i++) {
    var ln = bl[i].split('\n'), hd = (ln[0] || '').replace(LEAD, '').trim();
    if (REQ.test(hd)) { inReq = true; ln[0] = hd.replace(REQ, ''); if (!ln[0]) ln = ln.slice(1); }
    else if (DESC.test(hd)) { inReq = false; ln = ln.slice(1); }
    var b = ln.join('\n').replace(/^\n+|\n+$/g, '');
    if (b.trim()) (inReq ? rq : de).push(b);
  }
  return { d: de.join('\n\n').trim(), r: rq.join('\n\n').trim() };
}
// Whole-word, longest window first, 1-2 Hebrew prefixes peeled. NOT substring:
// city.csv entries hide in ordinary words (מעון in למעונות) = wrong city.
function placesIn(text) {
  var t = text || '';
  for (var a = 0; a < AB.length; a++) t = t.split(AB[a][0]).join(' @' + a + '@ ');
  var tk = t.split(TOK).filter(Boolean), out = [], used = 0, words = 0;
  for (var i = 0; i < tk.length; i++) if (!/^@\d+@$/.test(tk[i])) words++;
  for (var j = 0; j < tk.length; ) {
    var ab = tk[j].match(/^@(\d+)@$/), hit = ab ? AB[+ab[1]][1] : null, span = 1;
    for (var n = 2; n >= 1 && !hit; n--) {
      if (j + n > tk.length || (n === 2 && tk[j + 1].indexOf('@') >= 0)) continue;
      for (var p = 0; p <= 2 && !hit; p++) {
        if (p > 0 && PRE.indexOf(tk[j].charAt(p - 1)) < 0) break;
        var f1 = tk[j].slice(p), key = n === 2 ? f1 + ' ' + tk[j + 1] : f1;
        if (f1 && PLACES[key]) { hit = PLACES[key]; span = n; used += n; }
      }
    }
    if (hit) { if (out.indexOf(hit) < 0) out.push(hit); j += span; } else { j++; }
  }
  return { v: out, used: used, words: words };
}
// The ב marks the workplace - bare שמיר is a Galilee kibbutz on city.csv.
function locationOf(title, body) {
  var out = placesIn(title).v.slice(), ls = (body || '').split('\n');
  for (var i = 0; i < ls.length; i++) {
    var l = ls[i].trim();
    if (!l || l.length > 160) continue;
    var r = placesIn(l);
    if (r.v.length >= 2 && r.used === r.words)
      for (var k = 0; k < r.v.length; k++) if (out.indexOf(r.v[k]) < 0) out.push(r.v[k]);
  }
  if (!out.length && /במרכז הרפואי שמיר/.test(title + '\n' + body)) out.push('באר יעקב');
  if (!out.length && /פריסה\s+ארצית|רחבי\s+הארץ/.test(title)) out.push('פריסה ארצית');
  return out;
}
function add(it, cls, val) {
  var s = document.createElement('span');
  s.className = cls;
  s.textContent = val;
  it.appendChild(s);
}
function idOf(el) {
  var t = el.querySelector('.thumb-content');
  var m = t && (t.getAttribute('onclick') || '').match(/openPromo\(event,(\d+)/);
  return m ? m[1] : '';
}
// Paginates at 20 (46 over 3 pages); profRefresh() would location.assign().
var list = document.querySelector('.proflist');
if (list && document.querySelectorAll(SEL).length >= 20) {
  var have = {}, cur = document.querySelectorAll(SEL);
  for (var i0 = 0; i0 < cur.length; i0++) { var k0 = idOf(cur[i0]); if (k0) have[k0] = 1; }
  for (var p0 = 2; p0 <= 25; p0++) {
    var bs = location.href, u = bs.replace(/([?&])p=\d+/, '$1p=' + p0), added = 0;
    if (u === bs) u = bs + '&p=' + p0;
    try {
      var rs = new DOMParser().parseFromString(await (await fetch(u)).text(), 'text/html')
        .querySelectorAll(SEL);
      for (var q = 0; q < rs.length; q++) {
        var k = idOf(rs[q]);
        if (!k || have[k]) continue;
        have[k] = 1;
        list.appendChild(document.importNode(rs[q], true));
        added++;
      }
    } catch (e) {}
    if (!added) break;
  }
}
await Promise.all([].slice.call(document.querySelectorAll(SEL)).map(async function (it) {
  if (it.querySelector('.__ai-jobid')) return;
  var tc = it.querySelector('.thumb-content');
  var m = tc && (tc.getAttribute('onclick') || '').match(/openPromo\(event,(\d+),(\d+)/);
  if (!m) { it.remove(); return; }
  var du = 'https://app.civi.co.il/promo/id=' + m[1] + '&src=' + m[2];
  var ti = ((it.querySelector('.title') || {}).textContent || '').replace(/\s+/g, ' ').trim();
  var ds = '', rq = '';
  var fl = [{ name: 'Form_submitted', label: '', tagName: 'INPUT', required: false, fieldType: 'hidden' }];
  try {
    var doc = new DOMParser().parseFromString(await (await fetch(du)).text(), 'text/html');
    var dt = textOf(doc.querySelector('#je-title'));
    if (dt) ti = dt.replace(/\s+/g, ' ').trim();
    var s1 = splitBody(textOf(doc.querySelector('#je-descr')), false);
    ds = s1.d;
    rq = s1.r;
    var det = textOf(doc.querySelector('#je-details'));
    if (det) {
      var s2 = splitBody(det, true);
      if (s2.r) rq = rq ? rq + '\n\n' + s2.r : s2.r;
      if (s2.d) ds = ds ? ds + '\n\n' + s2.d : s2.d;
    }
    [].forEach.call(doc.querySelectorAll('form.Form .field[data-id]'), function (f) {
      var lb = f.querySelector('.label'), ip = f.querySelector('input,textarea,select');
      fl.push({
        name: f.getAttribute('data-id'),
        label: lb ? lb.textContent.replace(/[*]|\s*:\s*$/g, '').replace(/\s+/g, ' ').trim() : '',
        tagName: ip ? ip.tagName : 'INPUT',
        required: !!(lb && lb.querySelector('.required')),
        fieldType: ip ? (ip.getAttribute('type') || ip.tagName.toLowerCase()) : 'text'
      });
    });
  } catch (e) {}
  if (!ds) {
    var sf = splitBody(textOf(it.querySelector('.descr')), false);
    ds = sf.d;
    if (!rq) rq = sf.r;
  }
  var dl = ds.split('\n');
  if (dl.length > 1 && dl[0].replace(/\s+/g, ' ').trim() === ti) ds = dl.slice(1).join('\n').replace(/^\s+/, '');
  // Only where the ad never sectioned - LRN-SETUP-18.
  if (!rq && ds) {
    var kp = [], mv = [];
    ds.split('\n').forEach(function (L) {
      var t2 = L.replace(LEAD, '').trim();
      ((t2 && t2.length <= 150 && !/דרוש/.test(t2) && REQ_LN.test(t2)) ? mv : kp).push(L);
    });
    rq = mv.join('\n').trim();
    ds = kp.join('\n').trim();
  }
  var ct = locationOf(ti, ds + '\n' + rq);
  add(it, '__ai-jobid', 'alut-' + m[1]);
  add(it, '__ai-title', ti);
  if (ct.length) add(it, '__ai-location', ct.join(', '));
  if (ds) add(it, '__ai-description', ds);
  if (rq) add(it, '__ai-requirements', rq);
  if (fl.length > 1) add(it, '__ai-applicationInfo', JSON.stringify({ actionUrl: du, method: 'POST', fields: fl }));
  var a = document.createElement('a');
  a.className = '__ai-detailurl';
  a.href = du;
  it.appendChild(a);
}));
