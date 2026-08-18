/* opl.co.il — accordion careers listing (listing-only, no detail pages).
   1. Drops the site's generic "no matching position" catch-all row.
   2. Splits the mixed body into description + requirements at the <h6>דרישות</h6>.
   3. Synthesises a stable externalJobId (no native id exists on this site). */
function structuredText(el) {
  if (!el) return '';
  var c = el.cloneNode(true);
  // The markup is pretty-printed ("...<br>\n<br>\n"), so those source newlines are
  // formatting, not line breaks — collapse them the way HTML rendering does BEFORE
  // inserting real breaks at the block/<br> boundaries. Nothing may collapse
  // whitespace after this point; that would destroy the breaks just added (§7).
  var w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT, null);
  var t;
  while ((t = w.nextNode())) t.nodeValue = t.nodeValue.replace(/\s+/g, ' ');
  c.querySelectorAll('p,div,ul,ol,li,br,h1,h2,h3,h4,h5,h6,tr').forEach(function (e) {
    e.insertAdjacentText('afterend', '\n');
  });
  return c.textContent
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function nodesText(nodes) {
  var d = document.createElement('div');
  nodes.forEach(function (n) {
    d.appendChild(n.cloneNode(true));
  });
  return structuredText(d);
}

/* Locations live only in the title ("…בחיפה", "…– ת"א וירושלים",
   "…ברחבי הארץ – כרמיאל, עפולה, גלילות וב"ש"). Emit EVERY place named, comma
   separated: the worker's normalizeLocations() splits on commas and canonicalises
   each part, so a two-city posting lands in Job.locations[] instead of collapsing
   to one city or to "Unknown". Injected only when a place is actually found —
   an empty value leaves the gazetteer fallback free to run (LRN-LOC-1). */
