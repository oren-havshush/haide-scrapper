// hamat-group.co.il/דרושים — recover the per-card values the DOM hides behind
// label spans, and give every posting a stable id.
//
// Each card carries a .job__attributes block of rows shaped:
//     <div class="job__attribute"><span>מיקום משרה:</span> בני ברק</div>
// The label lives in the <span> and the VALUE is the leftover text, so no CSS
// selector can address the value on its own. Three labels appear: מס' משרה,
// חברה, מיקום משרה — but only 2 of 10 postings print a מס' משרה.
//
// externalJobId therefore falls back to a hash of title+company. NOT the
// location (LRN-ID-7: it is re-canonicalised every run) and NOT the index
// (LRN-ID-1). Everything is prefixed "hmt-" so a two-posting run whose ids
// happen to be "002"/"003" cannot trip verify-jobids' all-integer indexLike
// hard-fail. The two printed numbers are still used verbatim after the prefix,
// so those ids stay tied to the site's own requisition numbers.
//
// Spans are appended to the div.job item root — the prescribed injection point.
// Every mapped field reads a CHILD container (.job__data, .job__description,
// .h3.cursor-pointer), never the root itself, so nothing folds an injected value
// back into another field (LRN-SETUP-1 — the trap hit on ykm.co.il).
//
// Listing-only site: no pagination and no load-more, so one pass covers all 10
// postings and the "setupScript does not re-run after a pagination click"
// hazard does not apply.
var hmtJobs = document.querySelectorAll("div.job");
for (var hmtI = 0; hmtI < hmtJobs.length; hmtI++) {
  var hmtJob = hmtJobs[hmtI];
  if (hmtJob.querySelector(".__ai-jobid")) continue;

  var hmtTitleEl = hmtJob.querySelector(".h3.cursor-pointer");
  var hmtTitle = hmtTitleEl ? (hmtTitleEl.textContent || "").replace(/\s+/g, " ").trim() : "";

  var hmtNum = "";
  var hmtCompany = "";
  var hmtLoc = "";

  var hmtAttrs = hmtJob.querySelectorAll(".job__attribute");
  for (var hmtA = 0; hmtA < hmtAttrs.length; hmtA++) {
    var hmtSpan = hmtAttrs[hmtA].querySelector("span");
    var hmtLabel = hmtSpan ? (hmtSpan.textContent || "").replace(/\s+/g, " ").trim() : "";
    var hmtFull = (hmtAttrs[hmtA].textContent || "").replace(/\s+/g, " ").trim();
    var hmtVal = hmtLabel ? hmtFull.replace(hmtLabel, "").trim() : hmtFull;
    if (/מיקום/.test(hmtLabel)) hmtLoc = hmtVal;
    else if (/חברה/.test(hmtLabel)) hmtCompany = hmtVal;
    else if (/מס'?\s*משרה/.test(hmtLabel)) hmtNum = hmtVal.replace(/\D/g, "");
  }

  if (hmtLoc) {
    var hmtLocEl = document.createElement("span");
    hmtLocEl.className = "__ai-location";
    hmtLocEl.style.display = "none";
    hmtLocEl.textContent = hmtLoc;
    hmtJob.appendChild(hmtLocEl);
  }

  if (hmtCompany) {
    var hmtCoEl = document.createElement("span");
    hmtCoEl.className = "__ai-company";
    hmtCoEl.style.display = "none";
    hmtCoEl.textContent = hmtCompany;
    hmtJob.appendChild(hmtCoEl);
  }

  if (hmtTitle) {
    var hmtSeed = (hmtTitle + "|" + hmtCompany).toLowerCase();
    var hmtH = 5381;
    for (var hmtC = 0; hmtC < hmtSeed.length; hmtC++) {
      hmtH = ((hmtH << 5) + hmtH) ^ hmtSeed.charCodeAt(hmtC);
      hmtH = hmtH >>> 0;
    }
    var hmtIdEl = document.createElement("span");
    hmtIdEl.className = "__ai-jobid";
    hmtIdEl.style.display = "none";
    hmtIdEl.textContent = "hmt-" + (hmtNum ? hmtNum : hmtH.toString(36));
    hmtJob.appendChild(hmtIdEl);
  }
}
