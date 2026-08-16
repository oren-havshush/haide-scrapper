// l-w.ac.il — expand the "תוצאות נוספות" load-more listing (9 -> 60).
//
// Strategy C (pagination-and-loading.md §2): the native `loadMoreSelector`
// clicker cannot drive this theme. Each click fires
// POST /wp-admin/admin-ajax.php?action=get_jobs&paged=N and the theme sets the
// button to `display:none` for ~1-2s while it is in flight. The worker's
// clickLoadMoreUntilStable re-checks the button on the next iteration, sees
// offsetParent === null, and stops after a single click (9 items).
//
// This loop waits for the button to come BACK before clicking again.
// Bare top-level await, no IIFE wrapper (recipe LANDMINE: an un-returned async
// IIFE resolves immediately and the worker scrapes page 1 only).
// Runs on detail pages too, so it no-ops when the button is absent.
const LW_ITEM = "article.news-item";
const LW_BTN = "button.js-load-more-courses";

if (document.querySelector(LW_BTN) && document.querySelectorAll(LW_ITEM).length > 0) {
  let prev = document.querySelectorAll(LW_ITEM).length;
  let noGrowth = 0;

  for (let round = 0; round < 40; round++) {
    // Wait for the button to be present AND visible (it is hidden mid-AJAX).
    let btn = document.querySelector(LW_BTN);
    for (let w = 0; w < 24 && (!btn || btn.offsetParent === null); w++) {
      await new Promise((r) => setTimeout(r, 250));
      btn = document.querySelector(LW_BTN);
    }
    // Still hidden after 6s => the last page is loaded and the theme retired it.
    if (!btn || btn.offsetParent === null) break;

    btn.click();

    // Wait for the item count to actually grow (admin-ajax round trip).
    let count = prev;
    for (let w = 0; w < 40; w++) {
      await new Promise((r) => setTimeout(r, 250));
      count = document.querySelectorAll(LW_ITEM).length;
      if (count > prev) break;
    }

    if (count <= prev) {
      noGrowth++;
      if (noGrowth >= 2) break;
    } else {
      noGrowth = 0;
    }
    prev = count;
    if (prev >= 500) break; // safety cap
  }

  // --- externalJobId: expose the native WordPress post id -------------------
  // The card carries it only inside the article's class list
  // (`news-item sort-item post-42807 jobs type-jobs ...`), and the worker honors
  // no regex/transform on mappings (LRN-WRK-1), so surface it as its own node.
  //
  // Not the permalink href: two of the 60 postings use Hebrew slugs, which would
  // store a ~200-char percent-encoded blob as the dedup key (LRN-ID-6).
  // Prefixed rather than bare digits so `verify-jobids` does not read an
  // all-integer id set as index-based.
  for (const item of document.querySelectorAll(LW_ITEM)) {
    if (item.querySelector(".__ai-jobid")) continue; // idempotent across re-runs
    const m = /(?:^|\s)post-(\d+)(?:\s|$)/.exec(item.className || "");
    if (!m) continue;
    const span = document.createElement("span");
    span.className = "__ai-jobid";
    span.style.display = "none";
    span.textContent = "lw-" + m[1];
    item.appendChild(span);
  }
}

// --- publishDate (detail pages): Yoast JSON-LD `datePublished` --------------
// The visible "פורסם ב-DD.MM.YYYY" line is present on only ~2 of every 14
// postings AND is unparseable: parsePublishDateToUtc() accepts YYYY-MM-DD or a
// bare D.M.YYYY, so the Hebrew "פורסם ב-" prefix yields ageBucket = null on
// every job. JSON-LD carries a real ISO timestamp on 100% of detail pages.
// domFieldExtract() returns "" for <script> nodes, so the value cannot be
// selector-mapped directly — surface it as a node instead.
// Appended to <body>, never inside `section.single-jobs > div.container`,
// which is the description/applicationInfo root (LRN-SETUP-1).
if (document.querySelector("section.single-jobs") && !document.querySelector(".__ai-publishdate")) {
  let lwIso = "";
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    const m = /"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})/.exec(s.textContent || "");
    if (m) {
      lwIso = m[1];
      break;
    }
  }
  if (lwIso) {
    const span = document.createElement("span");
    span.className = "__ai-publishdate";
    span.style.display = "none";
    span.textContent = lwIso;
    document.body.appendChild(span);
  }
}
