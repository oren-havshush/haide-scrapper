var ITEM = '.career__accordion-item';
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

var HE_EN = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u;
var OTHER = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var REQ_HEAD = /^(דרישות|כישורים)(\s+ה?(תפקיד|משרה))?\s*:?\s*$/;
var LABEL = /^(תיאור(\s+ה?(תפקיד|משרה))?|(מה\s+)?התפקיד כולל)\s*[:?]?\s*$/;
// Pay/terms/equal-opportunity lines, hours and the place of work stay in the description.
var KEEP = /^[\s*–-]*(שכר|תנאים|המשרה (מיועדת|פונה)|משרה זו (מיועדת|פונה)|העבודה במשרה|משרה מלאה|שעות עבודה)/;
// No location tag on this page: the place is read from the ad's own text, closed set (LRN-LOC-4).
var PLACES = [[/באר[\s-]?שבע|ב["״]ש/, 'באר שבע'], [/אשדוד/, 'אשדוד']];
function bodyLines(el) {
  var c = el.cloneNode(true);
  Array.prototype.forEach.call(c.querySelectorAll('script,style,form,.wpcf7'), function (e) { e.remove(); });
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

Array.prototype.forEach.call(document.querySelectorAll(ITEM), function (item) {
  if (item.hasAttribute('data-haide')) return;
  item.setAttribute('data-haide', '1');
  var title = sq((item.querySelector('.career__accordion-title') || {}).textContent);
  var body = item.querySelector('.career__accordion-content');
  if (!title || !body) return;
  if (!HE_EN.test(title) || OTHER.test(title)) { item.remove(); return; }
  var r = split(bodyLines(body));
  var text = title + '\n' + r.desc.join('\n');
  var locs = [];
  PLACES.forEach(function (p) { if (p[0].test(text) && locs.indexOf(p[1]) < 0) locs.push(p[1]); });
  mk(item, '__ai-title', title);
  // No job number and no per-job URL on this page: id = h-haideHash(title).
  mk(item, '__ai-eid', 'h-' + haideHash(title));
  mk(item, '__ai-location', locs.length ? locs.join(', ') : 'Unknown');
  mk(item, '__ai-description', r.desc.join('\n'));
  mk(item, '__ai-requirements', r.req.join('\n'));
});
