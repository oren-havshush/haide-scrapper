
// razel.co.il reuses .productCode across several postings (34 cards -> 29 codes).
// externalJobId stays .productCode, so the worker's dedupe would keep whichever
// card happened to come first — which for code 4063 is the one with an EMPTY
// description. Keep the richest card per code instead and drop the others, so
// the stored job always carries the fullest text.
var txt = function (el) { return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : ''; };
var items = Array.prototype.slice.call(document.querySelectorAll('.productDiv'));
if (!items.length) return;                       // nothing to do; leave DOM untouched
var groups = {};
items.forEach(function (it) {
  var code = txt(it.querySelector('.productCode'));
  if (!code) return;                             // no code -> never dropped
  (groups[code] = groups[code] || []).push(it);
});
Object.keys(groups).forEach(function (code) {
  var g = groups[code];
  if (g.length < 2) return;
  var best = null, bestDesc = -1, bestTitle = -1;
  g.forEach(function (it) {
    var d = txt(it.querySelector('.productDesDiv')).length;
    var t = txt(it.querySelector('.productName')).length;
    if (d > bestDesc || (d === bestDesc && t > bestTitle)) { best = it; bestDesc = d; bestTitle = t; }
  });
  g.forEach(function (it) { if (it !== best) it.remove(); });
});
