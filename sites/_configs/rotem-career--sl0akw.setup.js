// rotem-career.co.il — 2-step (listing /category/jobs/ article.elementor-post -> detail /YYYY/MM/DD/<slug>/).
// Runs on BOTH pages; each block guards on markers only its own context has.
//
// LISTING: Elementor archive grid, one page (5 posts, /page/2/ is 404, no paging control).
//   id     the printed number read from the RAW title ("... -משרה מס' 1187", "- משרה מספר 1030",
//          "- משרה 1176") -> rotem-career-1187. No number in the title -> no id; the worker synthesises one.
//   title  the number phrase leaves the title (rule 7); the rest stays as printed.
//   language gate: Hebrew/English titles only.
// DETAIL: Elementor single-post template, labelled heading + text-editor pairs:
//   מס' משרה -> one closing description line in the page's own wording (the shared apply form
//              asks for the job number and cannot otherwise tell the jobs apart; owner question)
//   סוג משרה -> employmentType ; תחום עיסוק -> department
//   תאריך הגשה אחרון -> deadline (ISO) when filled ; תיאור התפקיד -> description ;
//   דרישות התפקיד -> requirements. Section labels are dropped, also when repeated inside the text.
//   location: no work-location cue line on any job -> "Unknown" (LRN-LOC-7). "רותם" (the company
//   name, e.g. "ברותם תעשיות") is also a city.csv row; the gazetteer does not read it today.

// ---------- LISTING CONTEXT ----------
var rpItems = document.querySelectorAll("[data-elementor-type='archive'] article.elementor-post");
for (var rpI = 0; rpI < rpItems.length; rpI++) {
  var rpIt = rpItems[rpI];
  if (rpIt.querySelector(".__ai-title")) continue;
  var rpA = rpIt.querySelector(".elementor-post__title a");
  var rpRaw = rpA ? (rpA.textContent || "").replace(/\s+/g, " ").trim() : "";
  if (!rpRaw) continue;

  var rpOk = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u.test(rpRaw) &&
             !/(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u.test(rpRaw);
  if (!rpOk) { rpIt.parentNode.removeChild(rpIt); continue; }

  var rpM = /\s*[-–—]?\s*משרה\s*(?:מס\S?|מספר)?\s*(\d{2,})\s*$/.exec(rpRaw);
  var rpId = rpM ? "rotem-career-" + rpM[1] : "";
  var rpTitle = rpM ? rpRaw.slice(0, rpM.index).replace(/[\s\-–—]+$/, "").trim() : rpRaw;
  if (!rpTitle) rpTitle = rpRaw;

  var rpEmit = ["__ai-title", rpTitle, "__ai-id", rpId];
  for (var rpE = 0; rpE < rpEmit.length; rpE += 2) {
    if (!rpEmit[rpE + 1]) continue;
    var rpS = document.createElement("span");
    rpS.className = rpEmit[rpE];
    rpS.style.display = "none";
    rpS.textContent = rpEmit[rpE + 1];
    rpIt.appendChild(rpS);
  }
}

// ---------- DETAIL CONTEXT ----------
var rpSingle = document.querySelector("[data-elementor-type='single-post']");
if (rpSingle && !document.querySelector(".__ai-description")) {
  var rpW = rpSingle.querySelectorAll(".elementor-widget-heading, .elementor-widget-text-editor");
  var rpSec = {}, rpCur = "";
  for (var rpK = 0; rpK < rpW.length; rpK++) {
    var rpEl = rpW[rpK];
    if (rpEl.classList.contains("elementor-widget-heading")) {
      rpCur = (rpEl.textContent || "").replace(/\s+/g, " ").trim();
      continue;
    }
    if (!rpCur) continue;
    var rpTxt = (rpEl.innerText || rpEl.textContent || "").replace(/\r/g, "");
    rpSec[rpCur] = (rpSec[rpCur] ? rpSec[rpCur] + "\n" : "") + rpTxt;
  }
  var rpLines = function (s) {
    var out = [], a = (s || "").split("\n");
    for (var q = 0; q < a.length; q++) {
      var l = a[q].replace(/\s+/g, " ").trim();
      if (!l) continue;
      if (/^(תיאור התפקיד|דרישות התפקיד|דרישות|תיאור)\s*:?$/.test(l)) continue;
      out.push(l);
    }
    return out;
  };
  var rpGet = function (re) {
    for (var key in rpSec) if (re.test(key)) return rpSec[key];
    return "";
  };
  var rpNum = rpLines(rpGet(/^מס\S?\s*משרה$/)).join(" ");
  var rpType = rpLines(rpGet(/^סוג משרה$/)).join(" ");
  var rpField = rpLines(rpGet(/^תחום עיסוק$/)).join(" ");
  var rpDead = rpLines(rpGet(/^תאריך הגשה אחרון$/)).join(" ");
  var rpDesc = rpLines(rpGet(/^תיאור התפקיד$/));
  var rpReq = rpLines(rpGet(/^דרישות התפקיד$/));
  if (/^\d{2,}$/.test(rpNum)) rpDesc.push("מס' משרה " + rpNum);
  var rpIso = "";
  var rpDm = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(rpDead);
  if (rpDm) rpIso = rpDm[3] + "-" + ("0" + rpDm[2]).slice(-2) + "-" + ("0" + rpDm[1]).slice(-2);

  var rpOut = ["__ai-description", rpDesc, "__ai-requirements", rpReq,
               "__ai-type", rpType ? [rpType] : [], "__ai-dept", rpField ? [rpField] : [],
               "__ai-deadline", rpIso ? [rpIso] : [],
               "__ai-location", ["Unknown"]];
  for (var rpO = 0; rpO < rpOut.length; rpO += 2) {
    var rpArr = rpOut[rpO + 1];
    if (!rpArr.length) continue;
    var rpWrap = document.createElement("div");
    rpWrap.className = rpOut[rpO];
    rpWrap.style.display = "none";
    for (var rpR = 0; rpR < rpArr.length; rpR++) {
      var rpRow = document.createElement("div");
      rpRow.appendChild(document.createTextNode(rpArr[rpR]));
      rpWrap.appendChild(rpRow);
    }
    document.body.appendChild(rpWrap);
  }
}
