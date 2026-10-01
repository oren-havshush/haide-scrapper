// supergas-power.co.il /career/ — listing-only; every job is a .career_item with its body and apply form inline.
var items = document.querySelectorAll('.career_item');
var tabs = {};
document.querySelectorAll('.career_domain_tab[data-id]').forEach(function (b) {
  var id = b.getAttribute('data-id');
  if (id && id !== '0') tabs[id] = (b.textContent || '').trim();
});
// The site's area filter → the verbatim city.csv entry for the same place (LRN-LOC-4).
var AREAS = { 'נתניה': 'נתניה', 'צפון': 'אזור צפון', 'כל הארץ': 'פריסה ארצית' };
var REQ_START = /^(ניסיון|נסיון|ידע|רישיון|רשיון|תעודה|תעודת|בעל\/ת|בעלת|בעל |יכולת|נכונות|זמינות|שליטה|הכרה|הכרת|מגורים|דובר|עדיפות|נדרש|יוצא|רצוי|גישה)/;
function lines(el, skipSel) {
  if (!el) return [];
  var c = el.cloneNode(true);
  if (skipSel) c.querySelectorAll(skipSel).forEach(function (e) { e.remove(); });
  c.querySelectorAll('p.text_24').forEach(function (e) { e.remove(); });
  c.querySelectorAll('p,div,ul,ol,li,br,h1,h2,h3,h4,h5,h6,tr').forEach(function (e) { e.insertAdjacentText('afterend', '\n'); });
  return c.textContent.split('\n').map(function (s) { return s.replace(/[ \t]+/g, ' ').trim(); }).filter(Boolean);
}
function put(item, cls, val) {
  var s = document.createElement('span');
  s.className = cls;
  s.style.display = 'none';
  s.textContent = val;
  item.appendChild(s);
}
items.forEach(function (item) {
  if (item.querySelector('.__ai-title')) return;
  var h = item.querySelector('.career_item_title');
  var raw = h ? (h.textContent || '').trim() : '';
  var m = /\(\s*קוד\s*משרה\s*(\d+)\s*\)/.exec(raw);
  if (!raw || !m) return;
  // Rule 7: the printed number ships as the id, and leaves the title.
  put(item, '__ai-jobid', 'supergas-' + m[1]);
  put(item, '__ai-title', raw.replace(/\s*[-–]?\s*\(\s*קוד\s*משרה\s*\d+\s*\)\s*/, ' ').trim());

  var content = item.querySelector('.career_content');
  var descLines = lines(content, '.more_details');
  var reqLines = lines(content ? content.querySelector('.more_details') : null);
  // LRN-SETUP-18: a requirement line under the role heading moves to requirements.
  var keep = [];
  descLines.forEach(function (l) {
    var isReq = (/חובה|יתרון/.test(l) || REQ_START.test(l)) && !/דרוש/.test(l) && !/\d:\d\d/.test(l) && l.length <= 150;
    if (isReq) reqLines.push(l); else keep.push(l);
  });
  if (keep.length) put(item, '__ai-description', keep.join('\n'));
  if (reqLines.length) put(item, '__ai-requirements', reqLines.join('\n'));

  var areaEl = item.querySelector('.career_areas');
  var areas = areaEl ? (areaEl.textContent || '').split(',') : [];
  var locs = [];
  areas.forEach(function (a) {
    a = a.trim();
    if (!a) return;
    var v = AREAS[a] || 'Unknown';
    if (locs.indexOf(v) === -1) locs.push(v);
  });
  if (locs.length > 1 && locs.indexOf('Unknown') !== -1) locs.splice(locs.indexOf('Unknown'), 1);
  put(item, '__ai-location', locs.length ? locs.join(', ') : 'Unknown');

  var deps = [];
  (item.getAttribute('data-id') || '').split(',').forEach(function (id) {
    id = id.trim();
    if (tabs[id] && deps.indexOf(tabs[id]) === -1) deps.push(tabs[id]);
  });
  if (deps.length) put(item, '__ai-department', deps.join(', '));
});
