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
  for (var s = 0; s < spans.length; s++) {
    var el = document.createElement('span');
    el.className = spans[s][0];
    el.style.display = 'none';
    el.textContent = spans[s][1];
    item.appendChild(el); // item ROOT — never inside .panel-title/.panel-body
  }
}
