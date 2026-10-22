// xnes / הפניקס בית השקעות — Nuxt (Vue) careers page.
// There is NO jobs API: all open positions ship inside the page's own
// window.__NUXT__ payload and the category dropdown only filters them
// client-side. Selecting a category and searching fires zero network requests.
// So this reads the payload directly — no fetch, no pagination, no detail visit.
if (!document.getElementById("__ai-jobs")) {
  var root = window.__NUXT__;
  if (!root) return;

  // Breadth-walk the payload for every object carrying a jobNumber.
  var found = [], seen = [], stack = [root], guard = 0;
  while (stack.length && guard < 200000) {
    guard++;
    var v = stack.pop();
    if (!v || typeof v !== "object") continue;
    if (seen.indexOf(v) !== -1) continue;
    seen.push(v);
    if (!(v instanceof Array) && v.jobNumber !== undefined && v.title) found.push(v);
    var vals = (v instanceof Array) ? v : Object.keys(v).map(function (k) { return v[k]; });
    for (var i = 0; i < vals.length; i++) {
      if (vals[i] && typeof vals[i] === "object") stack.push(vals[i]);
    }
  }
  if (!found.length) return;

  var wrap = document.createElement("div");
  wrap.id = "__ai-jobs";
  wrap.style.display = "none";
  document.body.appendChild(wrap);

  // Closed list for the location guard below. Every entry is verbatim in
  // "CSV files/city.csv", sorted longest-first so a two-word name is consumed
  // whole: בני ברק must never be read as the separate locality ברק, which is
  // its own city.csv row in the Yizre'el valley (LRN-HQ-5). ברק is deliberately
  // absent. לוד and רמלה are absent too — city.csv carries only רמלה לוד.
  var CITIES = ["תל אביב-יפו","ראשון לציון","פתח תקווה","הוד השרון","רמת השרון","אור יהודה","נס ציונה","ראש העין","רמלה לוד","בני ברק","כפר סבא","גבעתיים","ירושלים","הרצליה","רחובות","באר שבע","מודיעין","אשקלון","רמת גן","רעננה","נתניה","אשדוד","חולון","חיפה","יהוד"];
  var reEsc = function (s) { return s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&"); };
  // One leading particle is tolerated (ב ל מ ו ש כ) but never ה, which turns
  // ordinary words into places (הגדרה -> גדרה, LRN-LOC-8).
  var statedCity = function (job) {
    var hay = " " + [job.title, job.subTitle, job.jobCategory]
      .filter(Boolean).map(String).join("  ").replace(/\s+/g, " ") + " ";
    for (var c = 0; c < CITIES.length; c++) {
      var re = new RegExp("(^|[\\s(\"'\\-,.])(?:[בלמושכ])?" + reEsc(CITIES[c]) + "(?=$|[\\s.,;:)\"'/\\-])");
      if (re.test(hay)) return CITIES[c];
    }
    return null;
  };

  var doneNums = [];
  for (var n = 0; n < found.length; n++) {
    var j = found[n];
    var num = String(j.jobNumber);
    if (doneNums.indexOf(num) !== -1) continue;   // same job can appear twice in the payload
    doneNums.push(num);

    var row = document.createElement("div");
    row.className = "__ai-job";

    var add = function (cls, val) {
      if (!val) return;
      var e = document.createElement("span");
      e.className = cls;
      e.textContent = val;
      row.appendChild(e);
    };
    var lines = function (v) {
      if (!v) return "";
      if (v instanceof Array) return v.join("\n");
      return String(v);
    };

    add("__ai-title", String(j.title).replace(/\s+/g, " ").trim());
    // Namespaced: a bare 4-digit number is rejected as index-like by verify-jobids.
    add("__ai-id", "xnes-" + num);
    add("__ai-department", j.jobCategory ? String(j.jobCategory).trim() : "");
    if (j.name) add("__ai-detail", "https://www.xnes.co.il/jobs/" + j.name + "/");

    // description = the role's intro paragraph plus its duty bullets.
    var descParts = [];
    if (j.subTitle) descParts.push(String(j.subTitle).replace(/\s+/g, " ").trim());
    var d = lines(j.jobDescription);
    if (d) descParts.push(d);
    add("__ai-description", descParts.join("\n"));
    add("__ai-requirements", lines(j.jobRequirements));

    // Operator-confirmed single office (2026-09-23): every posting on this
    // board is at the company HQ — רחוב מצדה 3, בני ברק — so the HQ is injected
    // rather than the Unknown sentinel. A non-empty value also keeps
    // normalizer.ts from scanning the Hebrew prose, where ordinary words double
    // as locality names (מתן, מלאה, ראשון in "תואר ראשון").
    // GUARD: a posting that states its OWN place keeps it. Matched EXACTLY
    // against the closed list above — every entry verbatim in
    // "CSV files/city.csv" — never by scanning for city-shaped words. Title,
    // subtitle and category only; the body is never searched.
    add("__ai-location", statedCity(j) || "בני ברק");
    add("__ai-apply", "jobs@xnes.co.il");

    wrap.appendChild(row);
  }
}
