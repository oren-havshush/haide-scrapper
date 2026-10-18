// bynet.co.il/career/open-positions/: WordPress, theme block "open-position". One page, no pager, no job pages.
// Every job is a card .o-position__item[data-vacancy_id] (title only); the page's own script fills the modal
// #vacancyPopup from the inline JSON <script id="vacancies-data"> (an HR-system export). The modal shows the
// printed "מספר משרה" (order_id), the title (description), one area (living_area1) and the body (notes).
// Only those visible fields are read; recruiter, supervisor, salary and staffing fields in the JSON are never used.
// - Only cards a visitor sees: the script walks the cards and looks each one up in the JSON by order_id.
// - id: the printed job number, as bynet-<order_id>.
// - url: the page's own share link ?fd=<order_id>, which opens that job's modal.
// - body: notes split by its own headings; requirement sections go to requirements, field labels dropped,
//   location, hours, pay and closing lines stay in the description. Text as printed, line breaks kept.
// - location: the modal's area label (living_area1), read through the config's locationMap; a work-location
//   line ("מיקום: …", "המשרה ב…") naming a place inside that area replaces it (closed list).
// - date: the JSON's start_advertising_date (dd/mm/yyyy, the advertising start) as YYYY-MM-DD (owner 2026-10-18).
// - apply: the modal's CF7 form 16928, one blob per job, with vacancy-name / vacancy-id set as the page's own
//   script sets them; the reCAPTCHA v3 token is browser-made and stored empty.
if (document.getElementById('haide-bynet')) return;
var dataEl = document.getElementById('vacancies-data');
if (!dataEl) return;
var T0 = Date.now();
var DATA = [];
try { DATA = JSON.parse(dataEl.textContent || '[]'); } catch (e) { console.log('[bynet] JSON ' + e); return; }
var NB = String.fromCharCode(160);
var WS = new RegExp('[ \\t' + NB + ']+', 'g');
var OK1 = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var MATH = new RegExp('[' + String.fromCodePoint(0x1D400) + '-' + String.fromCodePoint(0x1D7FF) + ']', 'gu');
var clean = function (s) { return String(s || '').replace(WS, ' ').replace(/\s+/g, ' ').trim(); };
var P = '^[^A-Za-zא-ת]*';
var LABEL = new RegExp(P + '(תיאור התפקיד|דרישות( התפקיד| המשרה| סף)?|Requirements)\\s*[:?]?\\s*$');
var REQH = new RegExp(P + '(דרישות( התפקיד| המשרה| סף)?|Requirements|כישורים ותכונות נדרשות|מה אנחנו מחפשים|מה נדרש( כדי להצליח)?|מי מתאים לתפקיד|למי (התפקיד|המשרה) מתאימה|יתרון משמעותי( אם יש לך)?|יתרונות משמעותיים)\\s*[:?]?\\s*$');
var DESCH = new RegExp(P + '(תיאור התפקיד|התפקיד כולל|איך י+יראה|מה כולל התפקיד|מה בתפקיד|מה עושים בתפקיד|תחומי אחריות|Key Responsibilities|למה (להצטרף|דווקא|אצלנו)|פרטים נוספים)');
var TAIL = [new RegExp(P + '(מיקום|היקף משרה|משרה (חלקית|מלאה))'), /(^|[^א-ת])מיקום( המשרה)?:/, /המשרה מיועדת ל/, /(שכר|ש"ח)/,
  new RegExp(P + '(אם את|אם אתם|חושבים ש|הזדמנות|זו הזדמנות|משרה מאתגרת)'), /^North High-Tech Park/, /^[^A-Za-zא-ת0-9]*$/];
var split = function (notes) {
  var D = [], R = [], inR = false;
  String(notes || '').split('\n').forEach(function (raw) {
    var l = raw.replace(WS, ' ').trim();
    if (!l) return;
    var short = l.length < 45;
    if (short && REQH.test(l)) { inR = true; if (!LABEL.test(l)) R.push(l); return; }
    if (short && DESCH.test(l)) { inR = false; if (!LABEL.test(l)) D.push(l); return; }
    if (inR && !TAIL.some(function (re) { return re.test(l); })) { R.push(l); return; }
    D.push(l);
  });
  return { d: D.join('\n'), r: R.join('\n') };
};
// work-location lines only; each place is accepted only under the area labels that contain it
var CUE = /(מיקום|המשרה ב|משרה מלאה)/;
var PLACES = [
  ['רמת החייל', /(^|[^א-ת])ב?רמת החייל(?![א-ת])/, ['גוש דן']],
  ['עין כרמל', /(^|[^א-ת])ב?עין כרמל(?![א-ת])/, ['חיפה והקריות', 'צפון']]
];
var placeOf = function (notes, area) {
  var out = [];
  String(notes || '').split('\n').forEach(function (raw) {
    var l = raw.replace(WS, ' ').trim();
    if (!CUE.test(l)) return;
    PLACES.forEach(function (p) { if (p[1].test(l) && p[2].indexOf(area) >= 0 && out.indexOf(p[0]) < 0) out.push(p[0]); });
  });
  return out;
};
var fm = document.querySelector('#vacancyPopup form.wpcf7-form');
var formId = fm ? ((fm.querySelector('input[name="_wpcf7"]') || {}).value || '') : '';
var blobOf = function (v, pageUrl) {
  if (!fm || !/^\d+$/.test(formId)) return '';
  var fields = [];
  fm.querySelectorAll('input, select, textarea').forEach(function (e) {
    var ft = (e.tagName === 'INPUT' ? (e.getAttribute('type') || 'text') : e.tagName.toLowerCase()).toLowerCase();
    if (/^(submit|button|reset|image)$/.test(ft) || !e.name) return;
    var lab = e.getAttribute('placeholder') || '';
    if (ft === 'file') { var u = fm.querySelector('.upload-file__title'); if (u) lab = u.textContent; }
    var o = { name: e.name, label: clean(lab).replace(/\*$/, ''), fieldType: ft, tagName: e.tagName,
      required: e.hasAttribute('required') || e.getAttribute('aria-required') === 'true' };
    if (ft === 'hidden') o.value = e.getAttribute('value') || '';
    if (e.name === '_wpcf7_recaptcha_response') o.value = '';
    if (e.name === 'vacancy-name') { o.value = String(v.description || ''); o.label = 'vacancy-name'; }
    if (e.name === 'vacancy-id') { o.value = String(v.order_id); o.label = 'vacancy-id'; }
    if (ft === 'file' && e.getAttribute('accept')) o.accept = e.getAttribute('accept');
    fields.push(o);
  });
  return JSON.stringify({ actionUrl: location.origin + '/wp-json/contact-form-7/v1/contact-forms/' + formId + '/feedback',
    actionAttribute: fm.getAttribute('action') || '', formClass: fm.getAttribute('class') || '', formTag: 'form',
    method: 'POST', enctype: 'multipart/form-data', pageUrl: pageUrl, fields: fields });
};
var base = location.origin + location.pathname;
var root = document.createElement('div');
root.id = 'haide-bynet';
root.style.display = 'none';
var dropped = [];
document.querySelectorAll('.o-position__item[data-vacancy_id]').forEach(function (card) {
  var id = String(card.getAttribute('data-vacancy_id') || '').trim();
  if (!/^\d+$/.test(id)) return;
  var v = null;
  for (var i = 0; i < DATA.length; i++) { if (String(DATA[i].order_id) === id) { v = DATA[i]; break; } }
  if (!v) { dropped.push(id + ':nodata'); return; }
  var title = clean((card.querySelector('.o-position__item-title') || {}).textContent || v.description).replace(MATH, function (ch) { return ch.normalize('NFKC'); });
  if (!title) return;
  if (!OK1.test(title) || BAD.test(title)) { dropped.push(id + ':lang'); return; }
  var body = split(v.notes);
  var area = clean(v.living_area1);
  var places = placeOf(v.notes, area);
  var loc = places.length ? places.join(' | ') : area;
  var dm = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v.start_advertising_date || '').trim());
  var date = '';
  if (dm) { var dt = new Date(Date.UTC(+dm[3], +dm[2] - 1, +dm[1])); if (dt.getUTCDate() === +dm[1] && dt.getUTCMonth() === +dm[2] - 1 && +dm[3] > 2000) date = dm[3] + '-' + dm[2] + '-' + dm[1]; }
  var url = base + '?fd=' + id;
  // department: the visible profession filter's label for this card's data-filter_profession
  var pf = String(card.getAttribute('data-filter_profession') || '').trim(), dep = '';
  if (/^\d+$/.test(pf)) { var pl = document.querySelector('li[data-filter_profession="' + pf + '"] a'); if (pl) dep = clean(pl.textContent); }
  if (dep === 'אחר') dep = '';
  var blob = blobOf(v, url);
  var it = document.createElement('div');
  it.className = 'haide-job';
  var add = function (cls, val) { var e = document.createElement('span'); e.className = cls + ' wp-exclude-emoji'; e.textContent = val; it.appendChild(e); };
  add('haide-title', title);
  add('__ai-jobid', 'bynet-' + id);
  var a = document.createElement('a'); a.className = '__ai-url wp-exclude-emoji'; a.href = url; a.textContent = title; it.appendChild(a);
  if (body.d) add('__ai-description', body.d);
  if (body.r) add('__ai-requirements', body.r);
  if (loc) add('__ai-location', loc);
  if (date) add('__ai-date', date);
  if (dep) add('__ai-department', dep);
  if (blob) { add('__ai-applicationInfo', blob); add('__ai-formData', blob); }
  root.appendChild(it);
});
document.body.appendChild(root);
console.log('[bynet] cards ' + document.querySelectorAll('.o-position__item[data-vacancy_id]').length + ', jobs ' + root.children.length + ', dropped ' + dropped.join(' ') + ', ' + (Date.now() - T0) + ' ms');
