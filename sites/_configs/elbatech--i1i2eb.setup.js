// elbatech.co.il/careers/?company-name=elipse-engineering: Elipse Engineering's own filter (server-side, one page,
// rows inline in #ajax-jobs-wrap). Id elipse-<printed "Position N">. Body split at the ad's own requirements
// heading. Location: the row's region tag, refined by a work-location line naming a city inside that region.
// Apply: the page's CF7 modal form, one blob per job, job-title / job-id / cv-email filled exactly as the page's
// own .btn-apply click handler fills them. The general "send us a CV" row (title כללי) is not a vacancy: left out.
if (document.getElementById('haide-elipse')) return;
var rows = [].slice.call(document.querySelectorAll('#ajax-jobs-wrap > .bi-system'));
if (!rows.length) return;
var BASE = location.href.split('#')[0];
var NB = String.fromCharCode(160);
var WS = new RegExp('[ \\t' + NB + ']+', 'g');
var OK1 = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var MATH = new RegExp('[' + String.fromCodePoint(0x1D400) + '-' + String.fromCodePoint(0x1D7FF) + ']', 'gu');
var clean = function (s) { return String(s || '').replace(WS, ' ').trim(); };
// --- body: lines from <br>-separated text; requirements start at the ad's own heading ---
var REQ = /^(דרישות(\s+(התפקיד|המשרה|תפקיד))?|כישורים(\s+דרושים)?|requirements|qualifications)\s*[:\-]?\s*$/i;
var LABEL = /^(תיאור\s+(ה)?תפקיד|הגדרת\s+(ה)?תפקיד|במסגרת\s+התפקיד|המשרה\s+כוללת|התפקיד\s+כולל|מאפיינים|responsibilities)\s*[:\-]?\s*$/i;
var split = function (el) {
  var c = el.cloneNode(true);
  c.querySelectorAll('br').forEach(function (b) { b.replaceWith('\n'); });
  c.querySelectorAll('p, div, li').forEach(function (b) { b.append('\n'); });
  var lines = (c.textContent || '').split('\n').map(clean).filter(Boolean);
  var d = [], r = [], inReq = false;
  lines.forEach(function (l) {
    if (REQ.test(l)) { inReq = true; return; }
    if (LABEL.test(l)) return;
    (inReq ? r : d).push(l);
  });
  return { lines: lines, d: d.join('\n'), r: r.join('\n') };
};
// --- location: tag -> region row; a city.csv place on a work-location line inside the tag's region wins ---
var TAG = { 'השרון': 'אזור השרון', 'השפלה': 'אזור שפלה', 'דרום': 'אזור דרום', 'גוש דן': 'אזור מרכז' };
// work-location cue: "מיקום המשרה ב…", "המשרה ממוקמת ב…", or the ad's opening line placing the hiring company
var CUE = /(מיקום\s+המשרה|המשרה\s+ממוקמת)/;
var LEAD = /(^|\s)ל?(חברה|חברת|מפעל|ארגון)(\s|$)/;
var END = '(?=$|[\\s.,;:)])';
var PL = [
  { re: new RegExp('(^|\\s)(ב|באזור\\s+)(פתח\\s+תקווה|פתח\\s+תקוה|פ"ת)' + END), row: 'פתח תקווה', areas: ['אזור מרכז'] },
  { re: new RegExp('(^|\\s)(ב|באזור\\s+)באר\\s+שבע' + END), row: 'באר שבע', areas: ['אזור דרום'] },
  // אשדוד: city.csv row region אזור שפלה; administratively in the Southern District, so a דרום tag holds it
  { re: new RegExp('(^|\\s)(ב|באזור\\s+)אשדוד' + END), row: 'אשדוד', areas: ['אזור שפלה', 'אזור דרום'] }
];
var place = function (tag, lines) {
  var hit = [];
  lines.forEach(function (l, i) {
    if (!(CUE.test(l) || (i === 0 && LEAD.test(l)))) return;
    PL.forEach(function (q) { if (q.re.test(l) && hit.indexOf(q) < 0) hit.push(q); });
  });
  var t = TAG[tag];
  if (!t) return hit.length ? hit.map(function (q) { return q.row; }) : ['Unknown'];
  var inside = hit.filter(function (q) { return q.areas.indexOf(t) >= 0; });
  return inside.length ? inside.map(function (q) { return q.row; }) : [t];
};
// --- the apply form as the page sends it ---
var fm = document.querySelector('#appJobModal form.wpcf7-form');
if (!fm || !fm.querySelector('input[name="job-id"]')) { console.warn('[elipse] apply form not found'); return; }
var FIELDS = [];
fm.querySelectorAll('input, select, textarea').forEach(function (e) {
  var ft = (e.tagName === 'INPUT' ? (e.getAttribute('type') || 'text') : e.tagName.toLowerCase()).toLowerCase();
  if (/^(submit|button|reset|image)$/.test(ft) || !e.name) return;
  var lb = (e.id && fm.querySelector('label[for="' + e.id + '"]')) || e.closest('label');
  var o = { name: e.name, label: clean((lb ? lb.textContent : '') || e.getAttribute('placeholder') || e.name),
    fieldType: ft, tagName: e.tagName, required: e.hasAttribute('required') || e.getAttribute('aria-required') === 'true' };
  if (ft === 'hidden') o.value = e.getAttribute('value') || '';
  FIELDS.push(o);
});
var ACT = new URL(fm.getAttribute('action') || '', BASE).href;
// --- the items ---
var root = document.createElement('div');
root.id = 'haide-elipse';
root.style.display = 'none';
var dropped = [];
rows.forEach(function (row) {
  var ta = row.querySelector('ul li a');
  var title = clean(ta ? ta.textContent : '').replace(MATH, function (ch) { return ch.normalize('NFKC'); });
  var num = (clean((row.querySelector('.Position-title') || {}).textContent).match(/^Position\s+(\d+)$/i) || [])[1] || '';
  var ap = row.querySelector('.btn-apply');
  if (!title) { dropped.push((num || '?') + ':notitle'); return; }
  if (title === 'כללי') { dropped.push(num + ':general'); return; }
  if (!OK1.test(title) || BAD.test(title)) { dropped.push(num + ':lang'); return; }
  var s = split(row.querySelector('.paragraph') || document.createElement('div'));
  if (!s.d && !s.r) { dropped.push(num + ':empty'); return; }
  var tag = clean((row.querySelector('ul li > span') || {}).textContent);
  var loc = place(tag, s.lines);
  var vals = { 'job-title': ap ? ap.getAttribute('data-job-title') || '' : '', 'job-id': ap ? ap.getAttribute('data-job-id') || '' : '',
    'cv-email': ap ? ap.getAttribute('data-cv-email') || '' : '' };
  var blob = JSON.stringify({ actionUrl: ACT, actionAttribute: ACT, formClass: fm.getAttribute('class') || '', formTag: 'form',
    method: 'POST', enctype: 'multipart/form-data', pageUrl: BASE,
    fields: FIELDS.map(function (o) { var k = Object.assign({}, o); if (k.name in vals) k.value = vals[k.name]; return k; }) });
  var it = document.createElement('div');
  it.className = 'haide-job';
  var add = function (cls, v) { var e = document.createElement('span'); e.className = cls; e.textContent = v; it.appendChild(e); };
  var a = document.createElement('a');
  a.className = 'haide-link';
  a.href = BASE + '#position-' + (num || encodeURIComponent(title));
  a.textContent = title;
  it.appendChild(a);
  if (num) add('__ai-externalJobId', 'elipse-' + num);
  if (s.d) add('__ai-description', s.d);
  if (s.r) add('__ai-requirements', s.r);
  add('__ai-location', loc.join(', '));
  add('__ai-applicationInfo', blob);
  add('__ai-formData', blob);
  root.appendChild(it);
});
document.body.appendChild(root);
console.log('[elipse] rows ' + rows.length + ', jobs ' + root.children.length + ', dropped ' + dropped.join(' '));
