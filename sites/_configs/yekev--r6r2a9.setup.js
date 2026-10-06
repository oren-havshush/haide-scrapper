var ITEM = 'div[class*="Jobs_JobContainer__"]';
var prev = -1, stable = 0;
for (var t = 0; t < 60; t++) {
  var n = document.querySelectorAll(ITEM).length;
  if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n;
  await new Promise(function (r) { setTimeout(r, 500); });
}
// Location per job, read by hand from each ad's own text (2026-10-06). A job not
// listed here gets Unknown: city names are never scanned out of prose.
var LOC = {
  '8152': 'ירושלים, פתח תקווה',
  '8147': 'ירושלים, פתח תקווה',
  '8015': 'ירושלים, פתח תקווה',
  '8014': 'ירושלים, פתח תקווה',
  '8012': 'ירושלים, פתח תקווה',
  '8013': 'פריסה ארצית',
  '8011': 'חיפה, ירושלים, אזור צפון, אזור מרכז'
};
var INVIS = new RegExp('[' + String.fromCharCode(0x200E, 0x200F, 0xA0, 0x200B) + ']', 'g');
var MOVE = /^המשרה מתאימה ל/;
function lines(el) {
  if (!el) return [];
  var c = el.cloneNode(true);
  var w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
  var tn;
  while ((tn = w.nextNode())) tn.nodeValue = tn.nodeValue.replace(/\s+/g, ' ');
  c.querySelectorAll('br').forEach(function (b) { b.replaceWith('\n'); });
  c.querySelectorAll('p,div,ul,ol,li,h1,h2,h3,h4,h5,h6,tr').forEach(function (e) { e.insertAdjacentText('afterend', '\n'); });
  return c.textContent.split('\n').map(function (s) { return s.trim(); })
    .filter(function (s) { return s.replace(INVIS, '').trim().length > 0; });
}
function put(item, cls, text, tag, href) {
  if (item.querySelector('.' + cls)) return;
  var s = document.createElement(tag || 'span');
  s.className = cls; s.style.display = 'none';
  if (href) s.setAttribute('href', href);
  s.textContent = text;
  item.appendChild(s);
}
document.querySelectorAll(ITEM).forEach(function (item) {
  var a = item.querySelector('a[href*="/job/"]');
  var m = a && /\/job\/(\d+)/.exec(a.getAttribute('href'));
  if (!m) return;
  var id = m[1];
  var h1 = item.querySelector('[class*="Jobs_Title__"] h1');
  var desc = lines(item.querySelector('[class*="Jobs_Description__"] [class*="Jobs_BodyText__"]'));
  var req = lines(item.querySelector('[class*="Jobs_Requirements__"] [class*="Jobs_BodyText__"]'));
  var keep = [];
  desc.forEach(function (l) { if (MOVE.test(l)) req.push(l); else keep.push(l); });
  put(item, '__ai-id', 'yekev-' + id);
  put(item, '__ai-title', h1 ? h1.textContent.trim() : '');
  put(item, '__ai-description', keep.join('\n'));
  put(item, '__ai-requirements', req.join('\n'));
  put(item, '__ai-location', LOC[id] || 'Unknown');
  put(item, '__ai-detailurl', 'https://yekev.co.il/job/' + id, 'a', 'https://yekev.co.il/job/' + id);
});
