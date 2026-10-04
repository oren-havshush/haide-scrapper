// PwC Israel careers (Next.js static export over niloo-server). Listing: build one
// card per job from the same get-jobs call the page makes ("כל התחומים" shows all of
// them). Detail (/job?jid=N): inject the body from get-job and wait for the apply form.
var API = 'https://niloo-server.herokuapp.com/actions-pwc-career';
var call = async function (body) {
  var r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
};
var span = function (host, cls, val) {
  var s = document.createElement('span');
  s.className = cls; s.style.display = 'none'; s.textContent = val == null ? '' : String(val);
  host.appendChild(s);
};
var toText = function (escaped) {
  var t = document.createElement('textarea');
  t.innerHTML = escaped || '';
  var doc = new DOMParser().parseFromString(t.value, 'text/html');
  var c = doc.body;
  var BLOCK = 'p,div,ul,ol,li,br,h1,h2,h3,h4,h5,h6,tr';
  c.querySelectorAll(BLOCK).forEach(function (e) {
    var prev = e.previousSibling;
    if (prev && /\S/.test(prev.textContent) && !(prev.nodeType === 1 && prev.matches(BLOCK))) e.insertAdjacentText('beforebegin', '\n');
    e.insertAdjacentText('afterend', '\n');
  });
  var out = (c.textContent || '').split(String.fromCharCode(160)).join(' ').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return /[\p{L}\p{N}]/u.test(out) ? out : '';
};
// A requirements label alone on the first line is dropped; "Label:" glued to text loses the label.
var REQ_LABEL = /^(requirements|required qualifications( & technical skills)?|qualifications|what you bring|דרישות(\s+(התפקיד|המשרה))?)\s*:?\s*/i;
var dropLabel = function (s) {
  var lines = s.split('\n');
  var m = REQ_LABEL.exec(lines[0]);
  if (m && (m[0].length === lines[0].length || /:\s*$/.test(m[0]))) lines[0] = lines[0].slice(m[0].length);
  return lines.join('\n').replace(/^\s+/, '');
};
// A requirements-class heading inside the description moves it (and what follows) to requirements.
var DESC_REQ_HEAD = /^(what we'?re looking for|requirements|required qualifications|qualifications|דרישות(\s+(התפקיד|המשרה))?)\s*:?$/i;

if (location.pathname.indexOf('/job') === 0) {
  if (document.getElementById('__ai-detail')) return;
  var jid = new URLSearchParams(location.search).get('jid');
  if (!jid) return;
  var j = await call({ cmd: 'get-job', data: { jid: jid } });
  var desc = toText(j && j.description);
  var reqs = toText(j && j.requirements);
  var skills = toText(j && j.skills);
  var dl = desc.split('\n'), moved = '';
  for (var i = 0; i < dl.length; i++) {
    if (DESC_REQ_HEAD.test(dl[i].trim())) {
      moved = dl.slice(i + 1).join('\n').trim();
      desc = dl.slice(0, i).join('\n').trim();
      break;
    }
  }
  reqs = [moved, dropLabel(reqs), skills].filter(Boolean).join('\n\n');
  var box = document.createElement('div');
  box.id = '__ai-detail'; box.style.display = 'none';
  span(box, '__ai-description', desc);
  span(box, '__ai-requirements', reqs);
  document.body.appendChild(box);
  for (var w = 0; w < 40 && !document.querySelector('form input[name="employeeFullname"]'); w++) {
    await new Promise(function (r) { setTimeout(r, 250); });
  }
  return;
}

if (document.getElementById('__ai-jobs')) return;
var jobs = await call({ cmd: 'get-jobs' });
var cats = {};
try { (await call({ cmd: 'get-categories' })).forEach(function (c) { cats[String(c.value)] = String(c.text).trim(); }); } catch (e) {}
cats['43'] = cats['43'] || 'התמחות';
// jobArea is the page's own location filter; city names verbatim from city.csv.
var AREA = { '1': 'תל אביב-יפו', '2': 'חיפה', '3': 'ירושלים', '4': 'באר שבע' };
// Location (manager rule, 2026-10-04): the card tag wins. The tags are the four office cities, not
// general areas, so a place named in the text never overrides them (pwc-642 שוהם, pwc-514 הקריות -> חיפה).
var KEEP = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u;
var FOREIGN = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var MATH = new RegExp('[' + String.fromCodePoint(0x1D400) + '-' + String.fromCodePoint(0x1D7FF) + ']', 'gu');
var list = document.createElement('div');
list.id = '__ai-jobs'; list.style.display = 'none';
(Array.isArray(jobs) ? jobs : []).forEach(function (x) {
  if (!x || x.jobId == null || String(x.status) !== '1') return;
  var title = String(x.jobTitle || '').replace(MATH, function (c) { return c.normalize('NFKC'); }).trim();
  if (!title || !KEEP.test(title) || FOREIGN.test(title)) return;
  var loc = AREA[String(x.jobArea)] || 'Unknown';
  var card = document.createElement('div');
  card.className = '__ai-job';
  span(card, '__ai-title', title);
  span(card, '__ai-id', 'pwc-' + x.jobId);
  span(card, '__ai-location', loc);
  span(card, '__ai-date', String(x.openDate || '').slice(0, 10));
  span(card, '__ai-dept', cats[String(x.categoryId)] || '');
  var a = document.createElement('a');
  a.className = '__ai-link';
  a.href = '/job?jid=' + encodeURIComponent(x.jobId);
  a.textContent = title;
  card.appendChild(a);
  list.appendChild(card);
});
document.body.appendChild(list);
