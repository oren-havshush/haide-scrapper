// a-one.co.il "כל המשרות" (/?s): every job on one page, its text inline. Recruiter for unnamed clients.
// Id a-one-<printed job number>. Body: paragraphs before the "דרישות התפקיד" heading -> description, after -> requirements.
// Location: the site's area filter (/?s=&area[]=<v>, one GET per area, ALL-OR-NOTHING) gives each job's tag label,
// read through the config's locationMap; a work-location cue line in the ad refines it (four-case rule).
// Date: the job page's JobPosting datePosted. Apply: the Gravity Forms popup (form 11), one blob per job whose
// "JOB NUMBERS" field (input_8) carries that job's number, as the page's own click handler fills it.
if (document.getElementById('haide-aone')) return;
var T0 = Date.now();
var ROWSEL = '.search-results .job-listing';
var prev = -1, stable = 0;
for (var t = 0; t < 20; t++) {
  var n0 = document.querySelectorAll(ROWSEL).length;
  if (n0 > 0 && n0 === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n0;
  await new Promise(function (r) { setTimeout(r, 300); });
}
var rows = Array.prototype.slice.call(document.querySelectorAll(ROWSEL));
if (!rows.length) return;
var fm = document.getElementById('gform_11');
if (!fm || !fm.querySelector('#input_11_8')) { console.warn('[a-one] apply form 11 not found'); return; }
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var get = async function (url) {
  for (var a = 0; a < 2; a++) {
    try {
      var r = await fetch(url, { credentials: 'include', cache: 'no-store' });
      if (r.ok && !r.redirected) return await r.text();
    } catch (e) {}
    await sleep(1000);
  }
  return null;
};
var OK1 = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var MATH = new RegExp('[' + String.fromCodePoint(0x1D400) + '-' + String.fromCodePoint(0x1D7FF) + ']', 'gu');
var NB = String.fromCharCode(160);
var clean = function (s) { return String(s || '').split(NB).join(' ').replace(/[ \t]+/g, ' ').trim(); };
var numOf = function (row) { var e = row.querySelector('.job-number'); return e ? clean(e.textContent) : ''; };
// the job's own page: the row's share link (one job's slug is "<n>-2"), else /job_listing/<n>/
var urlOf = function (row) {
  var s = row.querySelector('.share-link[data-share-url]'), u = s ? s.getAttribute('data-share-url') : '';
  try { u = new URL(u, location.href).href; } catch (e) { u = ''; }
  return u && new URL(u).host === location.host && /\/job_listing\//.test(u) ? u : location.origin + '/job_listing/' + numOf(row) + '/';
};
// --- area tags: one GET per area option; any failure builds no item ---
var areaOpts = Array.prototype.slice.call(document.querySelectorAll('#job-area option')).map(function (o) { return { v: o.value, label: clean(o.textContent) }; });
if (!areaOpts.length) { console.warn('[a-one] area filter not found'); return; }
var tags = {};
for (var i = 0; i < areaOpts.length; i++) {
  var h = await get(location.origin + '/?s=&area%5B%5D=' + encodeURIComponent(areaOpts[i].v));
  var d = h === null ? null : new DOMParser().parseFromString(h, 'text/html');
  // a search page: the filter form, and either the results list or the page's own "לא נמצאו תוצאות" (an empty area)
  var okPage = d && d.querySelector('#custom-filter-form') && (d.querySelector('.search-results') ||
    Array.prototype.some.call(d.querySelectorAll('.elementor-shortcode > p'), function (p) { return clean(p.textContent) === 'לא נמצאו תוצאות.'; }));
  if (!okPage) { console.warn('[a-one] area page failed: ' + areaOpts[i].label); return; }
  d.querySelectorAll('.job-listing .job-number').forEach(function (e) {
    var k = clean(e.textContent);
    (tags[k] = tags[k] || []).push(areaOpts[i].label);
  });
}
// --- dates: the job page's JobPosting datePosted, 6 at a time; a page that fails twice gives no date ---
var dates = {};
var queue = rows.filter(numOf);
var worker = async function () {
  while (queue.length) {
    var rw = queue.shift(), k = numOf(rw);
    var hh = await get(urlOf(rw));
    var m = hh && hh.indexOf('"JobPosting"') >= 0 ? hh.match(/"datePosted":"([^"]+)"/) : null;
    if (m) dates[k] = m[1];
  }
};
await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
// --- body ---
var structuredText = function (el) {
  var c = el.cloneNode(true);
  c.querySelectorAll('p,div,ul,ol,li,br,h1,h2,h3,h4,h5,h6,tr').forEach(function (e) { e.insertAdjacentText('afterend', '\n'); });
  return c.textContent;
};
var LABEL = /^\s*(תיאור התפקיד|תיאור|דרישות התפקיד|דרישות)\s*:?\s*$/;
var BACK = [/^[^\p{L}\d]*(מיקום|היקף המשרה|כפיפות)\s*:/u, /^[^\p{L}\d]*המשרה ממוקמת/u, /^[^\p{L}\d]*(זוהי )?הזדמנות/u];
var split = function (row) {
  var dd = row.querySelector('.job-dropdown');
  var D = [], R = [], after = false;
  if (!dd) return { d: [], r: [] };
  Array.prototype.forEach.call(dd.children, function (c) {
    if (c.tagName === 'H3' && /דרישות/.test(c.textContent)) { after = true; return; }
    if (c.tagName !== 'P') return;
    structuredText(c).split('\n').map(clean).filter(Boolean).forEach(function (l) { (after ? R : D).push(l); });
  });
  D = D.filter(function (l) { return !LABEL.test(l); });
  R = R.filter(function (l) { return !LABEL.test(l); });
  var back = R.filter(function (l) { return BACK.some(function (re) { return re.test(l); }); });
  R = R.filter(function (l) { return back.indexOf(l) < 0; });
  return { d: D.concat(back), r: R };
};
// --- location: cue lines only, through a closed table of city.csv rows ---
// re: any line; tre: the title's first segment, only after "ב" or "סניף"; lre: a short line that starts with the place
var C = function (src, row, regs) {
  return { re: new RegExp('(^|[^\\p{L}])[ובלמה]{0,2}(' + src + ')(?![\\p{L}])', 'u'),
    tre: new RegExp('(^|[^\\p{L}])(ב|לסניף |סניף )(' + src + ')(?![\\p{L}])', 'u'),
    lre: new RegExp('^[^\\p{L}]*(' + src + ')(?![\\p{L}])\\s*(\\||$)', 'u'), row: row, regs: regs };
};
var CITIES = [
  C('תל[ -]אביב(?:[ -]יפו)?|ת"א|ת״א', 'תל אביב-יפו', ['מרכז']), C('חיפה', 'חיפה', ['צפון']), C('הוד השרון', 'הוד השרון', ['שרון', 'מרכז']),
  C('רמת השרון', 'רמת השרון', ['שרון', 'מרכז']), C('מודיעין(?! עילית)', 'מודיעין', ['מרכז', 'שפלה', 'ירושלים והסביבה']),
  C('קרית מלאכי|קריית מלאכי', 'קרית מלאכי', ['שפלה', 'דרום']), C('גדרה', 'גדרה', ['שפלה']), C('הרצליה', 'הרצליה', ['שרון', 'מרכז']),
  C('רעננה', 'רעננה', ['שרון']), C('כפר סבא', 'כפר סבא', ['שרון']), C('נתניה', 'נתניה', ['שרון']), C('פתח תקו?וה', 'פתח תקווה', ['מרכז']),
  C('רמת גן', 'רמת גן', ['מרכז']), C('בני ברק', 'בני ברק', ['מרכז']), C('גבעתיים', 'גבעתיים', ['מרכז']), C('ראש העין', 'ראש העין', ['מרכז', 'שרון']),
  C('ירושלים', 'ירושלים', ['ירושלים והסביבה']), C('באר שבע', 'באר שבע', ['דרום']), C('רחובות', 'רחובות', ['שפלה', 'מרכז']),
  C('ראשון לציון', 'ראשון לציון', ['מרכז', 'שפלה']), C('חולון', 'חולון', ['מרכז']), C('אשדוד', 'אשדוד', ['שפלה', 'דרום']), C('חדרה', 'חדרה', ['שרון', 'צפון']),
  C('קיסריה', 'קיסריה', ['שרון', 'צפון'])];
