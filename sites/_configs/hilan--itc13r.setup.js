// hilan.co.il /קריירה/ (Umbraco on ASP.NET Core), listing-only: the worker visits no job page.
// One item per job card a visitor sees in the "משרות פתוחות בחילן" carousel (.item-grid > a.inner, all cards in
// the server HTML, no paging; the category menu only filters). The card holds the title and a short text; the
// ad itself is on the job page. This script GETs each job page (credentials omit: no session cookie; a 20 s limit
// on each fetch; 4 in flight) and builds one hidden div.__ai-job per card in #haide-hilan.
// ALL-OR-NOTHING: a failed, slow, non-2xx or redirected answer, or a job page with no ad block or no CV form,
// builds no item at all, so a partial set is never published.
// - externalJobId: hilan-<PageId>, the Umbraco node id the job page's own apply form sends (hidden PageId). The
//   printed number "(1351)" is not used: the site has reused it for another job (1204 was "מיישם/ת מערכות HR" in
//   2024, today another role and two more pages), so it is unusable (LRN-ID-17, LRN-ID-5 decided 2026-10-18).
// - title: the card's h4 (some job pages print an empty h1); the printed number is never in it.
// - description: the job page's meta lines (place, scope) and the ad's lines as printed, minus requirement
//   sections; a job page with no descriptive text gets the card's short text instead.
//   requirements: the "דרישות" sections (label dropped), "יתרון" / "כישורים נדרשים" / "מה ... להביא" sections
//   (heading kept), and a heading-less bullet run whose lines are at least half requirement lines (LRN-SETUP-24).
// - location: the job page's "מקום העבודה:" line, split on commas and a joining ו, joined with " | " and read
//   through the config's locationMap (hyphenated תל-אביב / באר-שבע included).
// - no publishDate: the JSON-LD datePosted is the page's first date, older than the posting on reused pages.
// - applicationInfo / _formData: the job page's own CV form (multipart POST to the job page). Hidden jobName,
//   jobId, PageId stored with their values; __RequestVerificationToken and ufprt change on every page load (the
//   antiforgery token pairs with a cookie set by that load): stored by name with an empty value. CV file only.
//   No captcha: recaptcha/api.js?render=explicit is loaded site-wide, but nothing renders or executes it and the
//   form has no token field.
if (document.getElementById('haide-hilan')) return;
var T0 = Date.now();
var NB = String.fromCharCode(160);
var WS = new RegExp('[\\s' + NB + ']+', 'g');
var clean = function (s) { return String(s || '').replace(WS, ' ').trim(); };
var OK1 = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}]/u;
var BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var MATH = new RegExp('[' + String.fromCodePoint(0x1D400) + '-' + String.fromCodePoint(0x1D7FF) + ']', 'gu');
var anchors = Array.prototype.slice.call(document.querySelectorAll('.item-grid > a.inner[href]'));
if (anchors.length < 2) { console.warn('[hilan] ' + anchors.length + ' job cards on ' + location.href + ' -> no items'); return; }
var cards = anchors.map(function (a) {
  var h4 = a.querySelector('h4'), d = a.querySelector('.desc');
  return { href: new URL(a.getAttribute('href'), location.href).href, title: clean(h4 ? h4.textContent : ''), short: d ? d : null };
});
var get = async function (url) {
  var ac = new AbortController();
  var timer = setTimeout(function () { ac.abort(); }, 20000);
  try {
    var r = await fetch(url, { credentials: 'omit', cache: 'no-store', redirect: 'follow', signal: ac.signal });
    if (!r.ok || r.redirected) throw new Error('HTTP ' + r.status + (r.redirected ? ' redirected' : '') + ' ' + url);
    return await r.text();
  } finally { clearTimeout(timer); }
};
// --- text of a node as lines; li items flagged ---
var BUL = /^[-•·✨🔍]/u;
var lines = function (nodes) {
  var out = [];
  var push = function (t, li) { t = clean(t); if (t) out.push({ t: t, li: li }); };
  var text = function (el) {
    var x = el.cloneNode(true);
    x.querySelectorAll('br').forEach(function (b) { b.replaceWith('\n'); });
    return x.textContent || '';
  };
  var walk = function (el) {
    if (el.nodeType === 3) { String(el.textContent || '').split('\n').forEach(function (t) { push(t, false); }); return; }
    if (el.nodeType !== 1) return;
    var tag = el.tagName;
    if (tag === 'UL' || tag === 'OL') { el.querySelectorAll('li').forEach(function (li) { push(text(li).replace(/\n+/g, ' '), true); }); return; }
    if (el.querySelector('ul,ol,p,div')) { Array.prototype.forEach.call(el.childNodes, walk); return; }
    text(el).split('\n').forEach(function (t) { push(t, false); });
  };
  nodes.forEach(walk);
  return out;
};
// --- body split (owner's job body rules) ---
var REQH = /^(דרישות(\s+(התפקיד|המשרה))?|יתרון.*|כישורים נדרשים|מה (חשוב לנו שתביאו איתכם|צריך להביא איתך|אנחנו מחפשים))$/;
var DESCH = /^(תיאור\s+(תפקיד|משרה|התפקיד|המשרה)|תחומי אחריות.*|מה כולל התפקיד|במסגרת התפקיד|על התפקיד|מה תעשו במסגרת התפקיד|אנחנו מציעים|אנו מציעים|מה מייחד את התפקיד)$/;
var REQW = /^(ניסיון|נסיון|ידע|תואר|תעודת|היכרות|הכרות|שליטה|יכולת|יכולות|כישורי|הבנה|אנגלית|עברית|רישיון|רשיון|זמינות|נכונות|עדיפות|בעלי|בוגרי|יחסי אנוש|תודעת|אוריינטציה)/;
var head = function (t) { return t.replace(/[\s:?!.]+$/, '').replace(/^[\s:]+/, ''); };
var stripB = function (t) { return t.replace(/^[-•·✨🔍\s]+/u, ''); };
var isReqLine = function (t) { var s = stripB(t); return REQW.test(s) || /חובה|יתרון/.test(s); };
var split = function (ls) {
  var d = [], r = [], mode = 'i'; // i = intro (no heading yet), d = description heading, r = requirements
  var i = 0;
  while (i < ls.length) {
    var l = ls[i], h = head(l.t);
    if (!l.li && h.length < 60 && REQH.test(h)) { mode = 'r'; if (!/^דרישות/.test(h)) r.push({ t: l.t, li: false }); i++; continue; }
    if (!l.li && h.length < 60 && DESCH.test(h)) { mode = 'd'; if (!/^תיאור/.test(h)) d.push({ t: l.t, li: false }); i++; continue; }
    if (mode === 'r') {
      if (!l.li && !isReqLine(l.t) && (/^(📍|המשרה מיועדת)/u.test(l.t) || /היברידי|קו רכבת/.test(l.t) || l.t.length > 90)) { mode = 'd'; d.push(l); i++; continue; }
      r.push(l); i++; continue;
    }
    if (mode === 'i' && (l.li || BUL.test(l.t))) {
      // a heading-less bullet run: to requirements when at least half its lines are requirement lines (LRN-SETUP-24)
      var j = i, run = [];
      while (j < ls.length && (ls[j].li || BUL.test(ls[j].t)) && ls[j].li === l.li) { run.push(ls[j]); j++; }
      var n = run.filter(function (x) { return isReqLine(x.t); }).length;
      (n * 2 >= run.length ? r : d).push.apply(n * 2 >= run.length ? r : d, run);
      i = j; continue;
    }
    d.push(l); i++;
  }
  return { d: d, r: r };
};
var place = function (s) {
  var m = /^מקום העבודה\s*:\s*(.+)$/.exec(s);
  if (!m) return '';
  return m[1].split(/\s*,\s*|\s+ו(?=\S)/).map(clean).filter(Boolean).join(' | ');
};
var jobs = [];
try {
  var queue = cards.map(function (c, k) { return k; });
  var worker = async function () {
    while (queue.length) {
      var k = queue.shift(), c = cards[k];
      if (!c.title) throw new Error('card ' + c.href + ' has no title');
      var doc = new DOMParser().parseFromString(await get(c.href), 'text/html');
      var block = doc.querySelector('article .block') || doc.querySelector('.block');
      var meta = block ? block.querySelector(':scope > .title') : null;
      var form = doc.querySelector('.popup_career form[enctype="multipart/form-data"]');
      var pid = form ? form.querySelector('input[name="PageId"]') : null;
      if (!block || !meta || !form || !form.querySelector('input[type="file"]') || !pid || !/^\d+$/.test(pid.getAttribute('value') || '')) throw new Error('job page without ad block or CV form: ' + c.href);
      var metaLines = Array.prototype.map.call(meta.querySelectorAll('span'), function (s) { return clean(s.textContent); }).filter(Boolean);
      var body = [], on = false;
      Array.prototype.forEach.call(block.childNodes, function (n) {
        if (n === meta) { on = true; return; }
        if (n.nodeType === 1 && /(^|\s)(list|bottomIcons)(\s|$)/.test(n.className || '')) on = false;
        if (on) body.push(n);
      });
      var s = split(lines(body));
      if (!s.d.length && c.short) s.d = lines([c.short]);
      if (!s.d.length && !s.r.length) throw new Error('job page with no text: ' + c.href);
      var loc = '';
      metaLines.forEach(function (x) { if (!loc) loc = place(x); });
      var fields = [], have = {};
      form.querySelectorAll('input, select, textarea').forEach(function (e) {
        var ft = (e.tagName === 'INPUT' ? (e.getAttribute('type') || 'text') : e.tagName.toLowerCase()).toLowerCase();
        if (/^(submit|button|reset|image)$/.test(ft) || !e.name || have[e.name]) return;
        have[e.name] = 1;
        var o = { name: e.name, label: ft === 'file' ? 'קורות חיים' : '', fieldType: ft, tagName: e.tagName, required: ft === 'file' };
        if (ft === 'file') o.accept = '.doc,.docx,.pdf';
        if (ft === 'hidden') o.value = /^(__RequestVerificationToken|ufprt)$/.test(e.name) ? '' : (e.getAttribute('value') || '');
        fields.push(o);
      });
      var act = c.href;
      try { act = new URL(form.getAttribute('action') || c.href, c.href).href; } catch (e) {}
      jobs[k] = { href: c.href, title: c.title.replace(MATH, function (ch) { return ch.normalize('NFKC'); }), id: 'hilan-' + pid.getAttribute('value'),
        meta: metaLines, d: s.d, r: s.r, loc: loc,
        blob: JSON.stringify({ actionUrl: act, actionAttribute: act, formClass: '', formTag: 'form', method: 'POST', enctype: 'multipart/form-data', pageUrl: c.href, fields: fields }) };
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
} catch (e) { console.warn('[hilan] ' + (e && e.name === 'AbortError' ? 'fetch timed out' : e) + ' -> no items'); return; }
var box = document.createElement('div');
box.id = 'haide-hilan';
box.style.display = 'none';
var dropped = [];
jobs.forEach(function (j) {
  if (!OK1.test(j.title) || BAD.test(j.title)) { dropped.push(j.id + ':lang'); return; }
  var it = document.createElement('div');
  it.className = '__ai-job';
  var a = document.createElement('a');
  a.className = '__ai-link'; a.href = j.href; a.textContent = j.title;
  it.appendChild(a);
  var add = function (cls, v) {
    var w = document.createElement('div');
    w.className = cls;
    if (typeof v === 'string') { w.textContent = v; it.appendChild(w); return; }
    var ul = null;
    v.forEach(function (x) {
      if (x.li) { if (!ul) { ul = document.createElement('ul'); w.appendChild(ul); } var li = document.createElement('li'); li.textContent = x.t; ul.appendChild(li); }
      else { ul = null; var p = document.createElement('p'); p.textContent = x.t; w.appendChild(p); }
    });
    it.appendChild(w);
  };
  add('__ai-title', j.title);
  add('__ai-id', j.id);
  add('__ai-description', j.meta.map(function (t) { return { t: t, li: false }; }).concat(j.d));
  if (j.r.length) add('__ai-requirements', j.r);
  add('__ai-location', j.loc);
  add('__ai-applicationInfo', j.blob);
  add('__ai-formData', j.blob);
  box.appendChild(it);
});
document.body.appendChild(box);
console.log('[hilan] cards ' + cards.length + ', jobs ' + box.children.length + (dropped.length ? ', dropped ' + dropped.join(' ') : '') + ', ' + (Date.now() - T0) + ' ms');
