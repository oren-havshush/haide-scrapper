var ITEM = '.awsm-job-listing-item';
var prev = -1, stable = 0;
for (var t = 0; t < 60; t++) {
  var n = document.querySelectorAll(ITEM).length;
  if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n;
  await new Promise(function (r) { setTimeout(r, 500); });
}
if (!document.querySelector(ITEM)) return;

function haideHash(s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); }
function sq(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
function mk(item, cls, v) { if (!v) return; var s = document.createElement('span'); s.className = cls; s.style.display = 'none'; s.textContent = v; item.appendChild(s); }
function terms(root, key) { return Array.prototype.map.call(root.querySelectorAll('.awsm-job-specification-' + key + ' .awsm-job-specification-term'), function (e) { return sq(e.textContent); }).filter(function (x, i, a) { return x && a.indexOf(x) === i; }); }

// Only a verbatim city.csv value ships; any other location term becomes Unknown (LRN-LOC-4).
var CITY = { 'פתח תקווה': 'פתח תקווה', 'פתח תקוה': 'פתח תקווה' };
var HE_EN = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u;
var OTHER = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var REQ_HEAD = /^(דרישות|כישורים)(\s+ה?(תפקיד|משרה))?\s*:?\s*$/;
var LABEL = /^תיאור(\s+ה?(תפקיד|משרה))?\s*:?\s*$/;
var KEEP = /^\*?\s*(שכר|תנאים|המשרה (מיועדת|פונה)|משרה זו (מיועדת|פונה))/;
function bodyLines(el) {
  var c = el.cloneNode(true);
  // .code-block is the site's Ad Inserter banner (profitability calculator), injected into every post.
  Array.prototype.forEach.call(c.querySelectorAll('script,style,.code-block'), function (e) { e.remove(); });
  Array.prototype.forEach.call(c.querySelectorAll('br'), function (e) { e.replaceWith('\n'); });
  Array.prototype.forEach.call(c.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6'), function (e) { e.insertAdjacentText('afterend', '\n'); });
  return (c.textContent || '').split('\n').map(sq).filter(Boolean);
}
function split(lines) {
  var desc = [], req = [], inReq = false;
  lines.forEach(function (l) {
    if (LABEL.test(l)) return;
    if (REQ_HEAD.test(l)) { inReq = true; return; }
    if (inReq && !KEEP.test(l)) req.push(l); else desc.push(l);
  });
  return { desc: desc, req: req };
}

var items = Array.prototype.slice.call(document.querySelectorAll(ITEM)).filter(function (i) { return !i.hasAttribute('data-haide'); });
async function one(item) {
  item.setAttribute('data-haide', '1');
  // The plugin marks a closed posting awsm-job-expired-item; its page carries no apply form.
  if (item.classList.contains('awsm-job-expired-item')) { item.remove(); return; }
  var a = item.querySelector('.awsm-job-post-title a');
  if (!a) return;
  var title = sq(a.textContent), href = a.href;
  if (!HE_EN.test(title) || OTHER.test(title)) { item.remove(); return; }
  var doc;
  try { doc = new DOMParser().parseFromString(await (await fetch(href, { credentials: 'same-origin' })).text(), 'text/html'); } catch (e) { return; }
  var body = doc.querySelector('.awsm-job-entry-content');
  if (!body) return;
  var locs = [];
  terms(doc, 'job-location').forEach(function (x) { var v = CITY[x]; if (v && locs.indexOf(v) < 0) locs.push(v); });
  var ld = doc.documentElement.innerHTML.match(/"datePublished":"(\d{4}-\d\d-\d\d)/);
  var type = terms(doc, 'job-type');
  var r = split(bodyLines(body));
  if (type.length) r.desc.push('סוג משרה: ' + type.join(', '));
  var slug = decodeURIComponent(new URL(href).pathname.replace(/\/+$/, '').split('/').pop());
  mk(item, '__ai-title', title);
  mk(item, '__ai-url', href);
  mk(item, '__ai-eid', 'simplyclub-' + (/^[A-Za-z0-9._-]+$/.test(slug) ? slug :haideHash(slug)));
  mk(item, '__ai-location', locs.length ? locs.join(', ') : 'Unknown');
  mk(item, '__ai-dept', terms(item, 'job-category').join(', '));
  mk(item, '__ai-date', ld ? ld[1] : '');
  mk(item, '__ai-description', r.desc.join('\n'));
  mk(item, '__ai-requirements', r.req.join('\n'));
}
await Promise.all(items.map(one));