var REGIONS = [C('(?:אזור |איזור )?השרון', 'אזור השרון'), C('(?:אזור |איזור )?השפלה', 'אזור שפלה'), C('(?:אזור |איזור )?המרכז|מרכז הארץ', 'אזור מרכז'),
  C('(?:אזור |איזור )?הצפון|צפון הארץ', 'אזור צפון'), C('(?:אזור |איזור )?הדרום|דרום הארץ', 'אזור דרום')];
var CUE = [/^[^\p{L}]*מיקום(?: המשרה)?\s*[:\-–]/u, /(המשרה|החברה|המשרד)\s+ממוקמ/, /סניף/,
  /^[^\p{L}]*(אזור|איזור)\s/u];
// cities first; a matched city is blanked so "הוד השרון" is not also read as the region "השרון"
var scan = function (s, out, key) {
  CITIES.forEach(function (c) { var m = s.match(c[key]); if (m) { out.c.push(c); s = s.replace(m[0], ' '); } });
  REGIONS.forEach(function (c) { if (c[key].test(s)) out.r.push(c.row); });
};
var placeOf = function (title, lines, tagL) {
  var out = { c: [], r: [] };
  // the title: its "|" segments after the first; in the first, a place after "ב" or "סניף" only
  title.split('|').forEach(function (seg, ix) { scan(seg, out, ix > 0 ? 're' : 'tre'); });
  lines.forEach(function (l) {
    if (CUE.some(function (re) { return re.test(l); }) || (l.length < 60 && CITIES.some(function (c) { return c.lre.test(l); }))) scan(l, out, 're');
  });
  var cities = [], cRegs = [];
  out.c.forEach(function (c) { if (cities.indexOf(c.row) < 0) { cities.push(c.row); cRegs.push(c.regs); } });
  var regs = out.r.filter(function (x, k) { return out.r.indexOf(x) === k; });
  if (!tagL.length) return cities.length ? cities : regs;
  if (!cities.length) return tagL;
  var inArea = cRegs.some(function (rg) { return rg.some(function (x) { return tagL.indexOf(x) >= 0; }); });
  return inArea ? cities : tagL;
};
// --- the apply blob ---
var FIELDS = [];
fm.querySelectorAll('li.gfield').forEach(function (li) {
  if (li.classList.contains('gform_validation_container') || li.classList.contains('gfield--type-honeypot')) return;
  var req = li.classList.contains('gfield_contains_required');
  var lab = clean((li.querySelector('.gfield_label') || {}).textContent).replace(/\*$/, '').trim();
  if (li.classList.contains('gfield--type-fileupload')) {
    FIELDS.push({ name: 'input_10', label: lab || 'קורות חיים', fieldType: 'file', required: req, tagName: 'INPUT', accept: '.pdf,.doc,.rtf,.docx' });
    return;
  }
  if (li.classList.contains('gfield--type-captcha')) return;
  li.querySelectorAll('input, select, textarea').forEach(function (e) {
    if (!e.name || e.closest('.moxie-shim')) return;
    var ft = (e.tagName === 'INPUT' ? (e.getAttribute('type') || 'text') : e.tagName.toLowerCase()).toLowerCase();
    if (/^(submit|button|reset|image)$/.test(ft)) return;
    var lb = e.id && fm.querySelector('label[for="' + e.id + '"]');
    var o = { name: e.name, label: clean(lb ? lb.textContent : '').replace(/\*$/, '').trim() || lab || e.name, fieldType: ft, required: ft !== 'hidden' && req, tagName: e.tagName };
    if (e.name === 'input_8') { o.fieldType = 'hidden'; o.required = false; }
    if (ft === 'hidden') o.value = e.getAttribute('value') || '';
    if (ft === 'checkbox') o.value = e.getAttribute('value') || '';
    FIELDS.push(o);
  });
});
fm.querySelectorAll('input[type=hidden]').forEach(function (e) {
  if (!e.name || e.closest('li.gfield') || FIELDS.some(function (f) { return f.name === e.name; })) return;
  FIELDS.push({ name: e.name, label: e.name, fieldType: 'hidden', required: false, tagName: 'INPUT', value: e.getAttribute('value') || '' });
});
FIELDS.push({ name: 'g-recaptcha-response', label: 'reCAPTCHA v2 token (browser-made)', fieldType: 'hidden', required: true, tagName: 'TEXTAREA', value: '' });
// --- the items ---
var root = document.createElement('div');
root.id = 'haide-aone';
root.style.display = 'none';
var dropped = [];
rows.forEach(function (row) {
  var num = numOf(row);
  var h3 = row.querySelector('.job-title h3');
  var title = clean(h3 ? h3.textContent : '').replace(MATH, function (ch) { return ch.normalize('NFKC'); });
  if (!num || !title) { dropped.push((num || '?') + ':empty'); return; }
  if (!OK1.test(title) || BAD.test(title)) { dropped.push(num + ':lang'); return; }
  var tg = tags[num] || [];
  if (tg.length && tg.every(function (x) { return x === 'חו״ל'; })) { dropped.push(num + ':abroad'); return; }
  var s = split(row);
  var url = urlOf(row);
  var loc = placeOf(title, s.d.concat(s.r), tg.filter(function (x) { return x !== 'חו״ל'; }));
  var blob = JSON.stringify({ actionUrl: url, actionAttribute: new URL(url).pathname, formClass: fm.getAttribute('class') || '', formTag: 'form',
    method: 'POST', enctype: 'multipart/form-data', pageUrl: url,
    fields: FIELDS.map(function (o) { var k = Object.assign({}, o); if (k.name === 'input_8') k.value = num; return k; }) });
  var it = document.createElement('div');
  it.className = 'haide-job wp-exclude-emoji';
  var add = function (cls, v) { var e = document.createElement('span'); e.className = cls + ' wp-exclude-emoji'; e.textContent = v; it.appendChild(e); };
  var a = document.createElement('a');
  a.className = 'haide-link wp-exclude-emoji'; a.href = url; a.textContent = title;
  it.appendChild(a);
  add('__ai-externalJobId', 'a-one-' + num);
  if (s.d.length) add('__ai-description', s.d.join('\n'));
  if (s.r.length) add('__ai-requirements', s.r.join('\n'));
  add('__ai-location', loc.join(' | '));
  if (dates[num]) add('__ai-publishDate', dates[num]);
  add('__ai-applicationInfo', blob);
  add('__ai-formData', blob);
  root.appendChild(it);
});
document.body.appendChild(root);
console.log('[a-one] rows ' + rows.length + ', areas ' + areaOpts.length + ', tagged ' + Object.keys(tags).length + ', dated ' + Object.keys(dates).length + ', jobs ' + root.children.length + ', dropped ' + (dropped.join(' ') || 'none') + ', ' + (Date.now() - T0) + ' ms');
