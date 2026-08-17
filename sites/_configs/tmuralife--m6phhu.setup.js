// tmuralife.co.il/קריירה-בתמורה — split each accordion panel into description /
// requirements and give every posting a dedup key that is not its own title.
// (Comments kept tight: the DB caps setupScript at 8000 chars.)
//
// WHY: the old config mapped externalJobId to .accordion-item-title — the SAME
// selector as title — so the raw Hebrew title was the dedup key. That is the
// exact shape verify-jobids hard-fails on (idEqualsTitle): two postings sharing a
// title collapse into one row, and any wording tweak reads as a delete plus an
// insert. Replaced with djb2(title), "tmr-" prefixed so an all-numeric set can
// never trip the indexLike hard-fail.
//
// Each posting is one .accordion-item whose content is a WordPress block group
// with a completely uniform shape across all 4 postings:
//     <p>                "תיאור המשרה" + the description paragraphs
//     <p class=no-margin> "דרישות התפקיד"        <- the site's own boundary label
//     <ul class=wp-block-list> the requirement bullets
//     <div class=wp-block-buttons> "הגשת מועמדות"  <- apply BUTTON, not content
// Mapping description at the panel therefore folded the requirements in AND
// tacked the apply button's label onto the body (the "לצפיה בעברית" class of
// noise caught on ykm.co.il). Both headings are dropped: each is just the label
// of the field it introduces.
//
// 3 of the 4 panels are display:none until expanded, but domFieldExtract reads a
// detached clone's textContent, so collapsed panels extract fine — no clicking.
//
// Injections go on the .accordion-item root; every field reads an injected node
// or .accordion-item-title, never the root, so nothing folds back into another
// field (LRN-SETUP-1, the trap hit on ykm.co.il).
//
// Listing-only, no pagination, no load-more. location is not injected here at
// all — the page states none, so _meta.locationFallback carries it.
var tmrItems = document.querySelectorAll(".accordion-item");

for (var tmrI = 0; tmrI < tmrItems.length; tmrI++) {
  var tmrIt = tmrItems[tmrI];
  if (tmrIt.querySelector(".__ai-jobid")) continue;

  var tmrTitleEl = tmrIt.querySelector(".accordion-item-title");
  var tmrTitle = tmrTitleEl ? (tmrTitleEl.textContent || "").replace(/\s+/g, " ").trim() : "";
  if (!tmrTitle) continue;

  var tmrContent = tmrIt.querySelector(".accordion-item-content");
  if (!tmrContent) continue;
  var tmrInner = tmrContent.querySelector(".wp-block-group__inner-container") || tmrContent;

  var tmrDesc = [], tmrReq = [], tmrSeenReq = false;

  for (var tmrC = 0; tmrC < tmrInner.children.length; tmrC++) {
    var tmrCh = tmrInner.children[tmrC];
    var tmrTag = tmrCh.tagName.toLowerCase();
    var tmrCls = String(tmrCh.className || "");

    // apply button — UI chrome, never body copy
    if (tmrTag === "div" && /wp-block-buttons/.test(tmrCls)) continue;

    if (tmrTag === "ul" || tmrTag === "ol") {
      var tmrLis = tmrCh.querySelectorAll("li");
      for (var tmrL = 0; tmrL < tmrLis.length; tmrL++) {
        var tmrLt = (tmrLis[tmrL].textContent || "").replace(/\s+/g, " ").trim();
        if (!tmrLt) continue;
        if (!/^[•\-–*]/.test(tmrLt)) tmrLt = "• " + tmrLt;
        tmrReq.push(tmrLt);
      }
      tmrSeenReq = true;
      continue;
    }

    // Split the block into lines. One <p> can hold the heading AND the body
    // separated by <br>, so line-level handling is required — but innerText is
    // LAYOUT-derived and 3 of the 4 panels are display:none until expanded, where
    // it silently stops turning <br> into newlines and returns one run-on line
    // (that left "תיאור המשרה" glued to the body on 2 of 4). Resolve <br> on a
    // detached clone instead, exactly as domFieldExtract does — layout-independent,
    // so a collapsed panel splits the same as an open one.
    var tmrClone = tmrCh.cloneNode(true);
    var tmrBrs = tmrClone.querySelectorAll("br");
    for (var tmrN = 0; tmrN < tmrBrs.length; tmrN++) tmrBrs[tmrN].replaceWith("\n");
    var tmrBlk = tmrClone.querySelectorAll("p, div, li");
    for (var tmrM = 0; tmrM < tmrBlk.length; tmrM++) tmrBlk[tmrM].appendChild(document.createTextNode("\n"));
    var tmrRaw = (tmrClone.textContent || "").split("\n");
    for (var tmrR = 0; tmrR < tmrRaw.length; tmrR++) {
      var tmrLn = tmrRaw[tmrR].replace(/\s+/g, " ").trim();
      if (!tmrLn) continue;
      // the site's own section labels — each is the name of the field it
      // introduces, so neither belongs in the value
      if (/^תיאור\s+המשרה\s*:?$/.test(tmrLn)) continue;
      if (/^דריש(ות|ה)\s+התפקיד\s*:?$/.test(tmrLn)) { tmrSeenReq = true; continue; }
      if (/^הגשת\s+מועמדות\s*$/.test(tmrLn)) continue;
      if (tmrSeenReq) {
        if (!/^[•\-–*]/.test(tmrLn)) tmrLn = "• " + tmrLn;
        tmrReq.push(tmrLn);
      } else {
        tmrDesc.push(tmrLn);
      }
    }
  }

  // externalJobId: djb2 over the title. NOT the raw title (idEqualsTitle
  // hard-fail), NOT the index (LRN-ID-1), NOT the location (LRN-ID-7).
  var tmrH = 5381;
  var tmrSeed = tmrTitle.toLowerCase();
  for (var tmrK = 0; tmrK < tmrSeed.length; tmrK++) {
    tmrH = ((tmrH << 5) + tmrH) ^ tmrSeed.charCodeAt(tmrK);
    tmrH = tmrH >>> 0;
  }
  var tmrId = document.createElement("span");
  tmrId.className = "__ai-jobid";
  tmrId.style.display = "none";
  tmrId.textContent = "tmr-" + tmrH.toString(36);
  tmrIt.appendChild(tmrId);

  // One <div> per line: domFieldExtract appends "\n" after every block
  // descendant, so the field arrives multi-line and can never be a blob. Text
  // nodes only, so "&"/"<" in the copy are never re-parsed as markup.
  var tmrBlocks = ["__ai-desc", tmrDesc, "__ai-req", tmrReq];
  for (var tmrB = 0; tmrB < tmrBlocks.length; tmrB += 2) {
    var tmrArr = tmrBlocks[tmrB + 1];
    if (!tmrArr.length) continue;
    var tmrWrap = document.createElement("div");
    tmrWrap.className = tmrBlocks[tmrB];
    tmrWrap.style.display = "none";
    for (var tmrX = 0; tmrX < tmrArr.length; tmrX++) {
      var tmrRow = document.createElement("div");
      tmrRow.appendChild(document.createTextNode(tmrArr[tmrX]));
      tmrWrap.appendChild(tmrRow);
    }
    tmrIt.appendChild(tmrWrap);
  }
}
