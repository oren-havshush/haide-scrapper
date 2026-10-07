// trilogical.com/careers — 2-step (listing .jet-listing-grid__item -> detail /positions/<slug>/).
// Runs on BOTH pages; each block guards on markers only its own context has.
//
// LISTING: JetEngine grid, one page (data-pages="1"), server-rendered.
//   title  "System analyst (PM – 0156)" -> "System analyst"; the code leaves the title (rule 7)
//   id     the printed code, read from the RAW title: trilogical-PM-0156. Printed formats differ
//          ("PM – 0156", "SP-0121", "RD-0128"), so letters + digits are re-joined with one "-".
//          The detail slug is NOT used: it is stale (slug rd-0138 now carries RD – 0167).
//   location  set on the DETAIL page (see below).
// DETAIL: body = Elementor post-content widget. Labelled sections are split:
//   Qualifications / Requirements / Job requirements / Advantages / "... Requirements:" -> requirements
//   Role Description / Responsibilities / "... Responsibilities:" / intro               -> description
//   An unheaded list whose every item reads as a requirement is a requirement (rule 1, RD-0124).
//   Labels are dropped. Apply: the Elementor CV form, captured statically in formCapture, is the
//   apply path; applicationInfo is not mapped (owner rule 2026-10-07, LRN-APPLY-12).

// ---------- LISTING CONTEXT ----------
var tlItems = document.querySelectorAll(".jet-listing-grid__item");
for (var tlI = 0; tlI < tlItems.length; tlI++) {
  var tlIt = tlItems[tlI];
  if (tlIt.querySelector(".__ai-id")) continue;
  var tlH = tlIt.querySelector("h3.elementor-heading-title");
  var tlRaw = tlH ? (tlH.textContent || "").replace(/\s+/g, " ").trim() : "";
  if (!tlRaw) continue;

  // language gate (Hebrew/English only): at least one Hebrew/Latin letter, no other script
  var tlOk = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u.test(tlRaw) &&
             !/(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u.test(tlRaw);
  if (!tlOk) { tlIt.parentNode.removeChild(tlIt); continue; }

  var tlM = /\(\s*([A-Za-z]{1,5})\s*[-–—]\s*(\d{2,})\s*\)\s*$/.exec(tlRaw);
  var tlId = tlM ? "trilogical-" + tlM[1].toUpperCase() + "-" + tlM[2] : "";
  var tlTitle = tlM ? tlRaw.slice(0, tlM.index).replace(/[\s\-–—]+$/, "").trim() : tlRaw;
  if (!tlTitle) tlTitle = tlRaw;

  var tlEmit = ["__ai-title", tlTitle, "__ai-id", tlId];
  for (var tlE = 0; tlE < tlEmit.length; tlE += 2) {
    if (!tlEmit[tlE + 1]) continue;   // no printed code -> no id; the worker synthesises one
    var tlS = document.createElement("span");
    tlS.className = tlEmit[tlE];
    tlS.style.display = "none";
    tlS.textContent = tlEmit[tlE + 1];
    tlIt.appendChild(tlS);
  }
}

// ---------- DETAIL CONTEXT ----------
var tlBody = document.querySelector(".elementor-widget-theme-post-content .elementor-widget-container");
if (tlBody && !document.querySelector(".__ai-description")) {
  var tlReqHead = /^(qualifications|requirements|job requirements|advantages|skills|.{0,40}\brequirements)\s*:?$/i;
  var tlDescHead = /^(role description|job description|description|responsibilities|.{0,40}\bresponsibilities)\s*:?$/i;
  var tlReqLine = /experience|degree|knowledge|ability|familiarity|proficien|years|advantage|bachelor/i;
  var tlMode = "desc", tlHeaded = false;
  var tlDesc = [], tlReq = [];
  var tlKids = tlBody.children;
  for (var tlK = 0; tlK < tlKids.length; tlK++) {
    var tlEl = tlKids[tlK];
    var tlTag = tlEl.tagName;
    var tlTxt = (tlEl.textContent || "").replace(/\s+/g, " ").trim();
    if (!tlTxt) continue;
    if (/^H[1-6]$/.test(tlTag) || (tlTag === "P" && tlTxt.length <= 60)) {
      if (tlReqHead.test(tlTxt)) { tlMode = "req"; tlHeaded = true; continue; }
      if (tlDescHead.test(tlTxt)) { tlMode = "desc"; tlHeaded = true; continue; }
    }
    var tlLines = [];
    if (tlTag === "UL" || tlTag === "OL") {
      var tlLis = tlEl.querySelectorAll("li");
      for (var tlL = 0; tlL < tlLis.length; tlL++) {
        var tlLt = (tlLis[tlL].textContent || "").replace(/\s+/g, " ").trim();
        if (tlLt) tlLines.push(tlLt);
      }
    } else {
      tlLines.push(tlTxt);
    }
    var tlTarget = tlMode === "req" ? tlReq : tlDesc;
    if (!tlHeaded && (tlTag === "UL" || tlTag === "OL") && tlLines.length) {
      var tlAll = true;
      for (var tlA = 0; tlA < tlLines.length; tlA++) if (!tlReqLine.test(tlLines[tlA])) { tlAll = false; break; }
      if (tlAll) tlTarget = tlReq;
    }
    for (var tlP = 0; tlP < tlLines.length; tlP++) tlTarget.push(tlLines[tlP]);
  }

  // Location (detail scope): only the ad's own on-site line naming Rishon LeZion places the job
  // (owner 2026-10-07, PM-0156); every other ad stays Unknown.
  var tlBodyText = (tlBody.textContent || "").replace(/\s+/g, " ");
  var tlLoc = /on-site role.{0,160}?located in Rishon\s*-?\s*Le\s*-?\s*Zion/i.test(tlBodyText) ? "ראשון לציון" : "Unknown";
  var tlLs = document.createElement("span");
  tlLs.className = "__ai-location";
  tlLs.style.display = "none";
  tlLs.textContent = tlLoc;
  document.body.appendChild(tlLs);

  var tlBlocks = ["__ai-description", tlDesc, "__ai-requirements", tlReq];
  for (var tlO = 0; tlO < tlBlocks.length; tlO += 2) {
    var tlArr = tlBlocks[tlO + 1];
    if (!tlArr.length) continue;
    var tlWrap = document.createElement("div");
    tlWrap.className = tlBlocks[tlO];
    tlWrap.style.display = "none";
    for (var tlR = 0; tlR < tlArr.length; tlR++) {
      var tlRow = document.createElement("div");
      tlRow.appendChild(document.createTextNode(tlArr[tlR]));
      tlWrap.appendChild(tlRow);
    }
    document.body.appendChild(tlWrap);
  }
}
