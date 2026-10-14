// aman.co.il/careers. Pools /careers/ and /careers/page/2..N ALL-OR-NOTHING (an error, a redirect, or a
// total that differs from the printed "כל המשרות הפנויות (N)" builds no item). Body and date per job come
// from the careers feed (same text as the job page); a job the feed lacks is read from its own page.
// Id aman-<printed "משרה N">; a card with no number gets no id. Location: card tag, refined by a work-place
// line. Apply: the page's quick-apply form, one blob per job with post-id = the job's post id (LRN-FORM-13).
if (document.getElementById('haide-aman')) return;
if (!document.querySelector('.positions_page__application')) return;
var T0 = Date.now();
var BASE = location.origin + '/careers/';
var NB = String.fromCharCode(160);
var WS = new RegExp('[ \\t' + NB + ']+', 'g');
var OK1 = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var MATH = new RegExp('[' + String.fromCodePoint(0x1D400) + '-' + String.fromCodePoint(0x1D7FF) + ']', 'gu');
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
// returns the text, null on failure; a 404 is reported as '' when ok404 is set
var get = async function (url, ok404) {
  for (var a = 0; a < 2; a++) {
    try {
      var r = await fetch(url, { credentials: 'include', cache: 'no-store' });
      if (r.ok && !r.redirected) return await r.text();
      if (ok404 && r.status === 404) return '';
    } catch (e) {}
    await sleep(1500);
  }
  return null;
};
var parse = function (h, t) { return new DOMParser().parseFromString(h, t || 'text/html'); };
var key = function (u) { try { u = decodeURIComponent(new URL(u, location.href).pathname); } catch (e) {} return String(u).toLowerCase().replace(/\/+$/, ''); };
// --- the listing, every page ---
var cardsOf = function (doc) {
  return Array.prototype.map.call(doc.querySelectorAll('.positions_page__application'), function (c) {
    var a = c.querySelector('a.aman-job-card__title-link');
    var tags = Array.prototype.map.call(c.querySelectorAll('.aman-job-card__tag'), function (t) { return t.textContent.replace(WS, ' ').trim(); });
    var num = tags.map(function (t) { return (/^משרה\s+(\d+)$/.exec(t) || [])[1]; }).filter(Boolean)[0] || '';
    return { pid: c.getAttribute('data-position-id') || '', title: (c.getAttribute('data-job-title') || '').replace(WS, ' ').trim(),
      tag: (c.getAttribute('data-job-location') || '').trim(), cat: (c.getAttribute('data-job-category') || '').trim(),
      num: num, url: a ? new URL(a.getAttribute('href'), location.href).href : '' };
  });
};
var first = await get(BASE);
var d1 = first && parse(first);
var cnt = d1 && d1.querySelector('.positions_page__content-applications-heading-counter');
var TOTAL = cnt ? parseInt(cnt.textContent.replace(/\D/g, ''), 10) : NaN;
var cards = d1 ? cardsOf(d1) : [];
var fail = !(TOTAL > 0) || !cards.length;
for (var p = 2; !fail && p < 80; p++) {
  var h = await get(BASE + 'page/' + p + '/');
  if (h === null) { fail = true; break; }
  var cs = cardsOf(parse(h));
  if (!cs.length) break;
  cards = cards.concat(cs);
}
var pids = {};
cards.forEach(function (c) { if (c.pid && c.url) pids[c.pid] = 1; });
if (fail || Object.keys(pids).length !== TOTAL || cards.some(function (c) { return !c.pid || !c.url; })) {
  console.warn('[aman] listing failed: total ' + TOTAL + ', cards ' + cards.length); return;
}
// --- bodies and dates: the careers feed, then a job's own page for any the feed lacks ---
var body = {};
var CE = 'http://purl.org/rss/1.0/modules/content/';
for (var f = 1; !fail && f < 80; f++) {
  var x = await get(location.origin + '/feed/?post_type=aman_careers' + (f > 1 ? '&paged=' + f : ''), f > 1);
  if (x === null) { fail = true; break; }
  if (!x) break;
  var its = parse(x, 'text/xml').getElementsByTagName('item');
  if (!its.length) break;
  for (var i = 0; i < its.length; i++) {
    var ln = its[i].getElementsByTagName('link')[0], ce = its[i].getElementsByTagNameNS(CE, 'encoded')[0], pd = its[i].getElementsByTagName('pubDate')[0];
    if (!ln || !ce) continue;
    var cd = parse(ce.textContent);
    Array.prototype.forEach.call(cd.querySelectorAll('p'), function (q) { if (/appeared first on/.test(q.textContent) && !q.nextElementSibling) q.remove(); });
    body[key(ln.textContent)] = { root: cd.body, date: pd ? pd.textContent : '' };
  }
  if (cards.every(function (c) { return body[key(c.url)]; })) break;
}
var miss = cards.filter(function (c) { return !body[key(c.url)]; });
if (!fail && miss.length > 30) fail = true;
for (var m = 0; !fail && m < miss.length; m++) {
  var jh = await get(miss[m].url);
  var jd = jh && parse(jh);
  var w = jd && jd.querySelector('.elementor-widget-theme-post-content > .elementor-widget-container');
  if (!w) { fail = true; break; }
  // the page's datePublished (+00:00) equals the feed date; its JobPosting datePosted mislabels old posts as +03:00
  var dp = (/"datePublished":"([^"]+)"/.exec(jh) || [])[1] || '';
  body[key(miss[m].url)] = { root: w, date: dp };
}
if (fail) { console.warn('[aman] body fetch failed'); return; }
// --- one job body -> description / requirements (the page's own two sections) ---
var LABEL = /^(תיאור (ה)?(תפקיד|משרה)( הנדרש)?|דרישות( (ה)?(תפקיד|משרה))?)\s*[:\-–]?$/;
var EMPTY = /^[\s\-–—•●·o§*.:]*$/;
var REQ = /(^|[\s\-–—•●*])(יתרון|חובה)( משמעותי)?\s*[!.]*$|^[\s\-–—•●o§*]*יתרון/;
var TERMS = /^[\s\-–—•●*]*(היקף משרה|שכר)/;
// a line that names the role ("דרוש.ה ר"צ פיתוח", "אנו מגייסים מפתח/ת"); no \b after Hebrew, so spaces/ends are explicit
var ROLE = /(^|[\s(])(דרוש|דרושה|דרושים|דרושות|מחפש|מחפשת|מחפשים|מגייס|מגייסת|מגייסים)([.\/](ה|ת|ים|ות))?(?=[\s:,]|$)|(^|\s)לתפקיד\s/;
var split = function (root) {
  var c = root.cloneNode(true);
  c.querySelectorAll('img').forEach(function (e) { e.replaceWith(e.getAttribute('alt') || ''); });
  c.querySelectorAll('br').forEach(function (e) { e.replaceWith('\n'); });
  c.querySelectorAll('p, li, div, h1, h2, h3, h4, h5, h6, tr').forEach(function (e) { e.appendChild(document.createTextNode('\n')); });
  var sec = 'D', D = [], R = [], moved = [], terms = [], lead = '', role = '';
  (c.textContent || '').split('\n').forEach(function (l) {
    l = l.replace(WS, ' ').trim();
    if (/^מה התפקיד שלך יכלול\?$/.test(l)) { sec = 'D'; return; }
    if (/^למי התפקיד יתאים\?$/.test(l)) { sec = 'R'; return; }
    if (EMPTY.test(l) || LABEL.test(l)) return;
    if (!lead) lead = l;
    if (!role && ROLE.test(l)) role = l;
    if (sec === 'D') {
      var prev = D.length ? D[D.length - 1] : '';
      if (REQ.test(l) && !/,\s*$/.test(prev)) moved.push(l); else D.push(l);
    } else if (TERMS.test(l)) terms.push(l); else R.push(l);
  });
  return { d: D.concat(terms).join('\n'), r: moved.concat(R).join('\n'), lines: D, lead: lead, role: role };
};
// --- location: tag, refined by a work-place line (title or the role section) ---
var TAG = { 'מרכז': ['אזור מרכז', 'אזור מרכז'], 'שפלה': ['אזור שפלה', 'אזור שפלה'], 'צפון': ['אזור צפון', 'אזור צפון'],
  'דרום': ['אזור דרום', 'אזור דרום'], 'שרון': ['אזור השרון', 'אזור השרון'], 'ירושלים': ['ירושלים', 'ירושלים'] };
var PL = [['ירושלים', 'ירושלים', 'ירושלים'], ['תל אביב|ת"א', 'תל אביב-יפו', 'אזור מרכז'], ['פתח תקו?וה|פ"ת', 'פתח תקווה', 'אזור מרכז'],
  ['רמת גן', 'רמת גן', 'אזור מרכז'], ['בני ברק', 'בני ברק', 'אזור מרכז'], ['ראשון לציון|ראשל"צ', 'ראשון לציון', 'אזור מרכז'],
  ['חולון', 'חולון', 'אזור מרכז'], ['גבעתיים', 'גבעתיים', 'אזור מרכז'], ['ראש העין', 'ראש העין', 'אזור מרכז'], ['אור יהודה', 'אור יהודה', 'אזור מרכז'],
  ['נס ציונה', 'נס ציונה', 'אזור מרכז'], ['איירפורט סיטי', 'איירפורט סיטי', 'אזור מרכז'], ['רחובות', 'רחובות', 'אזור שפלה'],
  ['אשדוד', 'אשדוד', 'אזור שפלה'], ['הרצליה', 'הרצליה', 'אזור השרון'], ['נתניה', 'נתניה', 'אזור השרון'], ['כפר סבא', 'כפר סבא', 'אזור השרון'],
  ['רעננה', 'רעננה', 'אזור השרון'], ['הוד השרון', 'הוד השרון', 'אזור השרון'], ['רמת השרון', 'רמת השרון', 'אזור השרון'],
  ['חיפה', 'חיפה', 'אזור צפון'], ['יוקנעם|יקנעם', 'יוקנעם', 'אזור צפון'], ['באר שבע', 'באר שבע', 'אזור דרום']
].map(function (q) { return { re: new RegExp('(?:^|[^א-ת])ב(?:אזור\\s+)?(?:' + q[0] + ')(?![א-ת])'), row: q[1], area: q[2] }; });
var CUE = /דרוש|מגייס|מחפש|ממוקמ|המשרה|העבודה|מיקום|ארגון|משרד|חבר[הת]|בנק|קבוצת/;
var NOT = /משרדי החברה|לקוח|נסיעות|מגורים|הגעה/;
var place = function (tag, lines) {
  var hit = [];
  lines.forEach(function (l) {
    if (!CUE.test(l) || NOT.test(l)) return;
    PL.forEach(function (q) { if (q.re.test(l) && hit.indexOf(q) < 0) hit.push(q); });
  });
  var t = TAG[tag];
  if (!t) return hit.length ? hit.map(function (q) { return q.row; }) : ['Unknown'];
  return hit.some(function (q) { return t[1] === 'ירושלים' ? q.row === 'ירושלים' : q.area === t[1]; }) ? hit.map(function (q) { return q.row; }) : [t[0]];
};
// --- the apply blob: the quick-apply form as the page sends it, post-id = this job's post id ---
var fm = d1.querySelector('#fast_apply form.wpcf7-form');
if (!fm || !fm.querySelector('input[name="post-id"]')) { console.warn('[aman] quick-apply form not found'); return; }
var FIELDS = [];
fm.querySelectorAll('input, select, textarea').forEach(function (e) {
  var ft = (e.tagName === 'INPUT' ? (e.getAttribute('type') || 'text') : e.tagName.toLowerCase()).toLowerCase();
  if (/^(submit|button|reset|image)$/.test(ft) || !e.name) return;
  var lb = (e.id && fm.querySelector('label[for="' + e.id + '"]')) || e.closest('label');
  var o = { name: e.name, label: ((lb ? lb.textContent : '') || e.getAttribute('placeholder') || e.name).replace(/\s+/g, ' ').trim(),
    fieldType: ft, tagName: e.tagName,
    required: e.hasAttribute('required') || e.getAttribute('aria-required') === 'true' || !!e.closest('.wpcf7-acceptance:not(.optional)') };
  if (ft === 'hidden') o.value = e.getAttribute('value') || '';
  FIELDS.push(o);
});
var ACT = new URL(fm.getAttribute('action') || '', BASE).href;
// --- the items ---
var root = document.createElement('div');
root.id = 'haide-aman';
root.style.display = 'none';
var dropped = [];
var NUMT = /^(משרה|מס['"]? משרה)?\s*(#|מס['"]?)?\s*\d+\s*$/;
cards.forEach(function (c) {
  var title = c.title.replace(MATH, function (ch) { return ch.normalize('NFKC'); });
  if (!OK1.test(title) || BAD.test(title)) { dropped.push(c.pid + ':lang'); return; }
  var b = body[key(c.url)], s = split(b.root);
  if (!s.d && !s.r) { dropped.push(c.pid + ':empty'); return; }
  var loc = place(c.tag, [title].concat(s.lines));
  // owner 2026-10-14: a title that is only the job number takes the ad's first line (headings/labels skipped)
  // number-only title: the first line that names the role; if none does, the first line (owner to confirm)
  if (NUMT.test(title)) { var t2 = s.role || s.lead; if (!t2) { dropped.push(c.pid + ':numtitle'); return; } title = t2; }
  var dt = new Date(b.date);
  var blob = JSON.stringify({ actionUrl: ACT, actionAttribute: ACT, formClass: fm.getAttribute('class') || '', formTag: 'form',
    method: 'POST', enctype: 'multipart/form-data', pageUrl: BASE,
    fields: FIELDS.map(function (o) { var k = Object.assign({}, o); if (k.name === 'post-id') k.value = c.pid; return k; }) });
  var it = document.createElement('div');
  it.className = 'haide-job';
  var add = function (cls, v) { var e = document.createElement('span'); e.className = cls; e.textContent = v; it.appendChild(e); };
  var a = document.createElement('a');
  a.className = 'haide-link'; a.href = c.url; a.textContent = title;
  it.appendChild(a);
  if (c.num) add('__ai-externalJobId', 'aman-' + c.num);
  if (c.cat) add('__ai-department', c.cat);
  if (s.d) add('__ai-description', s.d);
  if (s.r) add('__ai-requirements', s.r);
  add('__ai-location', loc.join(', '));
  if (!isNaN(dt)) add('__ai-publishDate', dt.toISOString());
  add('__ai-applicationInfo', blob);
  add('__ai-formData', blob);
  root.appendChild(it);
});
document.body.appendChild(root);
console.log('[aman] total ' + TOTAL + ', cards ' + cards.length + ', feed-missing ' + miss.length + ', jobs ' + root.children.length + ', dropped ' + dropped.join(' ') + ', ' + (Date.now() - T0) + ' ms');
