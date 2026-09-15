var ITEM_SEL = '.uno_faq .single-question';
var prev = -1, stable = 0;
for (var t = 0; t < 60; t++) {
  var n = document.querySelectorAll(ITEM_SEL).length;
  if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n;
  await new Promise(function (r) { setTimeout(r, 500); });
}
var structuredText = function (el) {
  if (!el) return '';
  var c = el.cloneNode(true);
  // Source-formatting newlines between tags are not line breaks; only block boundaries are.
  var w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) w.currentNode.nodeValue = w.currentNode.nodeValue.replace(/\s*\n\s*/g, ' ');
  c.querySelectorAll('p,div,ul,ol,li,br,h1,h2,h3,h4,h5,h6,tr').forEach(function (e) { e.insertAdjacentText('afterend', '\n'); });
  return c.textContent.replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
};
var mk = function (item, cls, val) {
  var s = document.createElement('span');
  s.className = cls; s.style.display = 'none'; s.textContent = val;
  item.appendChild(s);
};
// Campus -> verbatim "CSV files/city.csv" entry. Ono's campuses: Kiryat Ono, Jerusalem, Haifa.
var CAMPUS = [
  [/קרית\s*אונו|קריית\s*אונו|קמפוס\s*אונו/, 'קריית אונו'],
  [/ירושלים/, 'ירושלים'],
  [/חיפה/, 'חיפה']
];
var places = function (s) {
  var out = [];
  CAMPUS.forEach(function (p) { if (p[0].test(s) && out.indexOf(p[1]) < 0) out.push(p[1]); });
  return out;
};
document.querySelectorAll(ITEM_SEL).forEach(function (item) {
  if (item.querySelector('.__ai-description')) return;
  var titleEl = item.querySelector('button.question > span');
  var title = titleEl ? titleEl.textContent.replace(/\s+/g, ' ').trim() : '';
  var answer = item.querySelector('.answer');
  var body = structuredText(answer);

  // Req number printed in the title ("משרה מס' 2905", "מס' משרה 2891", "מספר משרה 2903").
  // No number -> leave the span absent; the worker synthesises a stable h-<hash>.
  var m = /(?:משרה\s*מס['׳]?|מס['׳]?\s*משרה|מספר\s*משרה)\s*(\d{3,6})/.exec(title);
  if (m) mk(item, '__ai-externalJobId', 'ono-' + m[1]);

  // Clean title: drop the req-number prefix.
  mk(item, '__ai-title', title.replace(/^(?:משרה\s*מס['׳]?|מס['׳]?\s*משרה|מספר\s*משרה)\s*\d+\s*:\s*/, '').trim());

  // Split the body: the "דרישות התפקיד" section -> requirements, the CV line -> applicationInfo,
  // everything else stays in description. The section ends at a blank line, or (2884, no blank
  // lines) where its bullets stop.
  var lines = body.split('\n');
  var descLines = [], reqLines = [], applyLines = [];
  var BULLET = /^\s*[·•]/;
  var inReq = false;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (/onojobs@|קו["״]?ח/.test(line)) { applyLines.push(line.trim()); inReq = false; continue; }
    if (/^\s*דרישות(\s+ה?תפקיד)?\s*:?\s*$/.test(line)) { inReq = true; continue; }
    if (inReq) {
      var bulleted = reqLines.length > 0 && reqLines.every(function (r) { return BULLET.test(r); });
      if (!line.trim() || (bulleted && !BULLET.test(line))) { inReq = false; }
      else { reqLines.push(line); continue; }
    }
    descLines.push(line);
  }
  var desc = descLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  mk(item, '__ai-description', desc);
  if (reqLines.length) mk(item, '__ai-requirements', reqLines.join('\n').trim());

  // Location: the body's own "מיקום" line first; the title only when the body has none.
  var locLine = (body.split('\n').filter(function (l) { return /^\s*מיקום/.test(l); })[0]) || '';
  var locs = places(locLine);
  if (!locs.length) locs = places(title);
  if (locs.length) mk(item, '__ai-location', locs.join(', '));

  // The site's own apply sentence, whitespace squashed and the email un-glued from the next
  // word ("onojobs@ono.ac.ilנא" on 2884). Fallback only if a posting ever drops the line.
  var applyText = applyLines.join(' ').replace(/\s+/g, ' ').replace(/(@[\w.-]+\.[a-z]{2,})(?=[֐-׿])/g, '$1 ').trim();
  mk(item, '__ai-apply', applyText || 'onojobs@ono.ac.il');
});
