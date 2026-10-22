// safelog — 2 roles as bare <li> in an Elementor text widget. No per-job page,
// no per-job body: every field is injected here.
var ROW = "ul:not([class]) > li:not([class])";
var HEB = new RegExp("[" + String.fromCharCode(0x0590) + "-" + String.fromCharCode(0x05ff) + "]");

function slHash(s) {
  var h = 5381, i = s.length;
  while (i) { h = (h * 33) ^ s.charCodeAt(--i); }
  return (h >>> 0).toString(36);
}

// Operator decision 2026-09-23: the full-time role names its site only in the
// title, as "באזור לוד". city.csv has no "לוד" — the row that covers it is
// "רמלה לוד", and that is what is stored. The part-time role names nothing and
// stays Unknown. Nothing else on this page is a location, and "אזור" on its own
// is a town in city.csv that must never be matched here (LRN-LOC-11).
function slCity(title) {
  var at = title.indexOf("לוד");
  if (at === -1) return "Unknown";
  var after = title.charAt(at + 3);
  if (after && HEB.test(after)) return "Unknown";
  return "רמלה לוד";
}

var rows = Array.prototype.slice.call(document.querySelectorAll(ROW));
if (rows.length) {
  // Shared page copy: one block introduces both roles, so it travels with each
  // (owner rule 4). The how-to-apply line is lifted out into applicationInfo.
  var box = rows[0].closest(".elementor-widget-container");
  var intro = [], applyLine = "";
  if (box) {
    var kids = Array.prototype.slice.call(box.children);
    for (var k = 0; k < kids.length; k++) {
      if (kids[k].tagName === "UL") continue;
      var t = (kids[k].textContent || "").replace(/\s+/g, " ").trim();
      if (!t) continue;
      if (t.indexOf("@") !== -1) { applyLine = t; continue; }
      if (/^משרות פנויות/.test(t)) continue;
      intro.push(t);
    }
  }
  var descText = intro.join("\n");

  var email = "";
  var m = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(applyLine || "");
  if (m) email = m[0];
  var applyText = applyLine || email;

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (row.querySelector(".__ai-id")) continue;
    var title = (row.textContent || "").replace(/\s+/g, " ").trim();
    if (!title) continue;

    var add = function (cls, val) {
      if (!val) return;
      var e = document.createElement("span");
      e.className = cls;
      e.style.display = "none";
      e.textContent = val;
      row.appendChild(e);
    };

    add("__ai-title", title);
    add("__ai-id", "safelog-" + slHash(title));
    add("__ai-location", slCity(title));
    add("__ai-description", descText);
    add("__ai-apply", applyText);
  }
}
