// hr.technion.ac.il/positions/ ("דרושים", external tenders) - server-rendered table, listing-only.
//
// Each .wrapper-job is one tender: a header row (.wrap-job: .col-3 title, .col-2 unit, .col-1 the
// printed tender number "תשפו/94") and an accordion body holding the whole posting
// (.wrap-description, .wrap-required-skills, .wrap-scope-of-job, .wrap-remarks, .bottom-text).
// The same text is on the ?jobid= page, so no detail step is needed.
//
// - title: .col-3 as printed (whitespace collapsed). Hebrew/English titles only (addsite3 language gate).
// - externalJobId: the system id from the row's own "?jobid=<n>" link, namespaced technion-<n>
//   (owner 2026-10-11: ASCII ids only). The data-job attribute (JB-nnnn) is NOT used: two different
//   tenders share JB-2576 on 2026-10-11. No numeric jobid -> no id; the worker then makes its own.
// - description: the role text, then the scope line, the remarks, and the closing lines printed on
//   every card. Section labels dropped; one <p> per printed line, no characters added.
// - requirements: the "הכישורים הדרושים" block, line by line.
// - department: the unit (.col-2).
// - location: "חיפה" on every job, a site rule (owner 2026-10-11: single campus, as kortec).
//   Injected, never left empty, so the gazetteer cannot guess.
var SEL = '.wrapper-job';
var prev = -1, stable = 0;
for (var t = 0; t < 20; t++) {
  var n = document.querySelectorAll(SEL).length;
  if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n;
  await new Promise(function (r) { setTimeout(r, 250); });
}
var HEB_LAT = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u;
var OTHER = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var JOBID = /[?&]jobid=(\d+)(?:&|$)/;
var clean = function (s) { return (s || '').replace(/\s+/g, ' ').trim(); };
// Lines of an element, split at <br> and block children; the heading (h4) is skipped.
var linesOf = function (el) {
  var out = [], cur = '';
  if (!el) return out;
  var walk = function (node) {
    for (var k = 0; k < node.childNodes.length; k++) {
      var c = node.childNodes[k];
      if (c.nodeType === 3) { cur += c.textContent; continue; }
      if (c.nodeType !== 1) continue;
      var tag = c.tagName;
      if (tag === 'H4' || tag === 'SCRIPT' || tag === 'STYLE') continue;
      if (tag === 'BR') { out.push(cur); cur = ''; continue; }
      if (tag === 'DIV' || tag === 'P' || tag === 'LI') { out.push(cur); cur = ''; walk(c); out.push(cur); cur = ''; continue; }
      walk(c);
    }
  };
  walk(el);
  out.push(cur);
  return out.map(clean).filter(function (l) { return l.length > 0; });
};
var items = document.querySelectorAll(SEL);
for (var i = 0; i < items.length; i++) {
  var item = items[i];
  try {
    if (item.querySelector('.__ai-title')) continue;
    var title = clean((item.querySelector('.wrap-job .col-3') || {}).textContent);
    if (!title || !HEB_LAT.test(title) || OTHER.test(title)) { item.remove(); continue; }
    var unit = clean((item.querySelector('.wrap-job .col-2') || {}).textContent);
    var desc = linesOf(item.querySelector('.wrap-description .wrap-text'));
    var scope = clean((item.querySelector('.wrap-scope-of-job .wrap-text') || {}).textContent);
    if (scope) desc.push('היקף המשרה: ' + scope);
    desc = desc.concat(linesOf(item.querySelector('.wrap-remarks')));
    desc = desc.concat(linesOf(item.querySelector('.bottom-text')));
    var req = linesOf(item.querySelector('.wrap-required-skills .wrap-text'));
    var add = function (cls, val) {
      var el = document.createElement(Array.isArray(val) ? 'div' : 'span');
      el.className = cls;
      el.style.display = 'none';
      if (Array.isArray(val)) {
        for (var v = 0; v < val.length; v++) {
          var pe = document.createElement('p');
          pe.textContent = val[v];
          el.appendChild(pe);
        }
      } else {
        el.textContent = val;
      }
      item.appendChild(el);
    };
    add('__ai-title', title);
    var link = item.querySelector('.wrap-btn a');
    var jm = JOBID.exec(link ? (link.getAttribute('href') || '') : '');
    if (jm) add('__ai-id', 'technion-' + jm[1]);
    if (unit) add('__ai-department', unit);
    if (desc.length) add('__ai-description', desc);
    if (req.length) add('__ai-requirements', req);
    add('__ai-location', 'חיפה');
  } catch (e) {
    // degrade per item (LRN-WRK-19)
  }
}
