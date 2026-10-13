// readygroup.co.il/careers/ - 2-step (listing: Premium Addons blog grid of WP posts, category "jobs"
// -> detail: the post page). Runs on BOTH pages; each block guards on markers only its page has.
//
// LISTING: 12 cards per page, the page's own visible "next" link (a.next.page-numbers) leads to
//   /careers/page/2/. The worker runs this script on page 1 only, so the next pages are fetched here
//   and their cards appended to the grid. All-or-nothing: a failed page (error, redirect, no card)
//   empties the grid rather than publishing a partial set (card links are absolute URLs).
//   Language gate on the card title: Hebrew/English only.
// DETAIL: the post body (.elementor-widget-theme-post-content), one <p> per line:
//   id            "מספר משרה : 1880" / "Job number: 1870." -> readygroup-1880 (printed number, namespaced);
//                 the number line leaves the description (rule 7). No number -> no id; the worker makes one.
//   requirements  lines under דרישות / דרישות התפקיד / דרישות המשרה / מה אנחנו מחפשים / Requirements
//                 (heading dropped; "יתרונות:" kept as a line inside requirements).
//   description   everything else; labels במסגרת התפקיד / תיאור (ה)תפקיד / מה כולל התפקיד / Description /
//                 Responsibilities dropped. The מיקום / Location and היקף המשרה lines stay in description.
//   location      from the מיקום / Location line only (a client-visit clause cut off first, see below),
//                 through a closed table of city.csv rows;
//                 no line or no known place -> "Unknown".
//   publishDate   article:published_time (Rank Math; same value as the JSON-LD datePublished).

