// leumi.co.il /leumi_main/searchjobs (Drupal, server-rendered), listing-only, no detail visits.
// Each job is a div.table-row (checkbox value = Drupal node id, title button, area tags, hidden
// input#job_data_<nid> = the apply token) followed by its sibling div.full-job (full body inline).
// This script reads the sibling and injects hidden .__ai-* fields into the row.
//
// - externalJobId: the Drupal node id as leumi-<nid> (LRN-ID-5, decided 2026-10-18: the printed number
//   repeats across jobs, so the CMS record id is used; re-keyed from h- ids on 2026-10-19).
// - detailUrl: the job page /he/about/career/Job/<nid>.
// - title: as printed, minus the printed number phrase at the end (job body rule 7).
// - description: div.job-description-text without its display:none block; label-only lines
//   (תיאור התפקיד:) dropped; a "כישורים נדרשים" run inside it moves to requirements;
//   then כפיפות / ממשקים lines, then the closing note printed on every job.
// - requirements: the run above + div.job-requirements-text (a work-location line printed there
//   moves to the description).
// - department: the מערך/חטיבה link, when printed.
// - location: the area tags as printed (" | "), read through the config's locationMap. A
//   work-location cue line ("מיקום המשרה: ...", "המשרה ב...") naming a place inside one of the
//   job's tags replaces the tags with that place (four-case rule, case 1).
// - applicationInfo: the job's own apply link, built exactly as the page's click builds it
//   (career-form.js: career_url_iframe + "?job=" + the job_data token).
var ITEM_SEL = '.table-body > .table-row';
var SPLIT_CS = true;   // "המרכז והשפלה" -> two labels, המרכז + השפלה (both regions)
var TITLE_CUE = true;  // a specific city in the title counts as a cue line (owner 2026-10-18); region words never (PLACES holds cities only)
var APPLY_BASE = (typeof career_url_iframe === 'string' && career_url_iframe) ? career_url_iframe : 'https://leumiservices.bankleumi.co.il/career/#/';
var PLACES = [
  [/ראשון לציון|ראשל"צ|ראשל״צ/, 'ראשון לציון', 'המרכז והשפלה'],
  [/ירושלים/, 'ירושלים', 'ירושלים והסביבה'],
  [/אשקלון/, 'אשקלון', 'דרום'],
  [/(^|[\s,.:])לוד([\s,.(]|$)/, 'לוד', 'המרכז והשפלה'],
  [/רמת גן|(^|[\s,])ר"ג/, 'רמת גן', 'המרכז והשפלה'],
  [/תל אביב|(^|[\s,])ת"א/, 'תל אביב', 'המרכז והשפלה'],
  [/נתניה/, 'נתניה', 'השרון'],
  [/חיפה/, 'חיפה', 'צפון']
];
var CUE = /^(מיקום(\s+המשרה)?\s*[:\-–]|המשרה\s+ב)/;
var LABEL_ONLY = /^(תיאור|תאור)\s+(ה?משרה|ה?תפקיד|ה?יחידה|כללי)\s*[:\-]?\s*$|^מהות התפקיד\s*:?\s*$/;
var REQ_HEAD = /^(כישורים נדרשים|דרישות( התפקיד| המשרה| חובה)?)\s*:?\s*$/;
var NUM_TAIL = /\s*[-–]?\s*(מס['׳]?\s*משרה\s*)?\d{3,5}\s*$/;
var HEB_LAT = new RegExp('(?=\\p{L})[\\p{sc=Hebrew}\\p{sc=Latin}]', 'u');
var OTHER = new RegExp('(?![\\p{sc=Hebrew}\\p{sc=Latin}\\p{sc=Common}\\p{sc=Inherited}])\\p{L}', 'u');

var prev = -1, stable = 0;
for (var t = 0; t < 40; t++) {
  var n0 = document.querySelectorAll(ITEM_SEL).length;
  if (n0 > 0 && n0 === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n0;
  await new Promise(function (r) { setTimeout(r, 250); });
}

var clean = function (s) { return String(s || '').replace(/\s+/g, ' ').trim(); };
var lines = function (el) {
  if (!el) return [];
  var c = el.cloneNode(true);
  var all = c.querySelectorAll('*');
  for (var i = 0; i < all.length; i++) {
    if (/display\s*:\s*none/i.test(all[i].getAttribute('style') || '')) all[i].remove();
  }
  c.querySelectorAll('ul,ol').forEach(function (u) {
    Array.prototype.slice.call(u.childNodes).forEach(function (x) { if (x.nodeType === 3 && !x.textContent.trim()) x.remove(); });
  });
  c.querySelectorAll('p,div,ul,ol,li,br,h1,h2,h3,h4,h5,h6,tr').forEach(function (e) { e.insertAdjacentText('afterend', '\n'); });
  return c.textContent.split('\n').map(function (s) { return s.replace(/[\s ]+/g, ' ').trim(); });
};
var join = function (arr) {
  var out = [], blank = false;
  for (var i = 0; i < arr.length; i++) {
    if (!arr[i]) { blank = out.length > 0; continue; }
    if (blank) out.push('');
    out.push(arr[i]);
    blank = false;
  }
  return out.join('\n');
};
var put = function (row, cls, val, tag) {
  var e = document.createElement(tag || 'span');
  e.className = cls;
  e.style.display = 'none';
  if (tag === 'a') e.setAttribute('href', val); else e.textContent = val;
  row.appendChild(e);
};

var rows = document.querySelectorAll(ITEM_SEL);
for (var r = 0; r < rows.length; r++) {
  var row = rows[r];
  if (row.querySelector('.__ai-title')) continue;
  var fj = row.nextElementSibling;
  if (!fj || !fj.classList.contains('full-job')) continue;
  var cb = row.querySelector('input[name="job_checkbox"]');
  var nid = cb ? clean(cb.value) : '';
  var rawTitle = clean((row.querySelector('.role button') || {}).textContent);
  if (!rawTitle || !/^\d+$/.test(nid)) continue;
  if (!HEB_LAT.test(rawTitle) || OTHER.test(rawTitle)) { row.classList.add('__ai-dropped'); continue; }
  var title = rawTitle.replace(NUM_TAIL, '').trim() || rawTitle;

  // description lines, with the requirements run moved out
  var dl = lines(fj.querySelector('.job-description-text'));
  var desc = [], req = [], inReq = false, cueLines = [];
  for (var i = 0; i < dl.length; i++) {
    var l = dl[i];
    if (!l) { inReq = false; desc.push(''); continue; }
    if (CUE.test(l)) cueLines.push(l);
    if (REQ_HEAD.test(l)) { inReq = true; continue; }
    if (inReq) { req.push(l); continue; }
    if (LABEL_ONLY.test(l)) continue;
    desc.push(l);
  }
  // a work-location line printed inside the requirements block is not a requirement: it moves to the description
  var rq = [];
  lines(fj.querySelector('.job-requirements-text')).filter(Boolean).forEach(function (x) {
    if (CUE.test(x)) { cueLines.push(x); desc.push('', x); } else rq.push(x);
  });
  if (req.length && rq.length) req.push('');
  req = req.concat(rq);
  var sub = clean((fj.querySelector('.job-subordination-text') || {}).textContent);
  var itf = clean((fj.querySelector('.job-interfaces-text') || {}).textContent);
  var tail = [];
  if (sub) tail.push('כפיפות: ' + sub);
  if (itf) tail.push('ממשקים: ' + itf);
  var clar = lines(fj.querySelector('.job-clarification-text')).filter(Boolean);
  var description = join(desc.concat([''], tail, [''], clar));
  var requirements = join(req);

  // location: tags, or a cue-line place inside one of the tags
  var tags = (((row.querySelector('.area span') || {}).textContent) || '').split('\n').map(clean).filter(Boolean);
  if (TITLE_CUE) cueLines.push(rawTitle);
  var place = null;
  for (var c = 0; c < cueLines.length && !place; c++) {
    for (var p = 0; p < PLACES.length; p++) {
      if (PLACES[p][0].test(cueLines[c]) && tags.indexOf(PLACES[p][2]) >= 0) { place = PLACES[p][1]; break; }
    }
  }
  var labels = [];
  if (place) labels = [place];
  else tags.forEach(function (tg) {
    if (SPLIT_CS && tg === 'המרכז והשפלה') labels.push('המרכז', 'השפלה'); else labels.push(tg);
  });

  var dept = clean((fj.querySelector('.department-text a') || {}).textContent);
  var tok = document.getElementById('job_data_' + nid);
  var tokVal = tok ? (tok.getAttribute('value') || '').trim() : '';

  put(row, '__ai-id', 'leumi-' + nid);
  put(row, '__ai-title', title);
  put(row, '__ai-url', 'https://www.leumi.co.il/he/about/career/Job/' + nid, 'a');
  if (description) put(row, '__ai-description', description);
  if (requirements) put(row, '__ai-requirements', requirements);
  if (dept) put(row, '__ai-department', dept);
  if (labels.length) put(row, '__ai-location', labels.join(' | '));
  if (tokVal) put(row, '__ai-apply', APPLY_BASE + '?job=' + tokVal);
}
