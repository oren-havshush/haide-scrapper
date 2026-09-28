// matan - Civi YDDG8SGXNC/14794. Symbols via String.fromCharCode: an escape
// here decodes to a raw char. #je-descr = description, #je-details = requirements.
var C = String.fromCharCode;
var SEL = '.proflist .thumb';
var NBSP = C(0xa0), G = C(0x5f4), HEBR = C(0x590) + '-' + C(0x5ff);
var TOK = new RegExp('[^' + HEBR + '@0-9]+');
// Labels only - the field already says what the text is.
var DESC_LBL = /^(?:מה\s+(?:כולל|עושים\s+ב)\s*ה?תפקיד|תיאור\s+ה?(?:תפקיד|משרה))\s*[?:]?\s*$/;
var REQ_LBL = /^(?:ה?דרישות(?:\s+ה?(?:תפקיד|משרה))?|כישורים(?:\s+נדרשים)?)\s*:?\s*$/;
// Closed table; each canonical is VERBATIM on city.csv AND the worker list.
// Titles only, whole-word, 1-2 prefix letters peeled. Off-table -> nothing (Unknown).
var PLACES = {};
('רמת גן;באר שבע;אופקים;נתיבות;שדרות;פתח תקווה|פתח תקוה;חיפה;' +
 'קרית מוצקין|קריית מוצקין;ירושלים;נתניה;אזור מרכז|מחוז מרכז').split(';').forEach(function (e) {
  var f = e.split('|');
  for (var i = 0; i < f.length; i++) PLACES[f[i]] = f[0];
});
var AB = [['פ' + G + 'ת', 'פתח תקווה'], ['פ"ת', 'פתח תקווה']];
var PRE = 'בלמוהכש';
function textOf(el) {
  if (!el) return '';
  var d = document.createElement('div');
  d.innerHTML = el.innerHTML.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(?:p|div|li|tr)>/gi, '\n');
  return (d.textContent || '').split(NBSP).join(' ')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function dropLabel(s, re) {
  var ln = s.split('\n');
  if (ln.length > 1 && re.test(ln[0].trim())) ln = ln.slice(1);
  return ln.join('\n').replace(/^\s+/, '').trim();
}
function placesIn(text) {
  var t = text || '';
  for (var a = 0; a < AB.length; a++) t = t.split(AB[a][0]).join(' @' + a + '@ ');
  var tk = t.split(TOK).filter(Boolean), out = [];
  for (var j = 0; j < tk.length; ) {
    var ab = tk[j].match(/^@(\d+)@$/), hit = ab ? AB[+ab[1]][1] : null, span = 1;
    for (var n = 2; n >= 1 && !hit; n--) {
      if (j + n > tk.length || (n === 2 && tk[j + 1].indexOf('@') >= 0)) continue;
      for (var p = 0; p <= 2 && !hit; p++) {
        if (p > 0 && PRE.indexOf(tk[j].charAt(p - 1)) < 0) break;
        var f1 = tk[j].slice(p), key = n === 2 ? f1 + ' ' + tk[j + 1] : f1;
        if (f1 && PLACES[key]) { hit = PLACES[key]; span = n; }
      }
    }
    if (hit) { if (out.indexOf(hit) < 0) out.push(hit); j += span; } else { j++; }
  }
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
// Civi pages at 20 - only follow it when the board shows a pager (profRefresh);
// profRefresh() itself would location.assign() this context away.
var list = document.querySelector('.proflist');
if (list && document.querySelectorAll(SEL).length >= 20 && document.body.innerHTML.indexOf('profRefresh(') >= 0) {
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
    ds = dropLabel(textOf(doc.querySelector('#je-descr')), DESC_LBL);
    rq = dropLabel(textOf(doc.querySelector('#je-details')), REQ_LBL);
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
  // A detail page can answer empty (LRN-SPA-11); the card preview is the fallback.
  if (!ds) ds = textOf(it.querySelector('.descr'));
  var ct = placesIn(ti);
  add(it, '__ai-jobid', 'matan-' + m[1]);
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