var PLACES = [
  'תל אביב', 'ת"א', 'ירושלים', 'חיפה', 'באר שבע', 'ב"ש', 'כרמיאל', 'עפולה',
  'גלילות', 'כפר סבא', 'נתניה', 'חדרה', 'אשדוד', 'אשקלון', 'רחובות',
  'ראשון לציון', 'ראשל"צ', 'פתח תקווה', 'פתח תקוה', 'פ"ת', 'רמת גן', 'ר"ג',
  'חולון', 'בת ים', 'הרצליה', 'רעננה', 'מודיעין', 'בני ברק', 'גבעתיים', 'לוד',
  'רמלה', 'נצרת', 'טבריה', 'עכו', 'אילת', 'יוקנעם', 'יקנעם', 'קרית גת',
  'ראש העין', 'נס ציונה', 'יבנה', 'הוד השרון', 'אור יהודה', 'צפת', 'דימונה',
  'קרית שמונה', 'בית שמש', 'אריאל', 'מעלה אדומים', 'רחבי הארץ',
  'אזור המרכז', 'אזור הצפון', 'אזור הדרום', 'השפלה', 'השרון', 'הגליל', 'הנגב',
];
var PREFIX = 'ובלמהשכ'; // particles that may glue onto a place name
// Tokens whose plain form is absent from city.csv -> the nearest entry that is in it.
var EMIT_AS = { 'רחבי הארץ': 'כל הארץ', 'הגליל': 'אזור הצפון' };
function isHebChar(ch) {
  return /[֐-׿]/.test(ch);
}
function scanPlaces(raw) {
  var hay = (raw || '').replace(/[״"”“]/g, '"').replace(/\s+/g, ' ');
  var needles = PLACES.slice().sort(function (a, b) {
    return b.length - a.length; // longest first so גלילות beats הגליל
  });
  var taken = [];
  var hits = [];
  needles.forEach(function (n) {
    var from = 0;
    for (;;) {
      var at = hay.indexOf(n, from);
      if (at === -1) break;
      from = at + 1;
      var end = at + n.length;
      if (end < hay.length && isHebChar(hay[end])) continue; // inside a longer word
      var before = at > 0 ? hay[at - 1] : ' ';
      if (isHebChar(before)) {
        // allow ONE prefix particle, but only if it starts the word
        if (PREFIX.indexOf(before) === -1) continue;
        if (at > 1 && isHebChar(hay[at - 2])) continue;
      }
      if (
        taken.some(function (r) {
          return at < r[1] && end > r[0];
        })
      )
        continue;
      taken.push([at, end]);
      hits.push({ at: at, value: n });
    }
  });
  hits.sort(function (a, b) {
    return a.at - b.at;
  });
  var out = [];
  hits.forEach(function (h) {
    if (out.indexOf(h.value) === -1) out.push(h.value);
  });
  // "רחבי הארץ" is only meaningful when no specific branch city is named
  if (out.length > 1) out = out.filter(function (v) { return v !== 'רחבי הארץ'; });
  // Emit only spellings that exist VERBATIM in "CSV files/city.csv" — the product
  // city list, which the worker gazetteer does not match exactly (LRN-LOC-4). A
  // value outside it fragments the city filter and nothing auto-repairs it.
  return out.map(function (v) { return EMIT_AS[v] || v; });
}

function fnv1a(str) {
  var h = 0x811c9dc5 >>> 0;
  for (var i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(36);
}

document.querySelectorAll('nav.accordion ul > li').forEach(function (li) {
  var h4 = li.querySelector('.s_title h4');
  var title = ((h4 && h4.textContent) || '').replace(/\s+/g, ' ').trim();

  // --- split the body at the דרישות heading -------------------------------
  var box = li.querySelector('.s_content .fluid_70');
  var inner = box ? box.firstElementChild || box : null;
  var nodes = inner ? Array.prototype.slice.call(inner.childNodes) : [];
  var hIdx = -1;
  for (var i = 0; i < nodes.length; i++) {
    if (nodes[i].nodeType === 1 && /^H[1-6]$/.test(nodes[i].tagName)) {
      hIdx = i;
      break;
    }
  }
  var bodyText = nodesText(hIdx >= 0 ? nodes.slice(0, hIdx) : nodes);
  var reqText = hIdx >= 0 ? nodesText(nodes.slice(hIdx + 1)) : '';

  // --- drop rows that are not real vacancies -------------------------------
  // The site keeps a permanent catch-all row ("למשרה שאינה ברשימה הנ״ל …") that
  // carries no description — an open CV mailbox, not a job. Remove it so
  // itemSelector never sees it.
  var isCatchAll = /למשרה\s+שאינה\s+ברשימה/.test(title);
  if (isCatchAll || (!bodyText && !reqText)) {
    li.remove();
    return;
  }

  if (li.querySelector('.__ai-description')) return; // re-run guard

  // description carries ONLY the body above the דרישות heading — the requirements
  // block belongs to the requirements field alone and must not be duplicated into
  // both (product decision 2026-08-17).
  var d = document.createElement('span');
  d.className = '__ai-description';
  d.style.display = 'none';
  d.textContent = bodyText;
  li.appendChild(d);

  if (reqText) {
    var r = document.createElement('span');
    r.className = '__ai-requirements';
    r.style.display = 'none';
    r.textContent = reqText;
    li.appendChild(r);
  }

  // --- location(s) from the title ------------------------------------------
  var places = scanPlaces(title);
  if (places.length) {
    var loc = document.createElement('span');
    loc.className = '__ai-location';
    loc.style.display = 'none';
    loc.textContent = places.join(', ');
    li.appendChild(loc);
  }

  // --- stable id -----------------------------------------------------------
  // No native job id, no detail URL, no req number anywhere in the markup, so
  // hash the normalised title. Stable across re-scrapes while the title stands.
  if (title) {
    var j = document.createElement('span');
    j.className = '__ai-jobid';
    j.style.display = 'none';
    j.textContent = 'opl-' + fnv1a(title);
    li.appendChild(j);
  }
});
