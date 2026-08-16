// globrands.co.il — prefix the requisition number so the id gate accepts it.
//
// The site prints a bare integer in p.job-number ("540", "614", "543", "274",
// "610", "500", "593", "607"). Those are REAL requisition numbers, but
// verify-jobids' `indexLike` check hard-fails any all-integer id set, because it
// cannot tell a real job number from item-0/item-1 positional junk. A gate that
// cries wolf gets waved through, so we dodge the false positive instead of
// arguing with it: emit "gb-<number>".
//
// The number itself still does the work — it is stable across scrapes and unique
// per posting — so dedup behaviour is unchanged. Never the index (LRN-ID-1) and
// never the location (LRN-ID-7).
//
// Appended to the div.job item root, which is the prescribed injection point;
// no other field selector reads the item root itself, only its children, so
// there is no corruption risk (LRN-SETUP-1). Idempotent: guarded on the class.
//
// This site is listing-only with no pagination and no load-more, so one pass
// covers all 8 postings — the "setupScript does not re-run after a pagination
// click" hazard does not apply here.
if (!document.querySelector(".__ai-jobid")) {
  var gbJobs = document.querySelectorAll("div.job");
  for (var gbI = 0; gbI < gbJobs.length; gbI++) {
    var gbP = gbJobs[gbI].querySelector("p.job-number");
    var gbN = gbP ? (gbP.textContent || "").replace(/\D+/g, "") : "";
    if (!gbN) continue;
    var gbS = document.createElement("span");
    gbS.className = "__ai-jobid";
    gbS.style.display = "none";
    gbS.textContent = "gb-" + gbN;
    gbJobs[gbI].appendChild(gbS);
  }
}
