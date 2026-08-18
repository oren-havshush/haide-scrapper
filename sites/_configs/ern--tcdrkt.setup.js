// ERN (מנורה ERN) — www.ern.co.il careers accordion.
//
// Why a setupScript is needed at all: the page is a Bootstrap accordion with NO
// detail pages. The only per-item "identifier" the markup exposes is the collapse
// anchor `#collapse-<md5>-<index>` — and that md5 is REGENERATED ON EVERY PAGE
// LOAD (observed 4 distinct hashes across 4 loads), on top of being index-based.
// Using it as externalJobId re-keyed all 8 jobs on every scrape. We synthesise a
// stable id from the title instead.
function haideHash(s) {
  var h = 5381, i = s.length;
  while (i) { h = (h * 33) ^ s.charCodeAt(--i); }
  return (h >>> 0).toString(36);
}

// Preserve visual line breaks the way domFieldExtract does, so requirements
// text keeps one item per line instead of arriving as a run-on string.
function structuredText(el) {
  if (!el) return '';
  var c = el.cloneNode(true);
  var blocks = c.querySelectorAll('p,div,ul,ol,li,br,h1,h2,h3,h4,h5,h6,tr');
  for (var b = 0; b < blocks.length; b++) blocks[b].insertAdjacentText('afterend', '\n');
  return (c.textContent || '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

var items = document.querySelectorAll('.panel.panel-default');
for (var i = 0; i < items.length; i++) {
  var item = items[i];
  if (item.querySelector('.__ai-eid')) continue; // re-run guard

  // --- title: the site prints a trailing colon on every heading ---
  var tEl = item.querySelector('.panel-title');
  var title = tEl ? (tEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
  title = title.replace(/[:：\s]+$/, '');

  var body = item.querySelector('.panel-body');
  if (body) {
    // DEFENSIVE NO-OP ON THE PRODUCTION WORKER — do not delete.
    // ERN writes its list markers as literal ✔️ / 📍 characters. wp-emoji-loader
    // only rewrites them into <img class="emoji" alt="✔️"> on browsers it judges
    // unable to render emoji natively; the worker's Chromium renders them, so no
    // <img> is ever created there and the glyphs reach textContent verbatim
    // (verified in the 2026-08-17 production scrape).
    // Local macOS headless Chromium DOES get the <img> substitution, and
    // domFieldExtract reads textContent, which drops <img> entirely — every
    // marker would silently vanish. Swapping the alt glyph back in does not help
    // (wp-emoji's MutationObserver re-images any emoji character it sees), so we
    // substitute "•", which is not an emoji and is the canonical marker
    // BULLET_GLYPHS/descriptionStructure.ts already splits on. This loop is the
    // guard for that environment, not the normal path.
    var imgs = body.querySelectorAll('img.emoji');
    for (var k = 0; k < imgs.length; k++) {
      imgs[k].replaceWith('• ');
    }
    // Drop the "לשליחת קורות חיים: jobs@ern.co.il" trailer that closes every
    // panel — it is the apply path, carried in applicationInfo, not body copy.
    var ps = body.querySelectorAll('p');
    for (var m = 0; m < ps.length; m++) {
      if (/לשליחת\s+קורות\s+חיים/.test(ps[m].textContent || '')) ps[m].remove();
    }
  }

  // --- requirements / skills split (recipe setupscript-patterns.md §9) ---
  // ERN mixes requirements into the same .panel-body as the description, but
  // always as a WHOLE <p>: either a labeled block ("דרישות המשרה:" /
  // "דרישות התפקיד:") or a single trailing candidate sentence that opens
  // "מחפשים מועמדים...". 4 of 8 postings carry one; the rest genuinely have none.
  // Anchoring on the paragraph's FIRST line is what keeps the מכירות/גבייה
  // marketing hook ("מחפשים הזדמנות אמיתית להשתלב...") out — it sits mid-paragraph
  // and is not a heading. Length-guarding the heading (<120 chars) is guardrail 2
  // in §9: a long prose line that merely contains "דרישות" must not classify.
  var reqText = '';
  if (body) {
    var reqNodes = [];
    var paras = body.querySelectorAll('p');
    for (var q = 0; q < paras.length; q++) {
      var pt = structuredText(paras[q]);
      if (!pt) continue;
      var firstLine = pt.split('\n')[0].trim();
      var labeled = firstLine.length < 120 && /:$/.test(firstLine) &&
        /(דרישות|כישורים|תנאי סף)/.test(firstLine);
      var candidateSentence = /^מחפשים\s+מועמד/.test(firstLine);
      if (labeled || candidateSentence) reqNodes.push({ node: paras[q], labeled: labeled });
    }
    if (reqNodes.length) {
      var parts = [];
      for (var w = 0; w < reqNodes.length; w++) {
        var txt = structuredText(reqNodes[w].node);
        // Drop the redundant "דרישות המשרה:" heading — the field is already
        // labelled Requirements/Skills in the dashboard. Line-based, NOT a
        // \b-anchored regex: \b does not fire between Hebrew letters, which is
        // how a previous site shipped the label inside requirements anyway.
        if (reqNodes[w].labeled) {
          var lines = txt.split('\n');
          lines.shift();
          txt = lines.join('\n').replace(/^\n+/, '').trim();
        }
        if (txt) parts.push(txt);
      }
      var candidate = parts.join('\n\n').trim();
      // Never gut the description to populate a Tier-B field (guardrail 4):
      // only split when a real description survives the removal.
      if ((structuredText(body).length - candidate.length) >= 120) {
        reqText = candidate;
        for (var x = 0; x < reqNodes.length; x++) reqNodes[x].node.remove();
      }
    }
  }

  var bodyText = body ? (body.textContent || '') : '';

  // --- location (LRN-LOC-1 constant injection) ---
  // ERN is a single-office employer: "מקום העבודה: יגאל אלון 53 ... ת\"א" and the
  // page intro reads "מיקום נוח בתל אביב". No panel carries its own location
  // field, so the old config scraped job-type words (משרה מלאה → "מלאה",
  // "משמרות") into location. Only the field-sales role spans regions.
  // "כל הארץ" normalises to "פריסה ארצית" in the worker gazetteer; "תל אביב"
  // to "תל אביב-יפו". Both are known keys (worker/lib/locationNormalize.ts).
  var regionHits = 0;
  var REGIONS = ['ירושלים', 'מרכז', 'צפון', 'דרום', 'השרון', 'שפלה', 'חיפה'];
  for (var r = 0; r < REGIONS.length; r++) {
    if (bodyText.indexOf(REGIONS[r]) !== -1) regionHits++;
  }
  var multiRegion = /לפי\s+אזורים/.test(bodyText) || regionHits >= 3;

  var spans = [
    ['__ai-title', title],
    ['__ai-eid', 'ern-' + haideHash(title.toLowerCase())],
    ['__ai-location', multiRegion ? 'כל הארץ' : 'תל אביב'],
    ['__ai-apply', 'jobs@ern.co.il']
  ];
  // Tier-B: only inject when the posting actually states requirements.
  if (reqText) spans.push(['__ai-requirements', reqText]);
  for (var s = 0; s < spans.length; s++) {
    var el = document.createElement('span');
    el.className = spans[s][0];
    el.style.display = 'none';
    el.textContent = spans[s][1];
    item.appendChild(el); // item ROOT — never inside .panel-title/.panel-body
  }
}
