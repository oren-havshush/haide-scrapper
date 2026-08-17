// ykm.co.il — recover four values that no CSS selector can reach.
//
// LISTING PAGE
// externalJobId: left alone this would be the URL slug ("/front-end-developer/"),
// and URL-shaped ids are already a known wart in this database. The slug is the
// stable, unique part, so keep it and prefix: "ykm-front-end-developer".
// Never the index (LRN-ID-1), never the location (LRN-ID-7).
//
// DETAIL PAGE
// The body is one flat block: a title line, an intro sentence, "Requirements:",
// then a <li> list whose LAST bullets are not requirements at all but metadata —
// the location, "Job Type: x", "Years of Experience: n", "Job Level: x" and a
// link to the Hebrew version. The shape is identical on all four postings, and
// "Job Type:" is the reliable anchor:
//
//     li[0 .. jt-2]  real requirements
//     li[jt-1]       location  ("Tel Aviv", "Raanana", "Job location : Ra'anana")
//     li[jt]         "Job Type: full-time"
//
// So location and employmentType are published per job — the old config simply
// never mapped them, which is why all 4 stored rows had an empty location.
// description stays mapped to the whole div.post-content: never cherry-pick only
// the headings you recognise (LRN-SETUP-3), and a short intro-only description
// would trip QA's "description far shorter than the detail body" suspect.
//
// Every injected node is appended to document.body, NOT to div.post-content —
// description reads post-content, so injecting into it would fold the extracted
// requirements straight back into the description and inflate it (LRN-SETUP-1).
// Detail-scope fields are read with page.$() document-wide, so body works.
//
// Idempotent: every injection is guarded on its own class.

// ---- listing ----
var ykmCards = document.querySelectorAll(".content-box-column");
for (var ykmI = 0; ykmI < ykmCards.length; ykmI++) {
  if (ykmCards[ykmI].querySelector(".__ai-jobid")) continue;
  var ykmLink = ykmCards[ykmI].querySelector("a.heading-link");
  var ykmHref = ykmLink ? (ykmLink.getAttribute("href") || "").trim() : "";
  // one card stores an ABSOLUTE href with a leading space, the rest are relative
  var ykmParts = ykmHref.replace(/[?#].*$/, "").split("/").filter(Boolean);
  var ykmSlug = ykmParts.length ? ykmParts[ykmParts.length - 1] : "";
  if (ykmSlug && !/^https?:$/i.test(ykmSlug)) {
    var ykmId = document.createElement("span");
    ykmId.className = "__ai-jobid";
    ykmId.style.display = "none";
    ykmId.textContent = "ykm-" + ykmSlug;
    ykmCards[ykmI].appendChild(ykmId);
  }
}

// ---- detail ----
var ykmPc = document.querySelector("div.post-content");
if (ykmPc && !document.querySelector(".__ai-jobtype")) {
  var ykmLis = Array.prototype.slice.call(ykmPc.querySelectorAll("li"));
  var ykmTexts = [];
  for (var ykmL = 0; ykmL < ykmLis.length; ykmL++) {
    ykmTexts.push((ykmLis[ykmL].textContent || "").replace(/\s+/g, " ").trim());
  }

  var ykmJt = -1;
  for (var ykmK = 0; ykmK < ykmTexts.length; ykmK++) {
    if (/^job\s*type\s*:/i.test(ykmTexts[ykmK])) { ykmJt = ykmK; break; }
  }

  if (ykmJt > 0) {
    var ykmEmit = function (cls, val) {
      if (!val) return;
      var n = document.createElement("span");
      n.className = cls;
      n.style.display = "none";
      n.textContent = val;
      document.body.appendChild(n);
    };

    // "Job Type: full-time" -> "full-time"
    ykmEmit("__ai-jobtype", ykmTexts[ykmJt].replace(/^job\s*type\s*:\s*/i, "").trim());

    // the bullet right before it is the place; drop a "Job location :" label
    var ykmLoc = ykmTexts[ykmJt - 1].replace(/^job\s*location\s*:?\s*/i, "").trim();
    // guard against a posting that omits the location bullet — never store a
    // requirement sentence as a location
    if (ykmLoc && ykmLoc.length <= 40 && !/\b(experience|knowledge|team|ability|proven)\b/i.test(ykmLoc)) {
      ykmEmit("__ai-location", ykmLoc.replace(/’/g, "'"));
    }

    // everything above the location bullet is the real requirements list
    var ykmReq = [];
    for (var ykmR = 0; ykmR < ykmJt - 1; ykmR++) {
      if (ykmTexts[ykmR]) ykmReq.push("• " + ykmTexts[ykmR]);
    }
    if (ykmReq.length) {
      var rn = document.createElement("div");
      rn.className = "__ai-requirements";
      rn.style.display = "none";
      // <br> so domFieldExtract yields real line breaks, not one run-on blob
      rn.innerHTML = ykmReq.join("<br>");
      document.body.appendChild(rn);
    }
  }
}
