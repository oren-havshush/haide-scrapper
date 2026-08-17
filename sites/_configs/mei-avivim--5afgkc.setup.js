// mei-avivim.co.il — 2-step (listing li.jobItemRow -> detail /job/*). Runs on
// BOTH pages; each block guards on markers only its own context has. Full
// rationale is in the adminNote. (DB caps setupScript at 8000 chars.)
//
// The old script appended the apply-email span INTO .jobPageContent — the element
// `description` reads — so all 10 stored descriptions ended with the address
// (LRN-SETUP-1, the ykm trap). Detail-scope fields are read document-wide, so
// injections go on document.body and nothing reads .jobPageContent now.
// externalJobId was the bare requisition number, making the id set all-integer,
// which verify-jobids hard-fails as indexLike; the numbers are the site's own, so
// they are simply "mav-" prefixed.
//
// Detail pages are uniformly labelled (verified on 4): h2 "תיאור כללי" -> body,
// h3 "דרישות התפקיד" -> <ul> (the requirements boundary), h3 "סוג המשרה"/"אחוז
// המשרה" -> typed meta, then div.sendResumeBtnWrap (the apply BUTTON, dropped).
// The meta VALUES are bare text nodes between <br>s, so the split must be
// line-based over the container — an element-only walk misses them.
//
// location is injected per row (see LRN-LOC-1 note below), not left to a fallback.

