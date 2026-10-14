// meitavjob.co.il/Allsearch.aspx (recruiter, ads for unnamed clients). GET only, ALL-OR-NOTHING:
// the job list comes from the site's one-page view AllJobs.aspx?SearchView=All (this page's own
// "תצוגה בדף ארוך אחד" button), checked against this page's printed count; title, printed number and
// text from each job's own page jobdetails.aspx?JobID=N. Dates from the site's RSS where the job is in it.
// Id meitavjob-<printed מספר הזמנה>. Location: a place in the title or in the ad's placing line only.
// Apply: the ad's address and instruction go to applicationInfo with the job's number; an ad whose
// address is blank gets the site's company address (footer "דוא"ל החברה") - owner's call on the card.
if (document.getElementById('haide-meitav')) return;
if (!/\/allsearch\.aspx$/i.test(location.pathname)) return;
var T0 = Date.now();
var FALLBACK_COMPANY_MAIL = true;
var NB = String.fromCharCode(160);
var WS = new RegExp('[ \\t' + NB + ']+', 'g');
var OK1 = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var MATH = new RegExp('[' + String.fromCodePoint(0x1D400) + '-' + String.fromCodePoint(0x1D7FF) + ']', 'gu');
var PITCH = new RegExp('^[' + String.fromCodePoint(0x2728) + String.fromCodePoint(0x1F4CC) + ']', 'u');
var MAILRE = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var get = async function (url) {
  for (var a = 0; a < 3; a++) {
    try {
      // no cookie: with the ASP.NET session cookie the server answers one request at a time (~0.5 s each)
      var r = await fetch(url, { credentials: 'omit', cache: 'no-store' });
      if (r.ok && !r.redirected) return await r.text();
    } catch (e) {}
    await sleep(1500);
  }
  return null;
};
var parse = function (h, t) { return new DOMParser().parseFromString(h, t || 'text/html'); };
var cnt = document.getElementById('ContentPlaceHolder1_recCountAllJobs');
var TOTAL = cnt ? parseInt(cnt.textContent.replace(/\D/g, ''), 10) : NaN;
// --- the list ---
var all = await get(location.origin + '/AllJobs.aspx?SearchView=All');
var ids = [], seenId = {};
if (all) parse(all).querySelectorAll('span.AllJobsLink a[href*="JobID="]').forEach(function (a) {
  var m = /JobID=(\d+)/.exec(a.getAttribute('href') || '');
  if (m && !seenId[m[1]]) { seenId[m[1]] = 1; ids.push(m[1]); }
});
if (!(TOTAL > 0) || ids.length !== TOTAL) { console.warn('[meitav] list failed: total ' + TOTAL + ', rows ' + ids.length); return; }
// --- dates: RSS pubDate (a job not in the feed gets none) ---
var dates = {}, MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
var rss = await get(location.origin + '/LatestJobsRss.aspx');
if (rss) parse(rss, 'text/xml').querySelectorAll('item').forEach(function (it) {
  var l = it.querySelector('link'), p = it.querySelector('pubDate');
  var id = l && (/JobID=(\d+)/.exec(l.textContent) || [])[1];
  var m = p && /^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})/.exec(p.textContent.trim());
  if (id && m && MON[m[2]]) dates[id] = m[3] + '-' + String(MON[m[2]]).padStart(2, '0') + '-' + m[1].padStart(2, '0');
});
// --- each job's own page ---
var pages = {}, fail = false;
for (var i = 0; i < ids.length && !fail; i += 4) {
  var part = ids.slice(i, i + 4);
  var got = await Promise.all(part.map(function (id) { return get(location.origin + '/jobdetails.aspx?JobID=' + id); }));
  got.forEach(function (h, k) { if (h === null) fail = true; else pages[part[k]] = h; });
}
if (fail) { console.warn('[meitav] a job page failed'); return; }
// the site's company address (footer link labelled דוא"ל החברה, not the management one)
var co = Array.prototype.filter.call(document.querySelectorAll('a[href^="mailto:"]'), function (a) {
  return /החברה/.test(a.textContent) && !/הנהלת/.test(a.textContent);
})[0];
var COMAIL = co ? (MAILRE.exec(co.getAttribute('href')) || [''])[0] : '';
// --- text: split into description / requirements; apply and promo lines leave ---
var REQH = /^(דרישות|כישורים)[^:]{0,25}:?$/;
var DESCH = /^(תיאור\s*(ה)?תפקיד|תחומי אחריות|התפקיד כולל|עיקרי התפקיד)[^:]{0,20}:?$/;
var DROPLABEL = /^(דרישות|תיאור\s*(ה)?תפקיד)/;
// a labelled requirement line moves anywhere; a bare requirement word only outside a labelled description section
var REQLABEL = /^(השכלה|ניסיון|שפות|מחשב ומערכות)\s*[:\-]/;
var REQLINE = /^[-•*]?\s*(נדרש|נדרשת|נדרשים|חובה|השכלה|תואר|ידע)(\s|:|-|$)/;
var PROMO = /קיימת אפשרות לתרגל מבחן|יש היום\s*-?\s*אפשרות לעשות/;
var split = function (span) {
  var c = span.cloneNode(true);
  c.querySelectorAll('a[href*="logipass"], a[href*="mapalit"]').forEach(function (a) { a.remove(); });
  c.querySelectorAll('br').forEach(function (b) { b.replaceWith('\n'); });
  var lines = c.textContent.split('\n').map(function (l) { return l.replace(WS, ' ').trim(); });
  var d = [], r = [], mode = 'd', para = false, dsec = false, apply = '', ctx = [];
  lines.forEach(function (l) {
    if (!l) { para = false; (mode === 'r' ? r : d).push(''); return; }
    if (/^נא לשלוח לדוא/.test(l)) { apply = l; return; }
    if (PROMO.test(l)) return;
    ctx.push(l);
    if (PITCH.test(l)) { mode = 'd'; para = false; d.push(l); return; }
    if (REQH.test(l)) { mode = 'r'; para = false; dsec = false; if (!DROPLABEL.test(l)) r.push(l); return; }
    if (DESCH.test(l)) { mode = 'd'; para = false; dsec = true; if (!DROPLABEL.test(l)) d.push(l); return; }
    if (mode === 'd' && (para || REQLABEL.test(l) || (!dsec && REQLINE.test(l)))) { para = true; r.push(l); return; }
    (mode === 'r' ? r : d).push(l);
  });
  var j = function (a) { return a.join('\n').replace(/\n{3,}/g, '\n\n').trim(); };
  return { d: j(d), r: j(r), apply: apply, lines: ctx };
};
// --- location: closed list; title + "מיקום:" line + the client-placing line (לחברה/למפעל/למשרד ... ב<place>) ---
// owner 2026-10-14: a city wins over a Galilee word (35743); גליל עליון = the city.csv row "הגליל העליון";
// western Galilee (also the typos "בגלל המערבי", "בגלי להמערבי") and "בצפון" = אזור צפון
var CITY = [[/כרמיאל/, 'כרמיאל'], [/נהריה/, 'נהריה'], [/ראש פינה/, 'ראש פינה']];
var UPPER = /גליל\s*ה?עליון/;
var REGION = [/גליל\s*ה?מערבי/, /בגלל המערבי/, /בגלי להמערבי/, /(^|\s)בצפון([\s.,]|$)/];
var PLACING = /^מיקום\s*:|(^|\s)(ל|ב)(חברה|חברת|חטיבת|מפעל|משרד)(\s|$)/;
var place = function (title, lines) {
  var src = [title].concat(lines.filter(function (l) { return PLACING.test(l) && !/^מגורים/.test(l); }));
  var out = [];
  src.forEach(function (s) { CITY.forEach(function (c) { if (c[0].test(s) && out.indexOf(c[1]) < 0) out.push(c[1]); }); });
  if (out.length) return out;
  if (src.some(function (s) { return UPPER.test(s); })) return ['הגליל העליון'];
  return src.some(function (s) { return REGION.some(function (re) { return re.test(s); }); }) ? ['אזור צפון'] : ['Unknown'];
};
// --- the items ---
var root = document.createElement('div');
root.id = 'haide-meitav';
root.style.display = 'none';
var dropped = [], fellBack = [];
ids.forEach(function (id) {
  var doc = parse(pages[id]);
  var te = doc.getElementById('ContentPlaceHolder1_FormView1_HasmanaToLabel');
  var ne = doc.getElementById('ContentPlaceHolder1_FormView1_HasmanaIDLabel');
  var be = doc.getElementById('ContentPlaceHolder1_FormView1_ModaaLongLabel');
  var num = ne ? ne.textContent.replace(/\D/g, '') : '';
  var title = te ? te.textContent.replace(WS, ' ').trim().replace(MATH, function (ch) { return ch.normalize('NFKC'); }) : '';
  if (!title || num !== id || !be) { fail = true; return; }
  if (!OK1.test(title) || BAD.test(title)) { dropped.push(id + ':lang'); return; }
  var s = split(be);
  if (!s.d && !s.r) { dropped.push(id + ':notext'); return; }
  var addr = (MAILRE.exec(s.apply) || [''])[0];
  var instr = s.apply.replace(MAILRE, ' ').replace(WS, ' ').trim();
  if (!addr && FALLBACK_COMPANY_MAIL && COMAIL) { addr = COMAIL; fellBack.push(id); }
  var it = document.createElement('div');
  it.className = 'haide-job';
  var add = function (cls, v) { var e = document.createElement('span'); e.className = cls; e.textContent = v; it.appendChild(e); };
  var a = document.createElement('a');
  a.className = 'haide-link'; a.href = location.origin + '/jobdetails.aspx?JobID=' + id; a.textContent = title;
  it.appendChild(a);
  add('__ai-externalJobId', 'meitavjob-' + num);
  if (s.d) add('__ai-description', s.d);
  if (s.r) add('__ai-requirements', s.r);
  add('__ai-location', place(title, s.lines).join(', '));
  if (dates[id]) add('__ai-publishDate', dates[id]);
  if (addr) add('__ai-applicationInfo', 'mailto:' + addr + (instr ? ' - ' + instr : '') + ' (מספר הזמנה ' + num + ')');
  root.appendChild(it);
});
if (fail) { console.warn('[meitav] a job page had no title, number or text block'); return; }
document.body.appendChild(root);
console.log('[meitav] total ' + TOTAL + ', jobs ' + root.children.length + ', dated ' + Object.keys(dates).length + ', company-mail ' + fellBack.join(' ') + ', dropped ' + dropped.join(' ') + ', ' + (Date.now() - T0) + ' ms');
