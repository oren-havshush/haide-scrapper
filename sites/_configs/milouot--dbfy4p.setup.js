// milouot.co.il/דרושים — inject the fields the page encodes as prose, split the
// requirements out of the body, and give every posting a real dedup key.
// Full rationale is in the site's adminNote; kept terse here (8000-char cap).
//
// The old externalJobId was the site-builder element id, which names a SLOT, not
// a job: the editor swaps text inside a kept container, so ..._1793194541006 was
// stored as "לחנות המפעל בתל אביב" but now holds "תומך/ת סיסטם", and only 5 of 13
// stored ids still existed. Replaced with a content hash.
//
// Each posting is one .tool_text in the jobs container: line 0 subsidiary
// ("למילופרי -"), line 1 headline (20px span), then body with the site's own
// "דרישות התפקיד" heading marking where requirements begin.
//
// Injections go on the .tool_text root; every field reads an injected node, never
// the root, so nothing folds back into another field (LRN-SETUP-1, ykm.co.il).
// itemSelector is plain .tool_text scoped to the container, so job-ness is decided
// HERE by content, not by an inline font-size; a non-posting gets no .__ai-title
// and the worker drops it (validator REQUIRED_FIELDS = ["title"]).
// Listing-only, server-rendered, not lazy-loaded, no pagination.
var mltSeen = {};
var mltItems = document.querySelectorAll(".tool_text");