// ---------- LISTING CONTEXT ----------
var mavRows = document.querySelectorAll("li.jobItemRow");
for (var mavI = 0; mavI < mavRows.length; mavI++) {
  var mavIt = mavRows[mavI];
  if (mavIt.querySelector(".__ai-jobid")) continue;
  var mavT = mavIt.querySelector(".job_title");
  var mavTitle = mavT ? (mavT.textContent || "").replace(/\s+/g, " ").trim() : "";
  if (!mavTitle) continue;

  var mavNum = (mavTitle.match(/(\d{3,})/) || [])[1] || "";

  // title cleanup + department, both conservative. Segments are "|"-separated:
  //   "מפקח/ת על קבלנים | משרה 4092 | מחלקת מתקנים"
  // Drop the "משרה NNNN" segment (redundant with externalJobId) and take a
  // segment as department ONLY when it opens with an org word — otherwise leave
  // department empty rather than guess at an embedded one.
  var mavSegs = mavTitle.split("|");
  var mavKeep = [], mavDept = "";
  for (var mavS = 0; mavS < mavSegs.length; mavS++) {
    var mavSeg = mavSegs[mavS].replace(/\s+/g, " ").trim();
    if (!mavSeg) continue;
    if (/^(מספר\s+)?משרה\s*(מס['׳’]?\.?)?\s*\d{3,}$/.test(mavSeg)) continue;
    if (!mavDept && /^(מחלקת|מטה|חטיבת|אגף|מדור)\s/.test(mavSeg)) { mavDept = mavSeg; continue; }
    mavKeep.push(mavSeg);
  }
  var mavClean = mavKeep.join(" | ");
  // Older postings put the number inside the role segment behind a dash rather
  // than in its own "|" segment ("מהנדס/ת תכנון – משרה מס' 4040"), so the
  // segment-level drop above misses them. Strip a trailing number phrase too.
  // NB: no \b before Hebrew — JS \w excludes Hebrew letters, so a word boundary
  // never fires there and the whole pattern silently fails to match. The geresh
  // is also written three ways on this site, hence the character class.
  mavClean = mavClean.replace(/[\s\-–—]*(מספר\s+)?משרה\s*(מס['׳’]?\.?)?\s*\d{3,}\s*$/, "");
  mavClean = mavClean.replace(/[\s\-–—|,]+$/, "").trim();
  if (!mavClean) mavClean = mavTitle;

  // location INJECTED, not left to locationFallback: the fallback only fills when
  // extraction is empty, so it cannot override a wrong gazetteer guess (LRN-LOC-1)
  // — and one was wrong, matching "במרכז" inside "במרכז הטלפוני" (a call centre)
  // and labelling mav-4030 "אזור מרכז". Single-city employer, so the constant holds.
  var mavEmit = ["__ai-title", mavClean, "__ai-dept", mavDept, "__ai-location", "תל אביב",
                 "__ai-jobid", mavNum ? "mav-" + mavNum : ""];
  for (var mavE = 0; mavE < mavEmit.length; mavE += 2) {
    if (!mavEmit[mavE + 1]) continue;
    var mavN = document.createElement("span");
    mavN.className = mavEmit[mavE];
    mavN.style.display = "none";
    mavN.textContent = mavEmit[mavE + 1];
    mavIt.appendChild(mavN);
  }
}

// ---------- DETAIL CONTEXT ----------
var mavPC = document.querySelector(".jobPageContent");
if (mavPC && !document.querySelector(".__ai-desc")) {
  // Work on a detached clone so the apply button can be dropped without touching
  // the live page, and resolve <br> / block ends exactly as domFieldExtract does
  // (layout-independent — innerText would depend on what is rendered).
  var mavClone = mavPC.cloneNode(true);
  var mavKill = mavClone.querySelectorAll(".sendResumeBtnWrap, a.sendResumeBtn");
  for (var mavK = 0; mavK < mavKill.length; mavK++) mavKill[mavK].parentNode.removeChild(mavKill[mavK]);
  var mavBrs = mavClone.querySelectorAll("br");
  for (var mavB = 0; mavB < mavBrs.length; mavB++) mavBrs[mavB].replaceWith("\n");
  var mavBlk = mavClone.querySelectorAll("p, div, li, h1, h2, h3, h4, ul, ol");
  for (var mavQ = 0; mavQ < mavBlk.length; mavQ++) mavBlk[mavQ].appendChild(document.createTextNode("\n"));

  var mavRaw = (mavClone.textContent || "").split("\n");
  var mavLines = [];
  for (var mavL = 0; mavL < mavRaw.length; mavL++) {
    var mavLn = mavRaw[mavL].replace(/\s+/g, " ").trim();
    if (mavLn) mavLines.push(mavLn);
  }

  var mavReqAt = -1, mavMetaAt = -1;
  for (var mavP = 0; mavP < mavLines.length; mavP++) {
    if (mavReqAt < 0 && /^דריש(ות|ה)\s+התפקיד/.test(mavLines[mavP])) mavReqAt = mavP;
    if (mavMetaAt < 0 && /^(סוג\s+המשרה|אחוז\s+המשרה)/.test(mavLines[mavP])) mavMetaAt = mavP;
  }
  if (mavMetaAt >= 0 && mavReqAt >= 0 && mavMetaAt < mavReqAt) mavMetaAt = -1;

  var mavEnd = mavMetaAt >= 0 ? mavMetaAt : mavLines.length;
  var mavDesc = [], mavReq = [], mavType = [];
  for (var mavX = 0; mavX < mavLines.length; mavX++) {
    if (mavReqAt >= 0 && mavX >= mavReqAt && mavX < mavEnd) {
      if (mavX === mavReqAt) continue;           // the heading names the field
      mavReq.push(mavLines[mavX]);
    } else {
      mavDesc.push(mavLines[mavX]);              // keeps the סוג/אחוז meta lines
      if (mavMetaAt >= 0 && mavX >= mavMetaAt) mavType.push(mavLines[mavX]);
    }
  }

  // typed meta -> its own field, the rest stays in description (LRN-SETUP-3).
  // "סוג המשרה" / "- קבועה" / "אחוז המשרה" / "- מלאה"  ->  "קבועה, מלאה"
  var mavVals = [];
  for (var mavV = 0; mavV < mavType.length; mavV++) {
    var mavTv = mavType[mavV].replace(/^[-–—•\s]+/, "").trim();
    if (!mavTv || /^(סוג\s+המשרה|אחוז\s+המשרה)/.test(mavTv)) continue;
    if (mavTv.length <= 30) mavVals.push(mavTv);
  }

  // apply email: the sendResumeBtn's own mailto, NOT the first mailto on the page
  // (there is also a share link and a general pniot@ address). It is per-job —
  // 4080 uses revitalh@ where the rest use hrsite@.
  var mavMail = "";
  var mavBtn = document.querySelector("a.sendResumeBtn");
  if (mavBtn) {
    var mavM = ((mavBtn.getAttribute("href") || "").match(/mailto:([^?\s]+)/) || [])[1];
    if (mavM) mavMail = mavM.trim();
  }

  // Everything lands on document.body — detail-scope fields are read
  // document-wide, and nothing reads body, so no value can fold into another
  // field. Never back into .jobPageContent (LRN-SETUP-1).
  var mavBlocks = ["__ai-desc", mavDesc, "__ai-req", mavReq];
  for (var mavO = 0; mavO < mavBlocks.length; mavO += 2) {
    var mavArr = mavBlocks[mavO + 1];
    if (!mavArr.length) continue;
    var mavWrap = document.createElement("div");
    mavWrap.className = mavBlocks[mavO];
    mavWrap.style.display = "none";
    for (var mavR = 0; mavR < mavArr.length; mavR++) {
      var mavRow = document.createElement("div");
      mavRow.appendChild(document.createTextNode(mavArr[mavR]));
      mavWrap.appendChild(mavRow);
    }
    document.body.appendChild(mavWrap);
  }
  var mavFlat = ["__ai-jobtype", mavVals.join(", "), "__ai-email", mavMail];
  for (var mavF = 0; mavF < mavFlat.length; mavF += 2) {
    if (!mavFlat[mavF + 1]) continue;
    var mavSp = document.createElement("span");
    mavSp.className = mavFlat[mavF];
    mavSp.style.display = "none";
    mavSp.textContent = mavFlat[mavF + 1];
    document.body.appendChild(mavSp);
  }
}
