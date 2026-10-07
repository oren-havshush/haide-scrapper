// korenvs.co.il/דרושים: one WordPress page, one div.collapse-box accordion row per job, body in
// .collapse-list, each with the same CF7 form 497 (invisible reCAPTCHA v3 on submit).
// id: no printed number, no per-job URL -> no id emitted; the worker synthesises h-<hash(title)>.
// "תאור המשרה" -> description, "דרישות התפקיד" -> requirements; labels dropped; nodes are moved,
// not re-rendered (LRN-SETUP-11). The page-level block printed once for all jobs (equal-opportunity
// line, office line, CV/portfolio instruction, the two lists) is appended to every description
// (job body rule 4); on a form site the apply instruction stays in description (LRN-APPLY-12).
// Location from work-location cue lines only: the job's own "העבודה ב... בפריסה ארצית" wins,
// else the page line "העבודה במשרדי החברה ב<city>" through a closed city.csv list, else Unknown.
var boxes = document.querySelectorAll('.section-drushim .collapse-box');
if (!boxes.length || document.querySelector('.section-drushim .collapse-box .__ai-location')) return;
var NBSP = String.fromCharCode(160);
var KEEP = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, OTHER = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var DESC_H = /^תי?אור\s+(ה)?(משרה|תפקיד)\s*:?$/, REQ_H = /^(דרישות|כישורים)(\s+(ה|ל)?(משרה|תפקיד))?\s*:?$/;
var CITY = { 'הוד השרון': 'הוד השרון' };
var norm = function (s) { return (s || '').split(NBSP).join(' ').replace(/\s+/g, ' ').trim(); };
// Pretty-printed markup leaves newline-only text nodes beside block elements and after <br>, which
// the worker turns into blank-line soup (LRN-SETUP-9). Drop only those nodes: structure, not text.
var BLOCK = /^(LI|UL|OL|DIV|P|H[1-6]|BR|FIELDSET)$/;
var tidy = function (root) {
  var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), dead = [], t;
  while ((t = w.nextNode())) {
    if (!/^\s*$/.test(t.nodeValue) || t.nodeValue.indexOf('\n') < 0) continue;
    var a = t.previousSibling, z = t.nextSibling;
    if ((!a || BLOCK.test(a.nodeName)) || (!z || BLOCK.test(z.nodeName))) dead.push(t);
  }
  dead.forEach(function (d) { d.remove(); });
  return root;
};
var common = document.querySelector('.section-drushim .common-box');
var pageLoc = 'Unknown';
if (common) {
  var pm = /העבודה\s+במשרדי\s+החברה\s+ב(הוד\s+השרון)(?![א-ת])/.exec(norm(common.textContent));
  if (pm && CITY[norm(pm[1])]) pageLoc = CITY[norm(pm[1])];
}
Array.prototype.forEach.call(boxes, function (box) {
  try {
    var tEl = box.querySelector('.collapse-btn span');
    var title = norm(tEl && tEl.textContent);
    if (!title || !KEEP.test(title) || OTHER.test(title)) { box.remove(); return; }
    var list = box.querySelector('.collapse-list');
    if (!list) return;
    var desc = document.createElement('div'), req = document.createElement('div');
    desc.className = '__ai-description';
    req.className = '__ai-requirements';
    var sec = desc, seenDescLabel = false;
    Array.prototype.slice.call(list.children).forEach(function (n) {
      if (n.matches('.border-btn-form, .form-vacancies') || n.querySelector('form')) return;
      var t = norm(n.textContent);
      if (!t && !n.querySelector('img')) { n.remove(); return; }
      if (DESC_H.test(t)) { sec = seenDescLabel ? req : desc; seenDescLabel = true; n.remove(); return; }
      if (REQ_H.test(t)) { sec = req; n.remove(); return; }
      sec.appendChild(n);
    });
    var own = norm(desc.textContent + ' ' + req.textContent);
    var loc = /(^|[.\s])העבודה\s+ב[^.]{0,40}בפריסה\s+ארצית/.test(own) ? 'פריסה ארצית' : pageLoc;
    if (common) Array.prototype.forEach.call(common.children, function (c) { desc.appendChild(c.cloneNode(true)); });
    box.appendChild(tidy(desc));
    if (norm(req.textContent)) box.appendChild(tidy(req));
    var l = document.createElement('span');
    l.className = '__ai-location';
    l.style.display = 'none';
    l.textContent = loc;
    box.appendChild(l);
  } catch (e) { }
});