for (var mltI = 0; mltI < mltItems.length; mltI++) {
  var mltIt = mltItems[mltI];
  if (mltIt.querySelector(".__ai-title")) continue;

  var mltBlock = mltIt.querySelector('[id^="content_dr4r3_text"]');
  if (!mltBlock) continue;

  var mltText = (mltBlock.innerText || mltBlock.textContent || "");
  // job-ness by content, not by styling
  if (mltText.length < 120) continue;
  if (!/דרוש|דורש|מגייס|מחפשים|משרה/.test(mltText)) continue;

  var mltRaw = mltText.split("\n");
  var mltLines = [];
  for (var mltL = 0; mltL < mltRaw.length; mltL++) {
    var mltT = mltRaw[mltL].replace(/\s+/g, " ").trim();
    if (mltT) mltLines.push(mltT);
  }
  if (!mltLines.length) continue;

  // title: the 20px span UNWRAPPED — its breaks are visual wrapping (2 of 9 wrap),
  // so lines are joined; taking only the first truncates one mid-clause.
  var mltTitle = "";
  var mltSpan = mltIt.querySelector('span[style*="font-size:20px"]');
  if (mltSpan) {
    var mltSpanRaw = (mltSpan.innerText || mltSpan.textContent || "").split("\n");
    var mltParts = [];
    for (var mltS = 0; mltS < mltSpanRaw.length; mltS++) {
      var mltSt = mltSpanRaw[mltS].replace(/\s+/g, " ").trim();
      if (mltSt) mltParts.push(mltSt);
    }
    mltTitle = mltParts.join(" ");
  }
  if (!mltTitle) {
    for (var mltJ = 0; mltJ < mltLines.length; mltJ++) {
      if (/דרוש|דורש|מגייס/.test(mltLines[mltJ])) { mltTitle = mltLines[mltJ]; break; }
    }
  }
  if (!mltTitle) continue;
  // one posting prints "דרוש/ה דרוש/ה תומך/ת סיסטם" — collapse the stutter
  mltTitle = mltTitle.replace(/^(דרוש\/ה|דורש\/ה|מגייס\/ת)\s+(?=(דרוש\/ה|דורש\/ה))/, "");
  // strip the editor's bidi control marks ("‏‏‏‏דרוש/ה מהנדס/ת מים")
  mltTitle = mltTitle.replace(/[‎‏‪-‮]/g, "").trim();
  if (mltTitle.length > 190) mltTitle = mltTitle.slice(0, 190).trim();

  // company: dative subsidiary on line 0 ("למילופרי -" -> "מילופרי")
  var mltCompany = "";
  var mltHead = mltLines[0];
  if (mltHead && mltHead.length <= 40 && /^ל\S/.test(mltHead) && !/דרוש|דורש|מגייס/.test(mltHead)) {
    mltCompany = mltHead.replace(/^ל/, "").replace(/[\s\-–—:]+$/, "").trim();
  }

  // location: only when the posting states one; 8 of 9 do not, so
  // _meta.locationFallback carries the rest. Never invent one.
  var mltLoc = "";
  for (var mltK = 0; mltK < mltLines.length; mltK++) {
    var mltM = /^מיקום[^:\-–]*[:\-–]\s*(.+)$/.exec(mltLines[mltK]);
    if (mltM && mltM[1] && mltM[1].length <= 60) { mltLoc = mltM[1].trim(); break; }
  }

  // externalJobId: djb2 over title+subsidiary, "mlt-" prefixed so an all-numeric
  // set can't trip indexLike. NOT the element id (reused), NOT the index
  // (LRN-ID-1), NOT the location (LRN-ID-7: re-canonicalised every run).
  var mltSeed = (mltTitle + "|" + mltCompany).toLowerCase();
  var mltH = 5381;
  for (var mltC = 0; mltC < mltSeed.length; mltC++) {
    mltH = ((mltH << 5) + mltH) ^ mltSeed.charCodeAt(mltC);
    mltH = mltH >>> 0;
  }
  var mltId = "mlt-" + mltH.toString(36);
  // identical title AND subsidiary is genuinely ambiguous — disambiguate by page
  // order rather than collide.
  if (mltSeen[mltId]) { mltSeen[mltId]++; mltId = mltId + "-" + mltSeen[mltId]; }
  else { mltSeen[mltId] = 1; }

  var mltEmit = ["__ai-title", mltTitle, "__ai-company", mltCompany, "__ai-location", mltLoc, "__ai-jobid", mltId];
  for (var mltE = 0; mltE < mltEmit.length; mltE += 2) {
    if (!mltEmit[mltE + 1]) continue;
    var mltN = document.createElement("span");
    mltN.className = mltEmit[mltE];
    mltN.style.display = "none";
    mltN.textContent = mltEmit[mltE + 1];
    mltIt.appendChild(mltN);
  }

  // description/requirements split. The posting is one flat block, so mapping
  // description to it folded the requirements in. The site labels the boundary
  // itself: "דרישות התפקיד" (colon optional), sometimes trailed by "כישורים
  // אישיים:" which this picks up for free. The apply tail is NOT requirements and
  // is worded three different ways, so it is found by the presence of an address
  // rather than by phrasing, then re-joined onto description — the body stays
  // complete, it just no longer carries the requirements (§6.2: no cherry-picking).
  var mltReqAt = -1, mltTailAt = -1;
  for (var mltP = 1; mltP < mltLines.length; mltP++) {
    var mltLn = mltLines[mltP];
    if (mltReqAt < 0 && /^(דרישות|כישורים|תנאי סף)/.test(mltLn) && mltLn.length <= 34) mltReqAt = mltP;
    if (mltTailAt < 0 && (/[\w.+-]+@[\w.-]+\.\w{2,}/.test(mltLn) || /^(מייל|דוא"ל|דוא״ל)/.test(mltLn) || /לשליחת\s+קו|קורות\s+חיים\s+ל|לשלוח\s+קו/.test(mltLn))) mltTailAt = mltP;
  }
  if (mltTailAt >= 0 && mltReqAt >= 0 && mltTailAt < mltReqAt) mltTailAt = -1; // tail must follow

  var mltEnd = mltTailAt >= 0 ? mltTailAt : mltLines.length;
  var mltDescLines = [], mltReqLines = [];
  for (var mltQ = 0; mltQ < mltLines.length; mltQ++) {
    if (mltReqAt >= 0 && mltQ >= mltReqAt && mltQ < mltEnd) mltReqLines.push(mltLines[mltQ]);
    else mltDescLines.push(mltLines[mltQ]);
  }
  // drop the bare "דרישות התפקיד:" heading — the field name already says it
  if (mltReqLines.length && /^(דרישות|כישורים|תנאי סף)/.test(mltReqLines[0])) mltReqLines.shift();

  // One <div> per line: domFieldExtract appends "\n" after every block descendant,
  // so the field arrives multi-line and can never be a blob. Text nodes only, so
  // "&"/"<" in the copy are never re-parsed as markup.
  var mltBlocks = ["__ai-desc", mltDescLines, "__ai-req", mltReqLines];
  for (var mltB = 0; mltB < mltBlocks.length; mltB += 2) {
    var mltArr = mltBlocks[mltB + 1];
    if (!mltArr.length) continue;
    var mltWrap = document.createElement("div");
    mltWrap.className = mltBlocks[mltB];
    mltWrap.style.display = "none";
    for (var mltR = 0; mltR < mltArr.length; mltR++) {
      var mltRow = document.createElement("div");
      mltRow.appendChild(document.createTextNode(mltArr[mltR]));
      mltWrap.appendChild(mltRow);
    }
    mltIt.appendChild(mltWrap);
  }

  // apply path: 8 of 9 carry a mailto anchor. The 9th prints its address as plain
  // text with no anchor; backfilling the site-wide inbox there pointed applicants
  // at the wrong address, so prefer the address the posting itself states.
  if (!mltIt.querySelector('a[href^="mailto:"]')) {
    var mltMail = /[\w.+-]+@[\w.-]+\.\w{2,}/.exec(mltText);
    var mltA = document.createElement("a");
    mltA.className = "__ai-apply";
    mltA.style.display = "none";
    mltA.setAttribute("href", "mailto:" + (mltMail ? mltMail[0] : "jobs@milouot.co.il"));
    mltA.textContent = mltMail ? mltMail[0] : "jobs@milouot.co.il";
    mltIt.appendChild(mltA);
  }
}
