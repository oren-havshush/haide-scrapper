/* Dun & Bradstreet Israel, BambooHR board dbil.bamboohr.com/careers (the board dbisrael.co.il/about/wanted/ links to).
   Listing-only: GET /careers/list, then GET /careers/<id>/detail per job; one hidden row per job in #haide-dbil.
   Every fetch: no cookies (credentials omit), 20 s limit, 2xx JSON only, no redirect. ALL-OR-NOTHING: a failed,
   timed-out, redirected, non-2xx or malformed answer, a count that differs from meta.totalCount, or a job not
   "Open" builds no row at all.
   - Id: the BambooHR opening id (native, ASCII; also the /careers/<id> address), namespaced dbil-<id> (LRN-ID-11).
   - Date: datePosted. Location: the job's BambooHR city (config locationMap -> city.csv row). Field work (owner
     2026-10-21): an ad line that is only "מיקום: שטח" / "Location: field" names no place -> label "שטח", mapped to
     null (Unknown), whatever the BambooHR city says.
   - Body: requirement headings -> requirements ("דרישות התפקיד" / "Requirements" label dropped; other headings kept
     as lines); "תיאור משרה" / "About the Role" labels dropped; a later description heading moves back. A job with no
     requirement heading: its last paragraph moves when at least half its lines read as requirements (LRN-SETUP-24).
     A gender line ("פונה לנשים וגברים") stays in the description. Text otherwise as printed.
   - Apply: the request the page sends (LRN-FORM-17): multipart POST /careers/<id>/add (the job is in the address),
     fields from the job's own formFields; CV uploaded first by the page, its temporary id sent as resumeFileId.
     reCAPTCHA v2 checkbox inside the rendered form (token browser-made). displayName / applicantHash / positionHash
     are computed by the page at submit. Honeypot nickname_hpcsaf: never filled. No consent box. */