// ---------- LISTING CONTEXT ----------
var rgWrap = document.querySelector('.premium-blog-wrap');
if (rgWrap && !document.documentElement.hasAttribute('data-haide-pages')) {
  document.documentElement.setAttribute('data-haide-pages', '1');
  var rgCard = '.premium-blog-post-outer-container';
  var rgNext = document.querySelector('.premium-blog-pagination-container a.next.page-numbers');
  var rgVisited = {}, rgFail = false;
  for (var rgP = 0; rgNext && rgP < 10; rgP++) {
    var rgUrl = rgNext.href;
    if (rgVisited[rgUrl]) break;
    rgVisited[rgUrl] = 1;
    var rgDoc = null;
    try {
      var rgR = await fetch(rgUrl, { credentials: 'same-origin' });
      if (!rgR.ok || rgR.redirected) { rgFail = true; break; }
      rgDoc = new DOMParser().parseFromString(await rgR.text(), 'text/html');
    } catch (e) { rgFail = true; break; }
    var rgCards = rgDoc.querySelectorAll('.premium-blog-wrap ' + rgCard);
    if (!rgCards.length) { rgFail = true; break; }
    // Every card is kept; a job listed on two pages is collapsed by the worker on its URL (LRN-ID-15).
    Array.prototype.forEach.call(rgCards, function (c) { rgWrap.appendChild(document.importNode(c, true)); });
    rgNext = rgDoc.querySelector('.premium-blog-pagination-container a.next.page-numbers');
  }
  var rgAll = rgWrap.querySelectorAll(rgCard);
  for (var rgI = 0; rgI < rgAll.length; rgI++) {
    var rgIt = rgAll[rgI];
    if (rgFail) { rgIt.parentNode.removeChild(rgIt); continue; }
    var rgA = rgIt.querySelector('.premium-blog-entry-title a');
    var rgT = rgA ? (rgA.textContent || '').replace(/\s+/g, ' ').trim() : '';
    var rgOk = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u.test(rgT) &&
               !/(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u.test(rgT);
    if (!rgOk) rgIt.parentNode.removeChild(rgIt);
  }
}

// ---------- DETAIL CONTEXT ----------
var rgBody = document.querySelector('.elementor-widget-theme-post-content');
if (rgBody && !rgWrap && !document.querySelector('.__ai-description')) {
  var rgC = rgBody.cloneNode(true);
  Array.prototype.forEach.call(rgC.querySelectorAll('script,style'), function (e) { e.remove(); });
  Array.prototype.forEach.call(rgC.querySelectorAll('br'), function (e) { e.replaceWith('\n'); });
  Array.prototype.forEach.call(rgC.querySelectorAll('p,li,div,h1,h2,h3,h4,h5,h6'), function (e) { e.appendChild(document.createTextNode('\n')); });
  var rgLines = (rgC.textContent || '').split('\n').map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).filter(Boolean);

  var RG_NUM = /^(?:מספר משרה|מס['׳]?\s*משרה|job\s*number)\s*[:\-–]?\s*(\d{3,})\s*\.?$/i;
  var RG_LOC = /^(?:מיקום(?:\s+ה?משרה)?|location)\s*[:\-–]/i;
  var RG_TAIL = /^(?:היקף\s+ה?משרה)\s*[:\-–]/;
  var RG_DESC_H = /^(?:במסגרת התפקיד|תיאור\s+ה?תפקיד|מה כולל התפקיד|description|responsibilities)\s*[:?]?$/i;
  var RG_REQ_H = /^(?:דרישות(?:\s+ה?(?:תפקיד|משרה))?|מה אנחנו מחפשים|requirements)\s*[:?]?$/i;
  var rgDesc = [], rgReq = [], rgMode = 'd', rgId = '', rgLocLine = '';
  for (var rgK = 0; rgK < rgLines.length; rgK++) {
    var rgL = rgLines[rgK], rgM = RG_NUM.exec(rgL);
    if (rgM) { if (!rgId) rgId = 'readygroup-' + rgM[1]; rgMode = 'd'; continue; }
    if (RG_LOC.test(rgL)) { if (!rgLocLine) rgLocLine = rgL; rgMode = 'd'; rgDesc.push(rgL); continue; }
    if (RG_TAIL.test(rgL)) { rgMode = 'd'; rgDesc.push(rgL); continue; }
    if (RG_DESC_H.test(rgL)) { rgMode = 'd'; continue; }
    if (RG_REQ_H.test(rgL)) { rgMode = 'r'; continue; }
    (rgMode === 'r' ? rgReq : rgDesc).push(rgL);
  }

  // Closed table: every value is a verbatim "CSV files/city.csv" row.
  var RG_PLACES = [
    [/תל[\s-]?אביב|tel[\s-]?aviv/i, 'תל אביב-יפו'],
    [/פתח[\s-]?תקו?וה|petah?[\s-]?tikva/i, 'פתח תקווה'],
    [/רעננה|ra'?anana/i, 'רעננה'],
    [/כפר[\s-]?סבא|kfar[\s-]?saba/i, 'כפר סבא'],
    [/יהוד(?![א-ת])|yehud\b/i, 'יהוד'],
    [/ירושלים|jerusalem/i, 'ירושלים'],
    [/אשדוד|ashdod/i, 'אשדוד'],
    [/צפון|\bnorth\b/i, 'אזור צפון']
  ];
  var rgHits = [];
  if (rgLocLine) {
    // A "come to the client as needed" clause is not the place of work (owner 2026-10-13, 1880:
    // "+ הגעה לפי צורך ללקוח ברעננה"): the line is cut where a visit/travel word that later names
    // a client starts.
    var rgPlaceText = rgLocLine.replace(RG_LOC, ' ')
      .replace(/(?:^|[\s+,;(])(?:ו)?(?:הגעה|הגעות|ביקור|ביקורים|נסיעה|נסיעות|visits?|visiting|travel\w*)(?=[\s,.:]).*(?:לקוח|client|customer).*$/i, ' ');
    for (var rgQ = 0; rgQ < RG_PLACES.length; rgQ++) {
      var rgPm = RG_PLACES[rgQ][0].exec(rgPlaceText);
      if (rgPm) rgHits.push([rgPm.index, RG_PLACES[rgQ][1]]);
    }
  }
  rgHits.sort(function (a, b) { return a[0] - b[0]; });
  var rgLocs = [];
  rgHits.forEach(function (h) { if (rgLocs.indexOf(h[1]) < 0) rgLocs.push(h[1]); });

  var rgPub = document.querySelector('meta[property="article:published_time"]');
  var rgDate = rgPub ? (rgPub.getAttribute('content') || '').slice(0, 10) : '';
  if (!/^\d{4}-\d\d-\d\d$/.test(rgDate)) rgDate = '';

  var rgOut = ['__ai-description', rgDesc, '__ai-requirements', rgReq,
               '__ai-id', rgId ? [rgId] : [], '__ai-date', rgDate ? [rgDate] : [],
               '__ai-location', [rgLocs.length ? rgLocs.join(', ') : 'Unknown']];
  for (var rgO = 0; rgO < rgOut.length; rgO += 2) {
    var rgArr = rgOut[rgO + 1];
    if (!rgArr.length) continue;
    var rgW = document.createElement('div');
    rgW.className = rgOut[rgO];
    rgW.style.display = 'none';
    for (var rgR2 = 0; rgR2 < rgArr.length; rgR2++) {
      var rgRow = document.createElement('div');
      rgRow.appendChild(document.createTextNode(rgArr[rgR2]));
      rgW.appendChild(rgRow);
    }
    document.body.appendChild(rgW);
  }
}
