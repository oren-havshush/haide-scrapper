// Pools listing pages /jobs/2..N and each row's ad (get_ad_info.php, "%sep%": id,number,title,desc,req,areas)
// ALL-OR-NOTHING. Id barakl-<printed number>. Drops area Relocation (abroad) and a row with no job number.
// Apply: the job's own CV form, one blob per job (LRN-FORM-13).
if (document.getElementById('haide-barakl')) return;
var T0 = Date.now();
var HE = '[א-ת]';
var TAG = { 'צפון': 'אזור צפון', 'דרום': 'אזור דרום', 'מרכז': 'אזור מרכז', 'השרון': 'אזור השרון', 'שפלה': 'אזור שפלה' };
// work-location cue places -> verbatim city.csv row + the tag areas it lies in
var PL = [
  ['תל אביב|Tel[ -]Aviv', 'תל אביב-יפו', 'מרכז'], ['בני ברק', 'בני ברק', 'מרכז'], ['באר שבע', 'באר שבע', 'דרום'],
  ['נתניה', 'נתניה', 'השרון'], ['אלקנה', 'אלקנה', 'יוש'], ['קריית מלאכי|קרית מלאכי', 'קרית מלאכי', 'דרום שפלה'],
  ['רמת גן|Ramat[ -]Gan', 'רמת גן', 'מרכז'], ['יקום', 'יקום', 'השרון'], ['ראשון לציון', 'ראשון לציון', 'מרכז שפלה'],
  ['אשדוד', 'אשדוד', 'דרום שפלה'], ['ראש העין', 'ראש העין', 'מרכז השרון'], ['רחובות', 'רחובות', 'מרכז שפלה'],
  ['חיפה', 'חיפה', 'צפון'], ['יוקנעם|יקנעם', 'יוקנעם', 'צפון'], ['כרמיאל', 'כרמיאל', 'צפון'], ['עין גב', 'עין גב', 'צפון'],
  ['רמת השרון', 'רמת השרון', 'השרון מרכז'], ['קיבוץ שמיר', 'קיבוץ שמיר', 'צפון'], ['הרצליה', 'הרצליה', 'השרון מרכז'],
  ['אור יהודה', 'אור יהודה', 'מרכז'], ['איירפורט סיטי|אירפורט סיטי', 'איירפורט סיטי', 'מרכז'],
  ['רעננה|Ra.?anana', 'רעננה', 'השרון'], ['ירושלים|Jerusalem', 'ירושלים', 'ירושלים'], ['הקריות|קריות', 'אזור צפון', 'צפון']
].map(function (p) {
  return { re: new RegExp('(?:^|[^א-תA-Za-z])(?:ו?[בל]?)(?:' + p[0] + ')(?!' + HE + ')', 'i'), row: p[1], areas: p[2].split(' ') };
});
var CUE = /מיקו[םמ]|ממוקמ|המשרה (?:נמצאת )?ב|העבודה ב|במשרדי החברה ב|Location|located (?:in|near)|based in|team in/i;
var OK1 = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var MATH = new RegExp('[' + String.fromCodePoint(0x1D400) + '-' + String.fromCodePoint(0x1D7FF) + ']', 'gu');
var WS = new RegExp('[ \\t' + String.fromCharCode(160) + ']+', 'g');
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var get = async function (url) {
  for (var a = 0; a < 2; a++) {
    try {
      var r = await fetch(url, { credentials: 'include' });
      if (r.ok && !r.redirected) return await r.text();
    } catch (e) {}
    await sleep(800);
  }
  return null;
};
var text = function (html) {
  var d = document.createElement('div');
  d.innerHTML = String(html || '').replace(/<br\s*\/?>[ \t]*\r?\n?/gi, '\n');
  return (d.textContent || '').split('\n').map(function (l) { return l.replace(WS, ' ').trim(); })
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
};
var rowsOf = function (doc) {
  return Array.prototype.map.call(doc.querySelectorAll('tr.board_line'), function (tr) {
    var m = /toggleBoardLine\((\d+)\)/.exec(tr.getAttribute('onclick') || '');
    var c = function (s) { var e = tr.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; };
    return { id: m ? m[1] : '', num: c('td.board_id'), cat: c('td.board_category'), title: c('td.board_title') };
  });
};
var rows = rowsOf(document);
if (!rows.length) return;
var last = 1;
document.querySelectorAll('.pager_links a[href]').forEach(function (a) {
  var m = /^\/jobs\/(\d+)$/.exec(a.getAttribute('href') || '');
  if (m && +m[1] > last) last = +m[1];
});
var fail = false, pages = [];
for (var n = 2; n <= last; n++) pages.push(n);
for (var i = 0; i < pages.length && !fail; i += 3) {
  var got = await Promise.all(pages.slice(i, i + 3).map(function (n) { return get('/jobs/' + n); }));
  got.forEach(function (h) {
    var rs = h ? rowsOf(new DOMParser().parseFromString(h, 'text/html')) : [];
    if (!rs.length) fail = true;
    rows = rows.concat(rs);
  });
}
if (fail || rows.some(function (r) { return !r.id; })) { console.warn('[barakl] listing page failed'); return; }
// the CV form, read once from the first job's apply page; job=<id> is set per job
var cvh = await get('/cv&id=' + rows[0].id);
var cvd = cvh && new DOMParser().parseFromString(cvh, 'text/html');
var fm = cvd && cvd.querySelector('form[action="/thankyou_cv"]');
if (!fm || !fm.querySelector('input[name="job"]')) { console.warn('[barakl] cv form not found'); return; }
var key = (/formKey_cv'\)\.value='(\d+)'/.exec(cvh) || [])[1] || '';
var FIELDS = [];
fm.querySelectorAll('input, select, textarea').forEach(function (f) {
  var ft = (f.tagName === 'INPUT' ? (f.getAttribute('type') || 'text') : f.tagName.toLowerCase()).toLowerCase();
  if (/^(submit|button|reset|image)$/.test(ft) || !f.name) return;
  var lb = f.id && fm.querySelector('label[for="' + f.id + '"]');
  var o = { name: f.name, label: (lb ? lb.textContent.replace(/:\s*$/, '').trim() : '') || f.getAttribute('title') || f.name,
    fieldType: ft, tagName: f.tagName, required: f.hasAttribute('required') };
  if (ft === 'hidden') o.value = f.name === 'formKey' ? key : (f.getAttribute('value') || '');
  FIELDS.push(o);
});
var ACT = new URL('/thankyou_cv', location.href).href;
var ads = {};
for (var j = 0; j < rows.length && !fail; j += 4) {
  await Promise.all(rows.slice(j, j + 4).map(async function (r) {
    var t = await get('/scripts/get_ad_info.php?id=' + r.id);
    var f = t ? t.split('%sep%') : [];
    if (f.length < 6 || f[0] !== r.id) fail = true; else ads[r.id] = f;
  }));
}
if (fail) { console.warn('[barakl] ad fetch failed'); return; }
var root = document.createElement('div');
root.id = 'haide-barakl';
root.style.display = 'none';
var dropped = [];
rows.forEach(function (r) {
  var f = ads[r.id], areas = text(f[5]).split(/\s*,\s*/).filter(Boolean);
  if (areas.indexOf('Relocation') >= 0 || !/^(JB-)?\d+$/.test(r.num)) { dropped.push(r.id + ':' + r.num); return; }
  var title = r.title.replace(MATH, function (c) { return c.normalize('NFKC'); });
  if (!OK1.test(title) || BAD.test(title)) { dropped.push(r.id + ':' + r.num + ':lang'); return; }
  var desc = text(f[3]), req = text(f[4]);
  var cue = [title].concat((desc + '\n' + req).split('\n').filter(function (l) { return CUE.test(l); })).join('\n');
  var tags = areas.filter(function (a) { return TAG[a]; });
  var hit = PL.filter(function (p) { return p.re.test(cue); });
  // owner 2026-10-13: the site has no Jerusalem tag, so a Jerusalem cue wins over the tag
  var inside = hit.some(function (p) { return p.areas.some(function (a) { return tags.indexOf(a) >= 0 || a === 'ירושלים'; }); });
  var loc = !tags.length ? hit.map(function (p) { return p.row; })
    : inside ? hit.map(function (p) { return p.row; }) : tags.map(function (a) { return TAG[a]; });
  loc = loc.filter(function (v, k) { return loc.indexOf(v) === k; });
  var url = new URL('/cv&id=' + r.id, location.href).href;
  var blob = JSON.stringify({ actionUrl: ACT, actionAttribute: '/thankyou_cv', formClass: 'mailer', formTag: 'form',
    method: 'POST', enctype: 'multipart/form-data', pageUrl: url,
    fields: FIELDS.map(function (o) { var c = Object.assign({}, o); if (c.name === 'job') c.value = r.id; return c; }) });
  var it = document.createElement('div');
  it.className = 'haide-job';
  var add = function (cls, v) { var s = document.createElement('span'); s.className = cls; s.textContent = v; it.appendChild(s); };
  var a = document.createElement('a');
  a.className = 'haide-link'; a.href = url; a.textContent = title;
  it.appendChild(a);
  add('__ai-externalJobId', 'barakl-' + r.num);
  add('__ai-department', r.cat);
  if (desc) add('__ai-description', desc);
  if (req) add('__ai-requirements', req);
  add('__ai-location', loc.length ? loc.join(', ') : 'Unknown');
  add('__ai-applicationInfo', blob);
  add('__ai-formData', blob);
  root.appendChild(it);
});
document.body.appendChild(root);
console.log('[barakl] pages ' + last + ', rows ' + rows.length + ', jobs ' + root.children.length + ', dropped ' + dropped.join(' ') + ', ' + (Date.now() - T0) + ' ms');