if (document.getElementById('haide-dbil')) return;
var T0 = Date.now(), O = 'https://dbil.bamboohr.com', NL = String.fromCharCode(10);
var OK1 = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}]/u;
var BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var MATH = new RegExp('[' + String.fromCodePoint(0x1D400) + '-' + String.fromCodePoint(0x1D7FF) + ']', 'gu');
var INV = new RegExp('[' + String.fromCharCode(0xFEFF, 0x200B, 0x200C, 0x200D, 0x2060, 0x200E, 0x200F) + ']', 'g');
var NB = new RegExp(String.fromCharCode(0xA0), 'g');
var RH = /^(דרישות( התפקיד| המשרה| חובה)?|requirements|qualifications)[\s:?!.]*$/i;
var RK = /^(מה אנחנו מחפשים|מי מתאים לתפקיד|הכישורים האישיים שחשובים לנו|כישורים|יתרונות|advantages|what else matters to us)[\s:?!.]*$/i;
var DH = /^(תיאור (משרה|התפקיד|המשרה)|about the role)[\s:?!.]*$/i;
var DK = /^(למה להצטרף אלינו|הצלחה בתפקיד|what we offer|benefits)[\s:?!.]*$/i;
var GEN = /פונה לנשים וגברים|לנשים ולגברים כאחד/;
var FIELD = /^(מיקום|location)\s*:\s*(שטח|בשטח|field)\s*\.?$/i;
var RW = /^(ניסיון|נסיון|כושר|ידע|היכרות|הכרות|יכולת|תואר|שליטה|זמינות|אסרטיביות|תודעת|גישה|אנגלית|עברית)|יתרון\.?$/;
var sq = function (s) { return String(s == null ? '' : s).replace(INV, '').replace(NB, ' ').replace(/[ \t\r\f\v]+/g, ' ').trim(); };
var get = async function (path) {
  var ac = new AbortController(), k = setTimeout(function () { ac.abort(); }, 20000);
  try {
    var r = await fetch(O + path, { credentials: 'omit', cache: 'no-store', signal: ac.signal, headers: { Accept: 'application/json' } });
    if (!r.ok || r.redirected) throw new Error(r.status + (r.redirected ? ' redirected' : '') + ' ' + path);
    var j = JSON.parse(await r.text());
    if (!j || !j.result) throw new Error('no result ' + path);
    return j;
  } finally { clearTimeout(k); }
};
var pool = async function (xs, f) {
  var out = new Array(xs.length), i = 0;
  await Promise.all([0, 1, 2].map(async function () { while (i < xs.length) { var n = i++; out[n] = await f(xs[n]); } }));
  return out;
};
/* description HTML -> paragraphs of lines (a <p> splits on <br>; each <li> is one line) */
var paras = function (html) {
  var b = new DOMParser().parseFromString('<div>' + String(html || '') + '</div>', 'text/html').body.firstChild, P = [];
  var walk = function (el) {
    Array.from(el.childNodes).forEach(function (n) {
      if (n.nodeType === 3) { var t = sq(n.textContent); if (t) P.push([t]); return; }
      if (n.nodeType !== 1) return;
      var tag = n.tagName;
      if (tag === 'UL' || tag === 'OL') { var L = []; n.querySelectorAll('li').forEach(function (li) { var c1 = li.cloneNode(true); c1.querySelectorAll('br').forEach(function (x) { x.replaceWith(' '); }); var t = sq(c1.textContent); if (t) L.push(t); }); if (L.length) P.push(L); return; }
      if (tag === 'DIV' && n.querySelector('p,ul,ol,div')) { walk(n); return; }
      var c = n.cloneNode(true);
      c.querySelectorAll('br').forEach(function (x) { x.replaceWith(NL); });
      var L2 = c.textContent.split(NL).map(sq).filter(Boolean);
      if (L2.length) P.push(L2);
    });
  };
  walk(b);
  return P;
};
var body = function (html) {
  var P = paras(html), D = [], R = [], inR = false, hasR = false, pl = P.length - 1;
  P.forEach(function (L, pi) {
    L.forEach(function (l) {
      if (l.length <= 45 && DH.test(l)) { inR = false; return; }
      if (l.length <= 45 && RH.test(l)) { inR = true; hasR = true; return; }
      if (l.length <= 45 && RK.test(l)) { inR = true; hasR = true; R.push(l); return; }
      if (l.length <= 45 && DK.test(l)) inR = false;
      (inR && !GEN.test(l) ? R : D).push([pi, l]);
    });
  });
  if (!hasR && pl > 0) {
    var last = P[pl], hits = last.filter(function (l) { return RW.test(l); }).length;
    if (last.length >= 3 && hits * 2 >= last.length) {
      R = D.filter(function (x) { return x[0] === pl; }); D = D.filter(function (x) { return x[0] !== pl; });
    }
  }
  var txt = function (A) { return A.map(function (x) { return typeof x === 'string' ? x : x[1]; }).join(NL); };
  return { d: txt(D), q: txt(R) };
};
var TYPES = { email: 'email', phone: 'tel', websiteUrl: 'url', linkedinUrl: 'url', dateAvailable: 'date' };
var NAMES = { firstName: 'First Name', lastName: 'Last Name', email: 'Email', phone: 'Phone', resumeFileId: 'Resume' };
var ACC = '.pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.tif,.tiff,.gif,.png,.bmp,.txt,.rtf';
var blob = function (id, ff, page) {
  var F = [];
  Object.keys(ff).forEach(function (k) {
    var v = ff[k];
    if (Array.isArray(v)) {
      if (k === 'customQuestions') v.forEach(function (q) {
        var nm = 'customQuestions[' + q.id + ']', lab = sq(q.question), rq = !!q.isRequired;
        if (q.type === 'yes_no') F.push({ name: nm, fieldType: 'radio', label: lab, required: rq, tagName: 'input', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] });
        else if (q.type === 'multi') F.push({ name: nm, fieldType: 'radio', label: lab, required: rq, tagName: 'input', options: (q.options || []).map(function (o) { return { value: String(o.id), label: sq(o.option) }; }) });
        else if (q.type === 'checkbox') F.push({ name: nm, fieldType: 'checkbox', label: lab, required: rq, tagName: 'input' });
        else if (q.type === 'file') F.push({ name: nm + '[]', fieldType: 'file', label: lab, required: rq, tagName: 'input', accept: ACC });
        else F.push({ name: nm, fieldType: q.type === 'long' ? 'textarea' : 'text', label: lab, required: rq, tagName: q.type === 'long' ? 'textarea' : 'input' });
      });
      else if (v.length) throw new Error('form field ' + k + ' not modelled, job ' + id);
      return;
    }
    if (!v || typeof v !== 'object') return;
    var rec = { name: k, fieldType: TYPES[k] || 'text', label: sq(v.label || NAMES[k] || k), required: !!v.isRequired, tagName: 'input' };
    if (k === 'resumeFileId') { rec.fieldType = 'file'; rec.accept = ACC; }
    if (Array.isArray(v.options) && v.options.length) { rec.fieldType = 'select'; rec.tagName = 'select'; rec.options = v.options.map(function (o) { return { value: String(o.id), label: sq(o.text) }; }); }
    F.push(rec);
  });
  ['recaptchaToken', 'displayName', 'applicantHash', 'positionHash'].forEach(function (n) { F.push({ name: n, fieldType: 'hidden', label: '', required: false, tagName: 'input', value: '' }); });
  var act = O + '/careers/' + id + '/add';
  return JSON.stringify({ actionUrl: act, actionAttribute: act, pageUrl: page, method: 'POST', enctype: 'multipart/form-data', fields: F,
    honeypots: ['nickname_hpcsaf'], capturedAt: new Date().toISOString(), captureSource: 'script', extractorVersion: 3 });
};
var rows = [], drop = [];
try {
  var list = await get('/careers/list'), res = list.result, total = list.meta && list.meta.totalCount;
  if (!Array.isArray(res) || typeof total !== 'number' || res.length !== total) throw new Error('list ' + (res && res.length) + ' vs ' + total);
  rows = await pool(res, async function (it) {
    var id = String(it.id || '');
    if (!/^\d+$/.test(id)) throw new Error('id ' + id);
    var r = (await get('/careers/' + id + '/detail')).result, o = r.jobOpening;
    if (!o || o.jobOpeningStatus !== 'Open' || !r.formFields) throw new Error('detail ' + id);
    var href = O + '/careers/' + id;
    if (String(o.jobOpeningShareUrl || '').replace(/\/$/, '') !== href) throw new Error('share url ' + id);
    var b = body(o.description), dt = /^\d{4}-\d{2}-\d{2}$/.test(o.datePosted || '') ? o.datePosted : '';
    return { id: id, href: href, title: sq(o.jobOpeningName).replace(MATH, function (x) { return x.normalize('NFKC'); }),
      dept: sq(o.departmentLabel), emp: sq(o.employmentStatusLabel), loc: b.d.split(NL).concat(b.q.split(NL)).some(function (l) { return FIELD.test(l); }) ? 'שטח' : sq(o.location && o.location.city),
      d: b.d, q: b.q, date: dt, form: blob(id, r.formFields, href) };
  });
} catch (e) { console.log('[dbil] no rows built: ' + e); rows = []; }
var root = document.createElement('div');
root.style.display = 'none';
rows.forEach(function (j) {
  if (!j.title || !OK1.test(j.title) || BAD.test(j.title)) { drop.push(j.id); return; }
  var it = document.createElement('div'), add = function (k, v) { if (!v) return; var e = document.createElement('span'); e.className = k; e.textContent = v; it.appendChild(e); };
  it.className = 'haide-job';
  var a = document.createElement('a'); a.className = 'haide-link'; a.href = j.href; a.textContent = j.title; it.appendChild(a);
  add('__ai-externalJobId', 'dbil-' + j.id); add('__ai-department', j.dept); add('__ai-employmentType', j.emp);
  add('__ai-description', j.d); add('__ai-requirements', j.q); add('__ai-location', j.loc); add('__ai-publishDate', j.date);
  add('__ai-applicationInfo', j.form); add('__ai-formData', j.form);
  root.appendChild(it);
});
root.id = 'haide-dbil';
document.body.appendChild(root);
console.log('[dbil] jobs ' + root.children.length + ' of ' + rows.length + ', dropped ' + drop.join(' ') + ', ' + (Date.now() - T0) + ' ms');
