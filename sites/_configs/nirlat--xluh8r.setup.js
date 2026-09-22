// nirlat careers (WordPress + Elementor, hello-elementor-child/js/careers.js).
// The theme hides every .career-row at startup and only a filter submit reveals
// them; extraction reads textContent so hidden rows still work, but we force
// them visible so the rendered page matches what is scraped.
var ROW = "div.career-row";
var prev = -1, stable = 0;
for (var t = 0; t < 40; t++) {
  var n = document.querySelectorAll(ROW).length;
  if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n;
  await new Promise(function (r) { setTimeout(r, 500); });
}

if (!document.getElementById("__ai-show")) {
  var stEl = document.createElement("style");
  stEl.id = "__ai-show";
  // Beats the inline display:none jQuery .hide() writes at document.ready.
  stEl.textContent = ".career-row{display:block !important}";
  document.head.appendChild(stEl);
}

// region id -> "CSV files/city.csv" entry, verbatim. The site's own filter
// vocabulary is regional, not municipal; anything unmapped stays Unknown so the
// normalizer's gazetteer fallback (which would scan the title and the prose for
// a city name) never fires.
var REGIONS = {
  "1": "אזור צפון",
  "2": "אזור דרום",
  "3": "אזור השרון",
  "4": "אזור מרכז",
  "5": "אזור שפלה",
  "7": "אזור דרום",
  "8": "אזור ירושלים"
};
var CATS = {
  "188": "מחקר והנדסה",
  "760": "ייצור והפצה",
  "762": "שרות לקוחות",
  "763": "מכירות",
  "764": "תפעול ולוגיסטיקה",
  "765": "מטה ושיווק"
};

var rows = Array.prototype.slice.call(document.querySelectorAll(ROW));
for (var i = 0; i < rows.length; i++) {
  var row = rows[i];
  var codeEl = row.querySelector("span.value.job-id");
  var code = codeEl ? (codeEl.getAttribute("data-code") || "").trim() : "";
  var titleEl = row.querySelector("h3.job-title");
  var titleTxt = titleEl ? (titleEl.textContent || "").trim() : "";

  // Evergreen "no suitable job?" CV-drop entry (JB-717) is not a posting.
  if (code === "JB-717" || /^לא מצאת משרה/.test(titleTxt)) {
    row.remove();
    continue;
  }
  if (row.querySelector(".__ai-location")) continue;

  // location
  var rid = String(row.getAttribute("data-region_id") || "").trim();
  var loc = document.createElement("span");
  loc.className = "__ai-location";
  loc.textContent = REGIONS[rid] || "Unknown";
  row.appendChild(loc);

  // department
  var dep = "";
  try {
    var ids = JSON.parse(row.getAttribute("data-cat_ids") || "[]");
    for (var c = 0; c < ids.length; c++) {
      if (CATS[String(ids[c])]) { dep = CATS[String(ids[c])]; break; }
    }
  } catch (e) { dep = ""; }
  if (dep) {
    var depEl = document.createElement("span");
    depEl.className = "__ai-department";
    depEl.textContent = dep;
    row.appendChild(depEl);
  }

  // publishDate: the site prints DD/MM/YYYY; store ISO so nothing guesses.
  var dEl = row.querySelector("div.col.col-meta:not(.header_row) span.value");
  var dTxt = dEl ? (dEl.textContent || "").trim() : "";
  var dm = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dTxt);
  if (dm) {
    var pd = document.createElement("span");
    pd.className = "__ai-publishDate";
    pd.textContent = dm[3] + "-" + dm[2] + "-" + dm[1];
    row.appendChild(pd);
  }

  // description / requirements: one .job-description block holds both, each
  // introduced by a <strong> label. Split at the requirements label, drop both
  // labels, and clone the nodes so the extractor keeps the block line breaks.
  var jd = row.querySelector("div.job-description");
  if (jd) {
    var kids = Array.prototype.slice.call(jd.children);
    var splitIdx = -1;
    for (var k = 0; k < kids.length; k++) {
      var s = kids[k].querySelector ? kids[k].querySelector("strong") : null;
      if (s && /דרישות התפקיד/.test(s.textContent || "")) { splitIdx = k; break; }
    }
    var descNodes = splitIdx === -1 ? kids : kids.slice(0, splitIdx);
    var reqNodes = splitIdx === -1 ? [] : kids.slice(splitIdx);
    var mk = function (nodes, cls) {
      var box = document.createElement("div");
      box.className = cls;
      for (var j = 0; j < nodes.length; j++) {
        var cl = nodes[j].cloneNode(true);
        var strongs = cl.querySelectorAll ? cl.querySelectorAll("strong") : [];
        for (var q = 0; q < strongs.length; q++) {
          if (/תיאור המשרה|דרישות התפקיד/.test(strongs[q].textContent || "")) {
            strongs[q].remove();
          }
        }
        box.appendChild(cl);
      }
      return box;
    };
    if (descNodes.length) row.appendChild(mk(descNodes, "__ai-description"));
    if (reqNodes.length) row.appendChild(mk(reqNodes, "__ai-requirements"));
  }
}
