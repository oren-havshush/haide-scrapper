
var ITEM = '.job-card:not(#job-card-prototype)';
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var cards = function () { return Array.prototype.slice.call(document.querySelectorAll(ITEM)); };
var keyOf = function (c) {
  var code = c.querySelector('.job-code');
  var title = c.querySelector('.job-title');
  return ((code && code.textContent) || (title && title.textContent) || '').trim();
};
var codesOf = function () { return cards().map(keyOf).join(','); };

// Wait for a stable, NON-EMPTY list: the pager blanks the list mid-render, and
// reading during that window is what made single-pass walks miss rows.
var settle = async function (maxMs) {
  var t0 = Date.now(), prev = null, stable = 0;
  while (Date.now() - t0 < (maxMs || 9000)) {
    var now = codesOf();
    if (now && now === prev) { stable++; if (stable >= 2) return; } else { stable = 0; }
    prev = now;
    await sleep(350);
  }
};

var store = new Map();
var harvest = function () {
  cards().forEach(function (c) {
    var k = keyOf(c);
    if (k && !store.has(k)) store.set(k, c.cloneNode(true));
  });
};

var pagerNums = function () {
  return Array.prototype.slice.call(document.querySelectorAll('.pager-wrapper a'))
    .map(function (a) { return (a.textContent || '').trim(); })
    .filter(function (t) { return /^\d+$/.test(t); });
};

var trace = [];
await settle(9000);
harvest();
var pages = pagerNums();
// Guard: a full first page with no pager means pagination broke (selector drift).
// Bail rather than silently shipping only page 1 over a larger stored set.
if (!pages.length && store.size >= 12) { cards().forEach(function (c) { c.remove(); }); return; }
// The pager re-sorts server-side, so one circuit repeats some rows and drops
// others. Repeat whole circuits until a full pass adds nothing new.
for (var pass = 0; pass < 6; pass++) {
  var before = store.size;
  for (var i = 0; i < pages.length; i++) {
    var num = pages[i];
    var clicked = false;
    Array.prototype.slice.call(document.querySelectorAll('.pager-wrapper a')).forEach(function (a) {
      if (!clicked && (a.textContent || '').trim() === num) { a.click(); clicked = true; }
    });
    if (!clicked) continue;
    await settle(9000);
    harvest();
  }
  trace.push({ pass: pass + 1, distinct: store.size });
  if (store.size === before) break;
}
window.__harvestTrace = trace;

// Fail-closed: drop the live cards regardless. If harvesting found nothing the
// page is left empty -> empty_results -> the worker returns before deleteMany.
var host = null;
var first = document.querySelector(ITEM);
if (first && first.parentNode) host = first.parentNode;
cards().forEach(function (c) { c.remove(); });
if (!store.size || !host) return;
store.forEach(function (node) { host.appendChild(node); });
