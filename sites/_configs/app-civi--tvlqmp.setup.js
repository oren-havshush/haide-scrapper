// keshet-teamim (Civi W8PF7U4EUE/12790). addsite2 §6.2 language gate, LRN-LANG-1:
// keep a card only if its TITLE has a Hebrew or Latin letter and no letter of any
// other script (Common/Inherited are neutral). Most roles are also posted in Russian.
// Build symbols with String.fromCharCode: a backslash-u escape here decodes to a raw char.
var C = String.fromCharCode;
var SEL = '.proflist .thumb';
var KEEP = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u;
var ALIEN = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var PIN = C(0xd83d, 0xdccd);
var NBSP = C(0xa0);
// NB: the dash must stay LAST: '+-' before another char is a RANGE that swallows
// Hebrew, which silently emptied every heading test.
var LEAD = new RegExp('^[\\s*>' + C(0x2022) + C(0x25aa) + C(0x2714) + C(0x2705) + C(0x23f0) + C(0x270d) + C(0x200e) + C(0x200f) + '+-]+');
var DESC_LABEL = /^(?:תיאור\s+(?:התפקיד|המשרה|העבודה)|תחומי\s+אחריות(?:\s+בתפקיד\s+כוללים)?|התפקיד\s+כולל)\s*:?\s*$/;
var REQ_LABEL = /^(?:דרישות(?:\s+התפקיד|\s+המשרה)?|כישורים(?:\s+נדרשים)?|הדרישות)\s*:?\s*$/;
var REQ_HEAD = /^(?:דרישות(?:\s+התפקיד|\s+המשרה)?|כישורים(?:\s+נדרשים)?|הדרישות)\s*:/;
var OTHER_HEAD = /^(?:לתשומת\s+לב|תנאים\s+והטבות|מה\s+אנחנו\s+מציעים|היקף\s+משרה|שעות\s+העבודה|העבודה\s+במשמרות|עבודה\s+במשמרות|רלוונטי|מיקום)/;
// Not city.csv places; the ad prints the town in parens. An unknown one is dropped.
var BRANCH_CITY = { 'פולג': 'נתניה' };

function textOf(el) {
  if (!el) return '';
  var h = el.innerHTML.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(?:p|div|li|tr)>/gi, '\n');
  var d = document.createElement('div');
  d.innerHTML = h;
  var s = d.textContent || '';
  return s.split(NBSP).join(' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Owner field-split: requirements MOVED, never duplicated; field labels dropped.
function splitBody(body, startInReq) {
  var blocks = body.split(/\n\s*\n/);
  var inReq = !!startInReq, desc = [], req = [];
  for (var i = 0; i < blocks.length; i++) {
    var lines = blocks[i].split('\n');
    var head = (lines[0] || '').replace(LEAD, '').trim();
    if (REQ_HEAD.test(head)) {
      inReq = true;
      if (REQ_LABEL.test(head)) lines = lines.slice(1);
      else lines[0] = head.replace(REQ_HEAD, '').trim();
    } else if (OTHER_HEAD.test(head) || DESC_LABEL.test(head)) {
      inReq = false;
      if (DESC_LABEL.test(head)) lines = lines.slice(1);
    }
    var b = lines.join('\n').replace(/^\n+|\n+$/g, '');
    if (b.trim()) (inReq ? req : desc).push(b);
  }
  return { d: desc.join('\n\n').trim(), r: req.join('\n\n').trim() };
}

// Long pin segments are sentences, never fed whole: "המרכז הרובוטי" hits alias מרכז.
function citiesOf(body) {
  var out = [];
  function add(v) {
    v = (v || '').trim();
    if (v && out.indexOf(v) < 0) out.push(v);
  }
  var lines = body.split('\n');
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].indexOf(PIN) < 0) continue;
    var segs = lines[i].split(PIN);
    for (var j = 0; j < segs.length; j++) {
      var seg = segs[j].trim();
      if (!seg) continue;
      var loc = seg.match(/(?:ממוקם|נמצא)\s+ב(\S.*)$/);
      if (loc) { add(loc[1]); continue; }
      var t = seg.replace(/^סניף\s+/, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
      if (t && t.length <= 20) add(BRANCH_CITY[t] || t);
    }
  }
  var lbl = body.match(/מיקום\s*(?:ה?משרה)?\s*:\s*([^\n]{1,40})/);
  if (lbl) add(lbl[1]);
  var reg = body.match(/באזור\s+([^!.\n]{1,60})/);
  if (reg) add(reg[1]);
  return out;
}

function mk(cls, val) {
  var s = document.createElement('span');
  s.className = cls;
  s.textContent = val;
  return s;
}

