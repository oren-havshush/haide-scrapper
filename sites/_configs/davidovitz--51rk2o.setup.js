// davidovitz / מאפיית דוידוביץ' — jobs on the "טופס הגשת מועמדות" page (Elementor posts loop,
// WordPress category 50 "משרות"). Listing-only: every card carries the whole ad, and the
// posts' own permalinks are not linked from the page. One shared Elementor apply form below.
//
// Card template (heading widgets in order): "שם המשרה:" <h1 title>, "קוד משרה:" <code>,
// "מחלקה:" <department>, "תאור המשרה:" <post content>.
//
// id: the printed קוד משרה, namespaced davidovitz-<code> (LRN-ID-11). No code -> no id
// (the worker synthesises h-<hash>).
// body: the ad prints no requirements heading. The leading run of lines is requirements
// (LRN-SETUP-18 test, moved as a block when at least half the run qualifies); from the first
// employment-terms line (shifts / days a week / "המשרה מיועדת") on, it is description.
// rule 7 exception: the shared form asks for קוד משרה and cannot tell the jobs apart, so the
// ad's own "קוד משרה: <n>" line closes the description.
// publishDate: the WP REST date of the card's own post (post-<id>), a field for a job the
// page shows (never a coverage source). A failed fetch leaves the date empty.
var ITEM_SEL = "article.ecs-post-loop";
var prev = -1, stable = 0;
for (var t = 0; t < 40; t++) {
  var n0 = document.querySelectorAll(ITEM_SEL).length;
  if (n0 > 0 && n0 === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n0;
  await new Promise(function (r) { setTimeout(r, 500); });
}
var items = document.querySelectorAll(ITEM_SEL);
if (!items.length) return;

var dates = {};
try {
  var res = await fetch("/wp-json/wp/v2/posts?categories=50&per_page=100&_fields=id,date", { credentials: "omit" });
  if (res.ok) {
    var arr = await res.json();
    for (var a = 0; a < arr.length; a++) {
      if (arr[a] && arr[a].id && /^\d{4}-\d{2}-\d{2}/.test(String(arr[a].date || ""))) dates[String(arr[a].id)] = String(arr[a].date).slice(0, 10);
    }
  }
} catch (e) { /* no dates */ }

var REQ_START = /^(ניסיון|נסיון|ידע|רישיון|רשיון|תעודה|תעודת|בעל|בעלת|בעל\/ת|יכולת|נכונות|זמינות|שליטה|הכרה|הכרת|מגורים|דובר|דוברת|עדיפות|נדרש|נדרשת|יוצא|יוצאי|רצוי|גישה|עם ידע|עם ניסיון|ראש גדול)/;
var TERMS = /משמרות|ימים בשבוע|המשרה מיועדת/;

for (var i = 0; i < items.length; i++) {
  var item = items[i];
  if (item.querySelector(".__ai-title")) continue;

  var heads = item.querySelectorAll(".elementor-widget-heading .elementor-heading-title");
  var vals = {};
  for (var h = 0; h < heads.length - 1; h++) {
    var lab = (heads[h].textContent || "").replace(/\s+/g, " ").trim();
    var nxt = (heads[h + 1].textContent || "").replace(/\s+/g, " ").trim();
    if (/^שם המשרה:?$/.test(lab)) vals.title = nxt;
    else if (/^קוד משרה:?$/.test(lab)) vals.code = nxt;
    else if (/^מחלקה:?$/.test(lab)) vals.dept = nxt;
  }
  if (!vals.title) continue;

  // structuredText (recipe §7), inlined: no named functions in page code.
  var body = item.querySelector(".elementor-widget-theme-post-content .elementor-widget-container");
  var lines = [];
  if (body) {
    var c = body.cloneNode(true);
    c.querySelectorAll("p,div,ul,ol,li,br,h1,h2,h3,h4,h5,h6,tr").forEach(function (e) { e.insertAdjacentText("afterend", "\n"); });
    lines = c.textContent.split("\n").map(function (s) { return s.replace(/\s+/g, " ").trim(); }).filter(function (s) { return s.length > 0; });
  }

  var cut = -1;
  for (var k = 0; k < lines.length; k++) { if (TERMS.test(lines[k])) { cut = k; break; } }
  var head = cut === -1 ? lines.slice() : lines.slice(0, cut);
  var pass = 0;
  for (var q = 0; q < head.length; q++) {
    var bare = head[q].replace(/^[\s(\[\-–•*▪.,]+/, "");
    if (/חובה|יתרון/.test(head[q]) || REQ_START.test(bare)) pass++;
  }
  var reqLines = [], descLines = lines.slice();
  if (head.length && pass * 2 >= head.length) {
    reqLines = head;
    descLines = cut === -1 ? [] : lines.slice(cut);
  }
  var code = /^\d+$/.test(vals.code || "") ? vals.code : "";
  if (code) descLines.push("קוד משרה: " + code);

  var add = function (cls, val) {
    if (!val) return;
    var s = document.createElement("div");
    s.className = cls;
    s.style.display = "none";
    s.textContent = val;
    item.appendChild(s);
  };
  add("__ai-title", vals.title);
  if (code) add("__ai-id", "davidovitz-" + code);
  add("__ai-department", vals.dept || "");
  add("__ai-description", descLines.join("\n"));
  add("__ai-requirements", reqLines.join("\n"));
  // No ad names its work place (the group runs plants in several cities): inject the Unknown
  // sentinel so the worker gazetteer never fills a city from prose (LRN-LOC-7).
  add("__ai-location", "Unknown");
  var pid = (item.id || "").replace(/^post-/, "");
  if (dates[pid]) add("__ai-date", dates[pid]);
}
