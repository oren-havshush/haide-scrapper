// brooks-keret.co.il/join-the-team/#positions. Owner 2026-10-18: only the jobs on this careers page go in
// (the site map is not a job listing). One item per /positions/<slug>/ card inside #positions.
// Body and date come from the WP REST record of that job (/wp-json/wp/v2/positions, the same text the job
// page shows); the apply form is read from the job's own page (hidden values included).
// ALL-OR-NOTHING: a failed fetch, a link with no REST record or a job page with no apply form builds no item.
// Id: the job number printed in the ad ("משרה #N", "מספר משרה: N") as brooks-keret-<N>; no number -> no id,
// the worker makes its own h- id from title, department and url. Location: cue lines only, closed table.
if (document.getElementById('haide-bk')) return;
var T0 = Date.now();
var NB = String.fromCharCode(160);
var WS = new RegExp('[\\s' + NB + ']+', 'g');
var clean = function (s) { return String(s || '').replace(WS, ' ').trim(); };
var OK1 = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var MATH = new RegExp('[' + String.fromCodePoint(0x1D400) + '-' + String.fromCodePoint(0x1D7FF) + ']', 'gu');
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var key = function (u) { try { u = decodeURIComponent(new URL(u, location.href).pathname); } catch (e) {} return String(u).toLowerCase().replace(/\/+$/, ''); };
var POS = /^\/positions\/[^\/]+$/;
var linksNow = function () {
  var out = [];
  // the careers cards: a clickable div.ecs-link-wrapper[data-href] (no <a>); only inside the #positions grid
  document.querySelectorAll('#positions a[href*="/positions/"], #positions [data-href*="/positions/"]').forEach(function (a) {
    var k = key(a.getAttribute('href') || a.getAttribute('data-href'));
    if (POS.test(k)) out.push(k);   // every link, repeats included: the worker collapses a job by its URL
  });
  return out;
};
// the cards are server-rendered; still wait for a stable count
var links = [], prev = -1, stable = 0;
for (var t = 0; t < 40; t++) {
  links = linksNow();
  if (links.length > 0 && links.length === prev) { if (++stable >= 2) break; } else stable = 0;
  prev = links.length;
  await sleep(500);
}
if (!links.length) { console.warn('[bk] no job links on ' + location.href); return; }
var get = async function (url, json) {
  for (var a = 0; a < 2; a++) {
    try {
      var r = await fetch(url, { credentials: 'include', cache: 'no-store' });
      if (r.ok && !r.redirected) return json ? { body: await r.json(), pages: +(r.headers.get('X-WP-TotalPages') || 1) } : await r.text();
    } catch (e) {}
    await sleep(1500);
  }
  return null;
};
// --- REST records ---
var recs = {};
for (var pg = 1, last = 1; pg <= last; pg++) {
  var res = await get(location.origin + '/wp-json/wp/v2/positions?per_page=100&page=' + pg + '&_fields=id,date_gmt,link,title,content', true);
  if (!res || !Array.isArray(res.body)) { console.warn('[bk] REST page ' + pg + ' failed'); return; }
  last = res.pages;
  res.body.forEach(function (r) { recs[key(r.link)] = r; });
}
var miss = links.filter(function (k) { return !recs[k]; });
if (miss.length) { console.warn('[bk] links with no REST record: ' + miss.join(' ')); return; }
var parse = function (h) { return new DOMParser().parseFromString(h, 'text/html'); };
var decode = function (h) { return clean(parse('<b>' + h + '</b>').body.textContent); };
// --- each job page's own apply form (the Elementor form that carries form_fields[title]) ---
var keys = links.filter(function (k, i) { return links.indexOf(k) === i; });
var forms = {}, failed = [], queue = keys.slice();
var worker = async function () {
  while (queue.length) {
    var k = queue.shift(), url = recs[k].link;
    var h = await get(url, false);
    var fm = h ? parse(h).querySelector('form.elementor-form input[name="form_fields[title]"]') : null;
    fm = fm ? fm.closest('form') : null;
    if (!fm) { failed.push(k); continue; }
    var fields = [];
    fm.querySelectorAll('input, select, textarea').forEach(function (e) {
      var ft = (e.tagName === 'INPUT' ? (e.getAttribute('type') || 'text') : e.tagName.toLowerCase()).toLowerCase();
      if (/^(submit|button|reset|image)$/.test(ft) || !e.name) return;
      // a text box the page hides with display:none is a spam trap: never stored, never filled (LRN-FORM-14)
      if (ft !== 'hidden' && /display\s*:\s*none/i.test(e.getAttribute('style') || '')) return;
      var lb = e.id ? fm.querySelector('label[for="' + e.id + '"]') : null;
      var o = { name: e.name, label: clean(lb ? lb.textContent : e.getAttribute('placeholder') || ''), fieldType: ft,
        tagName: e.tagName, required: e.hasAttribute('required') };
      if (ft === 'hidden') o.value = e.getAttribute('value') || '';
      fields.push(o);
    });
    forms[k] = { pageUrl: url, formClass: fm.getAttribute('class') || '', method: (fm.getAttribute('method') || 'post').toUpperCase(), fields: fields };
  }
};
await Promise.all([worker(), worker(), worker()]);
if (failed.length) { console.warn('[bk] job pages with no apply form: ' + failed.join(' ')); return; }
// --- body split ---
var NUM = /^(?:מספר\s+משרה|משרה)\s*:?\s*#?\s*(\d{4,})\s*#?$/;
var REQH = /^(?:דרישות(?:\s+(?:התפקיד|המשרה))?)\s*:?$/;
var REQK = /^ניסיון\s+חובה\s*:?$/;            // a requirements heading that says something: kept as a line
var DESCH = /^תיאור(?:\s+(?:התפקיד|המשרה))?\s*:?$/;
var SUBH = /[:?]$/;                            // "תחומי אחריות:", "התפקיד כולל:", "מה מחכה לך?"
var REQW = /^(ניסיון|אנגלית|עברית|ידע|תואר|היכרות|שליטה|יכולת|יכולות|רו"ח|תעודת|אנרגטיות|יחסי אנוש|סדר|גישה|עצמאות|זמינות|רישיון)/;
var split = function (html) {
  var root = parse(html).body, d = [], r = [], mode = 'd', num = '', lastHead = true;
  Array.prototype.forEach.call(root.children, function (el) {
    var tag = el.tagName;
    if (tag === 'UL' || tag === 'OL') {
      var items = Array.prototype.map.call(el.querySelectorAll('li'), function (li) { return clean(li.textContent); }).filter(Boolean);
      var target = mode === 'r' ? r : d;
      // a list with no heading of its own, mostly requirement lines, moves as one block (rule 1)
      if (mode === 'd' && !lastHead && items.length && items.filter(function (x) { return REQW.test(x); }).length * 2 >= items.length) target = r;
      items.forEach(function (x) { target.push({ li: true, text: x }); });
      lastHead = false;
      return;
    }
    var c = el.cloneNode(true);
    c.querySelectorAll('br').forEach(function (b) { b.replaceWith('\n'); });
    (c.textContent || '').split('\n').map(clean).filter(Boolean).forEach(function (ln) {
      var m = NUM.exec(ln);
      if (m) { num = num || m[1]; return; }                   // rule 7: the number line leaves the text
      if (REQH.test(ln)) { mode = 'r'; lastHead = true; return; }  // label dropped
      if (REQK.test(ln)) { mode = 'r'; lastHead = true; r.push({ li: false, text: ln }); return; }
      if (DESCH.test(ln)) { mode = 'd'; lastHead = true; return; }
      if (/^\*/.test(ln)) { d.push({ li: false, text: ln }); lastHead = false; return; }   // footnotes stay in the description
      if (mode === 'd' && /^נדרש/.test(ln)) { r.push({ li: false, text: ln }); lastHead = false; return; }
      if (SUBH.test(ln) && ln.length < 40) { mode = 'd'; lastHead = true; d.push({ li: false, text: ln }); return; }
      (mode === 'r' ? r : d).push({ li: false, text: ln });
      lastHead = false;
    });
  });
  return { d: d, r: r, num: num };
};
// --- location: work-place cue lines only, closed city.csv table ---
var CUE = /(ממוקמ|היושב|יושבת|יושבים|במשרד|לסטארטאפ|לחברה|לחברת|לארגון|מקום העבודה)/;
var PLACES = [
  { re: /(^|[\s,(\/])ב?תל[\s-]אביב/, row: 'תל אביב-יפו' },
  { re: /(^|[\s,(\/])ב?קדימה(?=$|[\s,.)\/])/, row: 'קדימה צורן' },
];
var place = function (lines) {
  var out = [];
  lines.forEach(function (ln) {
    if (!CUE.test(ln)) return;
    PLACES.forEach(function (p) { if (p.re.test(ln) && out.indexOf(p.row) < 0) out.push(p.row); });
  });
  return out.length ? out : ['Unknown'];
};
// --- items ---
var box = document.createElement('div');
box.id = 'haide-bk';
box.style.display = 'none';
var dropped = [];
links.forEach(function (k) {
  var rec = recs[k], f = forms[k];
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
  if (s.num) add('__ai-externalJobId', 'brooks-keret-' + s.num);
  if (s.d.length) add('__ai-description', s.d);
  if (s.r.length) add('__ai-requirements', s.r);
  add('__ai-location', place([title].concat(s.d.map(function (x) { return x.text; }))).join(', '));
  var dt = new Date(rec.date_gmt + 'Z');
  if (!isNaN(dt)) add('__ai-publishDate', dt.toISOString());
  // the job's own form as its page sends it: Elementor posts to admin-ajax.php by script (no action attribute)
  var blob = JSON.stringify({ actionUrl: location.origin + '/wp-admin/admin-ajax.php', actionAttribute: '', formClass: f.formClass,
    formTag: 'form', method: f.method, enctype: 'multipart/form-data', pageUrl: f.pageUrl, fields: f.fields });
  add('__ai-applicationInfo', blob);
  add('__ai-formData', blob);
  box.appendChild(it);
});
document.body.appendChild(box);
console.log('[bk] ' + location.pathname + ': links ' + links.length + ', jobs ' + box.children.length + ', dropped ' + dropped.join(' ') + ', ' + (Date.now() - T0) + ' ms');