function idOf(el) {
  var t = el.querySelector('.thumb-content');
  var m = t && (t.getAttribute('onclick') || '').match(/openPromo\(event,(\d+)/);
  return m ? m[1] : '';
}

// Paginates at 20 rows. Merge later pages by fetch (profRefresh() navigates and would
// kill this context); stop when a page adds no new id.
var list = document.querySelector('.proflist');
if (list && document.querySelectorAll(SEL).length >= 20) {
  var have = {}, cur = document.querySelectorAll(SEL);
  for (var i = 0; i < cur.length; i++) { var k0 = idOf(cur[i]); if (k0) have[k0] = 1; }
  for (var p = 2; p <= 25; p++) {
    var base = location.href;
    var u = base.replace(/([?&])p=\d+/, '$1p=' + p);
    if (u === base) u = base + '&p=' + p;
    var added = 0;
    try {
      var pd = new DOMParser().parseFromString(await (await fetch(u)).text(), 'text/html');
      var rows = pd.querySelectorAll(SEL);
      for (var q = 0; q < rows.length; q++) {
        var k = idOf(rows[q]);
        if (!k || have[k]) continue;
        have[k] = 1;
        list.appendChild(document.importNode(rows[q], true));
        added++;
      }
    } catch (e) {}
    if (!added) break;
  }
}

var items = [].slice.call(document.querySelectorAll(SEL));
await Promise.all(items.map(async function (item) {
  if (item.querySelector('.__ai-jobid')) return;
  var tc = item.querySelector('.thumb-content');
  var m = tc && (tc.getAttribute('onclick') || '').match(/openPromo\(event,(\d+),(\d+)/);
  if (!m) { item.remove(); return; }
  var jobId = m[1], srcId = m[2];
  var lt = (item.querySelector('.title') || {}).textContent || '';

  // Letters only: digits, punctuation and emoji are neutral; an unknown script drops.
  if (!KEEP.test(lt) || ALIEN.test(lt)) { item.remove(); return; }

  var title = lt.replace(/\s+/g, ' ').trim();
  var descr = '', req = '', fields = [];
  var du = 'https://app.civi.co.il/promo/id=' + jobId + '&src=' + srcId;
  try {
    var r = await fetch(du);
    var doc = new DOMParser().parseFromString(await r.text(), 'text/html');
    var dt = textOf(doc.querySelector('#je-title'));
    if (dt) title = dt.replace(/\s+/g, ' ').trim();
    var s1 = splitBody(textOf(doc.querySelector('#je-descr')), false);
    descr = s1.d;
    req = s1.r;
    var det = textOf(doc.querySelector('#je-details'));
    if (det) {
      var s2 = splitBody(det, true);
      if (s2.r) req = req ? req + '\n\n' + s2.r : s2.r;
      if (s2.d) descr = descr ? descr + '\n\n' + s2.d : s2.d;
    }
    fields.push({ name: 'Form_submitted', label: '', tagName: 'INPUT', required: false, fieldType: 'hidden' });
    var fds = doc.querySelectorAll('form.Form .field[data-id]');
    for (var k = 0; k < fds.length; k++) {
      var nm = fds[k].getAttribute('data-id');
      if (!nm) continue;
      var lab = fds[k].querySelector('.label');
      var inp = fds[k].querySelector('input, textarea, select');
      fields.push({
        name: nm,
        label: lab ? (lab.textContent || '').replace(/\*/g, '').replace(/\s+/g, ' ').replace(/\s*:\s*$/, '').trim() : '',
        tagName: inp ? inp.tagName : 'INPUT',
        required: !!(lab && lab.querySelector('.required')),
        fieldType: inp ? (inp.getAttribute('type') || inp.tagName.toLowerCase()) : 'text'
      });
    }
  } catch (e) {}

  // A detail page can answer 200 empty (LRN-SPA-11); .descr is the fallback.
  if (!descr) {
    var sf = splitBody(textOf(item.querySelector('.descr')), false);
    descr = sf.d;
    if (!req) req = sf.r;
  }

  var cities = citiesOf(descr + '\n' + req);
  item.appendChild(mk('__ai-jobid', 'keshet-teamim-' + jobId));
  item.appendChild(mk('__ai-title', title));
  if (cities.length) item.appendChild(mk('__ai-location', cities.join(', ')));
  if (descr) item.appendChild(mk('__ai-description', descr));
  if (req) item.appendChild(mk('__ai-requirements', req));
  if (fields.length > 1) item.appendChild(mk('__ai-applicationInfo', JSON.stringify({ actionUrl: du, method: 'POST', fields: fields })));
  var a = document.createElement('a');
  a.className = '__ai-detailurl';
  a.href = du;
  item.appendChild(a);
}));
