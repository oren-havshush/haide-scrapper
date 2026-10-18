// flextronics.wd1.myworkdayjobs.com/he-IL/Careers (Workday, tenant flextronics, site Careers): Israel jobs only.
// The script reads the board's own JSON (the cxs job search with the Israel country facet, 20 per page, every
// page until the total) and each job's cxs record, ALL-OR-NOTHING (any failed request builds no item).
// It never opens an apply page and never calls an application endpoint.
// - id: the printed "job requisition id" (jobReqId, WDnnnnnn), namespaced flex-WDnnnnnn.
// - description / requirements: the job's description HTML; Qualifications / דרישות / the "experience we are
//   looking for" sections go to requirements; the labels סיכום עבודה / Summary and the empty Workday labels are
//   dropped; the "קטגוריית משרה" value is the department; line breaks kept, text as printed.
// - location: the record's location (Hebrew, Accept-Language he-IL) through the config's locationMap.
// - date: the record's startDate (the posting date the page shows as "פורסם ...").
// - apply: Workday's own apply flow, the job page's apply address.
if (document.getElementById('haide-flex')) return;
var T0 = Date.now();
var B = location.origin + '/wday/cxs/flextronics/Careers';
var IL = '084562884af243748dad7c84c304d89a';
var NB = String.fromCharCode(160);
var WS = new RegExp('[ \\t' + NB + ']+', 'g');
var OK1 = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var MATH = new RegExp('[' + String.fromCodePoint(0x1D400) + '-' + String.fromCodePoint(0x1D7FF) + ']', 'gu');
var clean = function (s) { return String(s || '').replace(WS, ' ').replace(/\s+/g, ' ').trim(); };
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var H = { 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Language': 'he-IL' };
var call = async function (url, body) {
  for (var a = 0; a < 2; a++) {
    try {
      var r = await fetch(url, body ? { method: 'POST', headers: H, body: JSON.stringify(body), credentials: 'include' } : { headers: H, credentials: 'include' });
      if (r.ok && !r.redirected) return await r.json();
    } catch (e) {}
    await sleep(1500);
  }
  return null;
};
// --- the Israel postings ---
var posts = [], total = -1;
for (var off = 0; off < 500; off += 20) {
  var s = await call(B + '/jobs', { appliedFacets: { Location_Country: [IL] }, limit: 20, offset: off, searchText: '' });
  if (!s || !Array.isArray(s.jobPostings)) { console.warn('[flex] search failed at ' + off); return; }
  if (total < 0) total = s.total;
  posts = posts.concat(s.jobPostings);
  if (!s.jobPostings.length || posts.length >= total) break;
}
if (!posts.length || posts.length < total) { console.warn('[flex] search short ' + posts.length + '/' + total); return; }
var recs = [];
for (var i = 0; i < posts.length; i++) {
  var p = posts[i].externalPath || '';
  var j = /^\/job\//.test(p) ? await call(B + p) : null;
  var info = j && j.jobPostingInfo;
  if (!info || !info.jobReqId || !info.title) { console.warn('[flex] job read failed: ' + p); return; }
  recs.push({ info: info, path: p });
}
// --- description HTML -> lines ---
var linesOf = function (html) {
  var c = document.createElement('div');
  c.innerHTML = String(html || '');
  c.querySelectorAll('script, style, img, svg').forEach(function (e) { e.remove(); });
  c.querySelectorAll('li').forEach(function (e) { e.insertBefore(document.createTextNode('\n@@LI@@'), e.firstChild); });
  c.querySelectorAll('br').forEach(function (e) { e.replaceWith('\n'); });
  c.querySelectorAll('p, li, div, h1, h2, h3, h4, h5, h6, ul, ol, tr').forEach(function (e) { e.appendChild(document.createTextNode('\n')); });
  return (c.textContent || '').split('&#xa;').join('\n').split('\n').map(function (l) { return l.replace(WS, ' ').trim(); })
    .filter(function (l) { return l && l !== '@@LI@@' && !/^[.\s]*$/.test(l); });
};
var LABEL = /^(סיכום עבודה|Summary|JOB SUMMARY)\s*:?$/i;
var REQ = /^(Qualifications|Requirements|דרישות( התפקיד)?|הניסיון שאנחנו מבקשים|הנה חלק ממה שתצטרך\/י|THE EXPERIENCE\/ ?EDUCATION WE.RE LOOKING TO ADD TO THE TEAM)\s*:?$/i;
var REQSUB = /^הנה כמה מהניסיון המועדף עלינו\s*:?$/;
var EMPTY = /^(כישורים נדרשים|מיומנויות אופציונליות)$/;
var NOTREQ = /^-?\s*המשרה (מיועדת|מויעדת|מוגדרת)/;
var split = function (html) {
  var D = [], R = [], to = D, dept = '', cat = false, rli = false;
  linesOf(html).forEach(function (raw) {
    var li = raw.indexOf('@@LI@@') === 0, l = li ? clean(raw.slice(6)) : raw;
    if (!l) return;
    if (cat) { dept = l; cat = false; to = null; return; }
    if (!li && l === 'קטגוריית משרה') { cat = true; return; }
    if (!li && EMPTY.test(l)) return;
    if (to === null) to = D;
    var head = !li && l.length < 100 && /[:?]$|^דרישות$/.test(l);
    if (!li && LABEL.test(l)) return;
    if (!li && REQ.test(l)) { to = R; rli = false; return; }
    // a heading, or prose after a bulleted list, closes the requirements
    if (to === R && !li && !REQSUB.test(l) && (head || rli)) to = D;
    if (to === R && li) rli = true;
    // the equal-opportunity / replacement line is not a requirement
    if (to === R && NOTREQ.test(l)) { D.push(l); return; }
    to.push(l);
  });
  return { d: D.join('\n'), r: R.join('\n'), dept: dept };
};
var root = document.createElement('div');
root.id = 'haide-flex';
root.style.display = 'none';
var dropped = [];
recs.forEach(function (rc) {
  var info = rc.info;
  if (info.country && info.country.id && info.country.id !== IL) { dropped.push(info.jobReqId + ':country'); return; }
  var title = clean(info.title).replace(MATH, function (ch) { return ch.normalize('NFKC'); });
  if (!OK1.test(title) || BAD.test(title)) { dropped.push(info.jobReqId + ':lang'); return; }
  var s = split(info.jobDescription);
  var locs = [clean(info.location)].concat((info.additionalLocations || []).map(clean)).filter(function (x) { return x; });
  var url = location.origin + '/he-IL/Careers' + rc.path;
  var it = document.createElement('div');
  it.className = 'haide-job';
  var add = function (cls, v) { var e = document.createElement('span'); e.className = cls; e.textContent = v; it.appendChild(e); };
  var a = document.createElement('a');
  a.className = 'haide-link'; a.href = url; a.textContent = title;
  it.appendChild(a);
  add('__ai-externalJobId', 'flex-' + clean(info.jobReqId));
  if (s.dept) add('__ai-department', s.dept);
  if (s.d) add('__ai-description', s.d);
  if (s.r) add('__ai-requirements', s.r);
  if (locs.length) add('__ai-location', locs.join(' | '));
  if (/^\d{4}-\d\d-\d\d$/.test(info.startDate || '')) add('__ai-publishDate', info.startDate);
  add('__ai-applicationInfo', url + '/apply');
  root.appendChild(it);
});
document.body.appendChild(root);
console.log('[flex] total ' + total + ', records ' + recs.length + ', jobs ' + root.children.length + ', dropped ' + dropped.join(' ') + ', ' + (Date.now() - T0) + ' ms');
