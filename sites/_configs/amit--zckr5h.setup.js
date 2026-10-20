// amit.co.il/jobs/. One item per job card a visitor sees on this page: the 5 cards under "משרות פתוחות בעמית"
// (CPT jobs) and the card under "משרות אצל לקוחותינו" (CPT jobs-out-source, a client's job posted by Amit under
// its own name; the client is not named and never guessed). The English twin (/en/, post 1672) is not on this page.
// Body and date: the WP REST record of the card's link (/wp-json/wp/v2/jobs, /jobs-out-source; same text as the job
// page). Apply: the job page's own Quform CV form (form 3), read from that page, hidden values included; no captcha.
// quform_form_uid and quform_csrf_token change with every page load / session: stored by name with an empty value.
// The honeypot text box (quform-element-tree, "This field should be left blank") is a spam trap: left out.
// Every fetch: no cookies (credentials omit), a 20 s limit. ALL-OR-NOTHING: a failed, slow, non-2xx or empty answer,
// a card with no REST record or a job page with no CV form for that post builds no item at all.
// Id: no printed job number and Hebrew slugs -> no id; the worker builds h-<hash>(title|department|url).
// Location: work-location cue lines only (closed table); an own job with no place -> the single printed company city
// (footer "הירדן 2, איירפורט סיטי", LRN-LOC-20); the client posting with no place stays Unknown.
if (document.getElementById('haide-amit')) return;
var T0 = Date.now();
var NB = String.fromCharCode(160);
var WS = new RegExp('[\\s' + NB + ']+', 'g');
var clean = function (s) { return String(s || '').replace(WS, ' ').trim(); };
var OK1 = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}]/u;
var BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var MATH = new RegExp('[' + String.fromCodePoint(0x1D400) + '-' + String.fromCodePoint(0x1D7FF) + ']', 'gu');
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var key = function (u) { try { u = decodeURIComponent(new URL(u, location.href).pathname); } catch (e) {} return String(u).toLowerCase().replace(/\/+$/, ''); };
var CARDS = '.open-jobs .job-item .job-btn a[href], .customer-jobs .customer-jobs-list-item .job-list-btn a[href]';
var cardsNow = function () {
  var out = [];
  document.querySelectorAll(CARDS).forEach(function (a) {
    var k = key(a.getAttribute('href'));
    if (/^\/(jobs|jobs-out-source)\/[^\/]+$/.test(k)) out.push({ k: k, type: k.split('/')[1] });
  });
  return out;
};
var cards = [], prev = -1, stable = 0;
for (var t = 0; t < 40; t++) {
  cards = cardsNow();
  if (cards.length > 0 && cards.length === prev) { if (++stable >= 2) break; } else stable = 0;
  prev = cards.length;
  await sleep(500);
}
if (!cards.length) { console.warn('[amit] no job cards on ' + location.href); return; }
// the host answers 429 to a burst (seen 2026-10-19 after four back-to-back local runs): one retry after 4 s on 429, then fail
var get = async function (url, json, again) {
  var ac = new AbortController();
  var timer = setTimeout(function () { ac.abort(); }, 20000);
  try {
    var r = await fetch(url, { credentials: 'omit', cache: 'no-store', signal: ac.signal });
    if (r.status === 429 && !again) { clearTimeout(timer); await sleep(4000); return get(url, json, true); }
    if (!r.ok || r.redirected) throw new Error('HTTP ' + r.status + (r.redirected ? ' redirected' : '') + ' ' + url);
    var body = json ? await r.json() : await r.text();
    return { body: body, pages: +(r.headers.get('X-WP-TotalPages') || 1) };
  } finally { clearTimeout(timer); }
};
var parse = function (h) { return new DOMParser().parseFromString(h, 'text/html'); };
var decode = function (h) { return clean(parse('<b>' + h + '</b>').body.textContent); };
var recs = {}, forms = {};
try {
  // --- REST records of both post types ---
  var types = ['jobs', 'jobs-out-source'];
  for (var i = 0; i < types.length; i++) {
    for (var pg = 1, last = 1; pg <= last; pg++) {
      var res = await get(location.origin + '/wp-json/wp/v2/' + types[i] + '?per_page=100&page=' + pg + '&_fields=id,date_gmt,link,slug,title,content', true);
      if (!Array.isArray(res.body) || !res.body.length) throw new Error('REST ' + types[i] + ' page ' + pg + ' empty');
      last = res.pages;
      res.body.forEach(function (r) { recs[key(r.link)] = r; });
    }
  }
  var miss = cards.filter(function (c) { return !recs[c.k]; });
  if (miss.length) throw new Error('cards with no REST record: ' + miss.map(function (c) { return c.k; }).join(' '));
  // --- each job page's own CV form (the Quform form whose hidden post_id is this post) ---
  var keys = cards.map(function (c) { return c.k; }).filter(function (k, i, a) { return a.indexOf(k) === i; });
  var queue = keys.slice();
  var worker = async function () {
    while (queue.length) {
      var k = queue.shift(), rec = recs[k];
      var page = await get(rec.link, false);
      var doc = parse(page.body), fm = null;
      doc.querySelectorAll('form.quform-form').forEach(function (f) {
        var pid = f.querySelector('input[name="post_id"]');
        if (!fm && f.querySelector('input[type="file"]') && pid && pid.getAttribute('value') === String(rec.id)) fm = f;
      });
      if (!fm) throw new Error('no CV form for post ' + rec.id + ' on ' + rec.link);
      var fields = [];
      fm.querySelectorAll('input, select, textarea').forEach(function (e) {
        var ft = (e.tagName === 'INPUT' ? (e.getAttribute('type') || 'text') : e.tagName.toLowerCase()).toLowerCase();
        if (/^(submit|button|reset|image)$/.test(ft) || !e.name) return;
        if (e.closest('.quform-element-tree')) return;   // honeypot: never stored, never filled (LRN-FORM-14)
        var lb = e.id ? fm.querySelector('label[for="' + e.id + '"]') : null;
        var o = { name: e.name, label: clean(lb ? lb.textContent : e.getAttribute('placeholder') || ''), fieldType: ft,
          tagName: e.tagName, required: /^\*/.test(clean(e.getAttribute('placeholder') || '')) || e.hasAttribute('required') };
        if (ft === 'hidden') o.value = /^(quform_form_uid|quform_csrf_token)$/.test(e.name) ? '' : (e.getAttribute('value') || '');
        fields.push(o);
      });
      var act = fm.getAttribute('action') || '';
      try { act = new URL(act, rec.link); act.hash = ''; act = act.toString(); } catch (e) { act = rec.link; }
      forms[k] = { pageUrl: rec.link, action: act, formClass: fm.getAttribute('class') || '', method: (fm.getAttribute('method') || 'post').toUpperCase(),
        enctype: fm.getAttribute('enctype') || 'multipart/form-data', fields: fields };
    }
  };
  await Promise.all([worker(), worker()]);
} catch (e) { console.warn('[amit] ' + (e && e.name === 'AbortError' ? 'fetch timed out' : e) + ' -> no items'); return; }
// --- body split (owner's job body rules) ---
var REQH = /^(?:דרישות(?:\s+(?:התפקיד|המשרה))?|Requirements)\s*:?$/i;
var DESCH = /^תיאור(?:\s+(?:התפקיד|המשרה))?\s*:?$/;
var MIXH = /^תיאור\s+ו?דרישות(?:\s+(?:התפקיד|המשרה))?\s*:?$/;
var REQW = /^[·•\-\s]*(ניסיון|ניסון|ידע|תואר|היכרות|הכרות|שליטה|יכולת|יכולות|תודעת|אנגלית|עברית|ערבית|רישיון|זמינות|עצמאות|יחסי אנוש)/;
var blocks = function (html) {
  var out = [];
  var walk = function (el) {
    Array.prototype.forEach.call(el.children, function (c) {
      if (c.tagName === 'UL' || c.tagName === 'OL') {
        var items = Array.prototype.map.call(c.querySelectorAll('li'), function (li) { return clean(li.textContent); }).filter(Boolean);
        if (items.length) out.push({ list: items });
        return;
      }
      if (c.tagName === 'DIV') { walk(c); return; }
      var x = c.cloneNode(true);
      x.querySelectorAll('br').forEach(function (b) { b.replaceWith('\n'); });
      (x.textContent || '').split('\n').map(clean).filter(Boolean).forEach(function (ln) { out.push({ line: ln }); });
    });
  };
  walk(parse(html).body);
  return out;
};
var split = function (html) {
  var d = [], r = [], mode = 'd', head = false;
  blocks(html).forEach(function (b) {
    if (b.list) {
      var target = mode === 'r' ? r : d;
      // a list with no heading of its own, at least half requirement lines, moves as one block (LRN-SETUP-24)
      if (mode !== 'r' && !head && b.list.filter(function (x) { return REQW.test(x); }).length * 2 >= b.list.length) target = r;
      b.list.forEach(function (x) { target.push({ li: true, text: x }); });
      head = false;
      if (mode === 'm') mode = 'd';
      return;
    }
    var ln = b.line;
    if (REQH.test(ln)) { mode = 'r'; head = true; return; }   // label dropped
    if (MIXH.test(ln)) { mode = 'm'; head = false; return; }  // "תיאור ודרישות התפקיד:" label dropped, list decided by its lines
    if (DESCH.test(ln)) { mode = 'd'; head = true; return; }  // label dropped
    if (mode !== 'r' && REQW.test(ln) && /^(ניסיון|ניסון|ידע|תואר)/.test(ln.replace(/^[·•\-\s]+/, ''))) { r.push({ li: false, text: ln }); head = false; return; }
    if (mode === 'r' && !REQW.test(ln) && /^(משרה|\*|שליחת|מיקום)/.test(ln)) mode = 'd';
    if (mode === 'm') mode = 'd';
    (mode === 'r' ? r : d).push({ li: false, text: ln });
    head = d.length > 0 && !/[.!]$/.test(ln) && ln.length < 40 && mode === 'd';   // a short sub-heading ("התפקיד כולל:") heads the next list
  });
  return { d: d, r: r };
};
// --- location: cue lines only, closed city.csv table ---
var CUE = /(מטה החברה|מיקום המשרה|ממוקמ|מקום העבודה)/;
var PLACES = [{ re: /(^|[\s,(\/:])ב?איירפורט[\s-]סיטי/, row: 'איירפורט סיטי' }];
var COMPANY_CITY = 'איירפורט סיטי';
var place = function (lines, own) {
  var out = [];
  lines.forEach(function (ln) {
    if (!CUE.test(ln)) return;
    PLACES.forEach(function (p) { if (p.re.test(ln) && out.indexOf(p.row) < 0) out.push(p.row); });
  });
  if (out.length) return out;
  return [own ? COMPANY_CITY : 'Unknown'];
};
// --- items ---
var box = document.createElement('div');
box.id = 'haide-amit';
box.style.display = 'none';
var dropped = [];
cards.forEach(function (c) {
  var rec = recs[c.k], f = forms[c.k];
  var title = decode(rec.title && rec.title.rendered).replace(MATH, function (ch) { return ch.normalize('NFKC'); });
  if (!OK1.test(title) || BAD.test(title)) { dropped.push(rec.id + ':lang'); return; }
  var s = split(rec.content && rec.content.rendered || '');
  var it = document.createElement('div');
  it.className = 'haide-job wp-exclude-emoji';
  var a = document.createElement('a');
  a.className = 'haide-link wp-exclude-emoji'; a.href = rec.link; a.textContent = title;
  it.appendChild(a);
  var add = function (cls, v) {
    var w = document.createElement('div');
    w.className = cls + ' wp-exclude-emoji';
    if (typeof v === 'string') { w.textContent = v; it.appendChild(w); return; }
    var ul = null;
    v.forEach(function (x) {
      if (x.li) { if (!ul) { ul = document.createElement('ul'); w.appendChild(ul); } var li = document.createElement('li'); li.className = 'wp-exclude-emoji'; li.textContent = x.text; ul.appendChild(li); }
      else { ul = null; var p = document.createElement('p'); p.className = 'wp-exclude-emoji'; p.textContent = x.text; w.appendChild(p); }
    });
    it.appendChild(w);
  };
  if (s.d.length) add('__ai-description', s.d);
  if (s.r.length) add('__ai-requirements', s.r);
  var lines = s.d.concat(s.r).map(function (x) { return x.text; });
  add('__ai-location', place(lines, c.type === 'jobs').join(', '));
  var dt = new Date(rec.date_gmt + 'Z');
  if (!isNaN(dt)) add('__ai-publishDate', dt.toISOString());
  var blob = JSON.stringify({ actionUrl: f.action, actionAttribute: f.action, formClass: f.formClass, formTag: 'form', method: f.method,
    enctype: f.enctype, pageUrl: f.pageUrl, fields: f.fields });
  add('__ai-applicationInfo', blob);
  add('__ai-formData', blob);
  box.appendChild(it);
});
document.body.appendChild(box);
console.log('[amit] cards ' + cards.length + ', jobs ' + box.children.length + ', dropped ' + dropped.join(' ') + ', ' + (Date.now() - T0) + ' ms');
