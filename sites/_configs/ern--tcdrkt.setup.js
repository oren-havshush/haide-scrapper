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
    // DEFENSIVE NO-OP ON THE PRODUCTION WORKER — do not delete. ERN's markers are
    // literal ✔️/📍 chars; wp-emoji-loader only swaps them for <img class="emoji">
    // on browsers it judges unable to render emoji (local macOS Chromium does,
    // the worker does not). domFieldExtract reads textContent and drops <img>, so
    // there every marker would vanish. Re-inserting the alt glyph fails — wp-emoji
    // re-images any emoji char — so emit "•", a non-emoji BULLET_GLYPHS marker.
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
  // Requirements are always a WHOLE <p>: a labeled block ("דרישות המשרה:") or a
  // trailing sentence opening "מחפשים מועמדים...". 4 of 8 postings carry one.
  // Anchoring on the FIRST line + the <120-char heading guard (§9 guardrail 2) is
  // what excludes the mid-paragraph hook "מחפשים הזדמנות אמיתית להשתלב...".
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
        // Drop the redundant heading (field is already labelled Requirements).
        // Line-based, NOT \b — \b does not fire between Hebrew letters.
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
  // No panel carries a location field, so the old config scraped job-type words
  // ("משרה מלאה" → "מלאה") as places. ERN is single-office (יגאל אלון 53, ת"א);
  // only the field-sales role spans regions. "תל אביב" → "תל אביב-יפו".
  var regionHits = 0;
  var REGIONS = ['ירושלים', 'מרכז', 'צפון', 'דרום', 'השרון', 'שפלה', 'חיפה'];
  for (var r = 0; r < REGIONS.length; r++) {
    if (bodyText.indexOf(REGIONS[r]) !== -1) regionHits++;
  }
  var multiRegion = /לפי\s+אזורים/.test(bodyText) || regionHits >= 3;

  // A territory posting names its regions outright, so a blanket "כל הארץ" throws
  // away what it states. Emit the real list: normalizeLocations() splits on commas
  // into Job.locations[], with locations[0] as the primary `location`.
  // EVERY value must be VERBATIM in "CSV files/city.csv" — NOT the same vocabulary
  // as the worker gazetteer. "הקריות"/"גוש דן" are absent from it, so they map to
  // the nearest present entry. Gate: scripts/verify-location-csv.ts.
  var TERRITORY_MAP = [
    ['ירושלים', 'ירושלים'],
    ['גוש דן', 'אזור מרכז'],
    ['מרכז', 'אזור מרכז'],
    ['השרון', 'אזור השרון'],
    ['חיפה', 'חיפה'],
    ['הקריות', 'אזור צפון'],
    ['קריות', 'אזור צפון'],
    ['צפון', 'אזור צפון'],
    ['דרום', 'אזור דרום'],
    ['שפלה', 'אזור שפלה'],
    ['אילת', 'אזור אילת']
  ];
  var territories = [];
  if (multiRegion && body) {
    // Scan ONLY the territory paragraph — perks/office addresses elsewhere in the
    // body would otherwise register as territories.
    var tp = null;
    var tps = body.querySelectorAll('p');
    for (var y = 0; y < tps.length; y++) {
      if (/לפי\s+אזורים/.test(tps[y].textContent || '')) { tp = tps[y]; break; }
    }
    if (tp) {
      var tlines = structuredText(tp).split('\n');
      for (var z = 0; z < tlines.length; z++) {
        for (var t = 0; t < TERRITORY_MAP.length; t++) {
          if (tlines[z].indexOf(TERRITORY_MAP[t][0]) !== -1 &&
              territories.indexOf(TERRITORY_MAP[t][1]) === -1) {
            territories.push(TERRITORY_MAP[t][1]);
          }
        }
      }
    }
  }
  // "כל הארץ" (→ "פריסה ארצית") is the fallback for nationwide-but-unnamed.
  var locationValue = territories.length
    ? territories.join(', ')
    : (multiRegion ? 'כל הארץ' : 'תל אביב');

  var spans = [
    ['__ai-title', title],
    ['__ai-eid', 'ern-' + haideHash(title.toLowerCase())],
    ['__ai-location', locationValue],
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
