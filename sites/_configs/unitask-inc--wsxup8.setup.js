(async function () {
  // Unitask (unitask-inc.com) — runs on BOTH the listing and detail pages, so every
  // branch is guarded by a presence check.
  //
  // externalJobId: the employer's own printed job number ("מספר משרה: JB-2094") is the
  //   key. It is usually in an <h2>, but 2 postings print it as plain body text and
  //   2 others (both Oracle Applications) print no number anywhere — for those the
  //   WordPress post id is the fallback, so fill stays 31/31 with 31 distinct values.
  //   Verified: no JB number is reused across postings.
  // location: parsed from the body text rather than `.elementor-widget-text-editor p`
  //   — one posting renders no text-editor paragraphs and would come back empty.
  // description: the CF7 apply form and trailing boilerplate are stripped IN PLACE so
  //   `article .entry-content` keeps its block-level line breaks (no blob).

  // Everything here is detail-page scoped. There is deliberately NO listing-page
  // injection: the worker runs setupScript on the listing once, BEFORE the pagination
  // loop (scrape.ts:1402 vs 1491), so a listing-injected span exists on page 1 only.
  var ec = document.querySelector('article .entry-content');
  if (!ec) return;

  // location — read BEFORE cleanup removes the line.
  // The label is spelled both גאוגרפי and גיאוגרפי across postings, so match loosely.
  if (!document.querySelector('span[data-haide-location]')) {
    var lm = (ec.innerText || '').match(/מיקום[^:\n]{0,20}:\s*([^\n]+)/);
    if (lm && lm[1]) {
      // strip zero-width marks / nbsp that some postings carry, then the ב prefix
      var loc = lm[1]
        .replace(/[​‎‏ ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[.,;"']+$/, '')
        .trim();
      var REGIONS = ['מרכז', 'צפון', 'דרום', 'שפלה', 'ירושלים', 'השרון'];
      if (loc.charAt(0) === 'ב' && REGIONS.indexOf(loc.slice(1)) !== -1) loc = loc.slice(1);
      if (loc && loc.length < 40) {
        var ls = document.createElement('span');
        ls.setAttribute('data-haide-location', loc);
        ls.style.display = 'none';
        document.body.appendChild(ls);
      }
    }
  }

  // externalJobId — the printed job number first, post id only as a last resort.
  if (!document.querySelector('span[data-haide-jobid]')) {
    var jobId = null;
    var LABELLED = /מספר\s*משרה\s*:?\s*(?:JB[-\s]?)?(\d+)/i;

    // 1) the "מספר משרה: JB-2094" heading (29 of 31 postings)
    var h2s = document.querySelectorAll('h2, h3');
    for (var i = 0; i < h2s.length && !jobId; i++) {
      var hm = (h2s[i].textContent || '').replace(/\s+/g, ' ').match(LABELLED);
      if (hm) jobId = 'JB-' + hm[1];
    }
    // 2) same label as plain body text (postings that render no heading)
    if (!jobId) {
      var bm = (ec.innerText || '').replace(/\s+/g, ' ').match(LABELLED);
      if (bm) jobId = 'JB-' + bm[1];
    }
    // 3) a bare JB-#### anywhere in the body
    if (!jobId) {
      var rm = (ec.innerText || '').match(/\bJB[-\s]?(\d+)\b/i);
      if (rm) jobId = 'JB-' + rm[1];
    }
    // 4) the slug (/jb-1313/, /2106-jb/)
    if (!jobId) {
      var sm = decodeURIComponent(location.pathname).match(/(?:^|\/)jb-(\d+)\/?$|(?:^|\/)(\d+)-jb\/?$/i);
      if (sm) jobId = 'JB-' + (sm[1] || sm[2]);
    }
    // 5) fallback: WordPress post id, for the 2 postings that print no number at all
    if (!jobId) {
      var pm = (document.body.className || '').match(/(?:^|\s)postid-(\d+)(?:\s|$)/);
      if (pm) jobId = 'UT-' + pm[1];
    }

    if (jobId) {
      var js = document.createElement('span');
      js.setAttribute('data-haide-jobid', jobId);
      js.style.display = 'none';
      document.body.appendChild(js);
    }
  }

  // description cleanup — drop the CF7 apply form outright
  var kill = ec.querySelectorAll(
    'form, script, style, .wpcf7, .screen-reader-response, .wpcf7-response-output, .wpcf7-form-control-wrap'
  );
  for (var k = 0; k < kill.length; k++) {
    if (kill[k].parentNode) kill[k].parentNode.removeChild(kill[k]);
  }

  // then the short trailing boilerplate / typed-metadata lines
  var NOISE = [
    'גודל הקובץ עד',
    'חזרה לכל המשרות',
    'מספר משרה',
    'מיקום גאוגרפי',
    'מיקום גיאוגרפי',
    'דוא"ל',
    'שלח קורות חיים',
    'העלה קובץ'
  ];
  var nodes = ec.querySelectorAll('p, div, span, h2, h3, h4, li, a');
  for (var n = nodes.length - 1; n >= 0; n--) {
    var el = nodes[n];
    if (!el.parentNode) continue;
    var t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 120) continue; // never touch prose blocks
    for (var q = 0; q < NOISE.length; q++) {
      if (t.indexOf(NOISE[q]) !== -1) {
        el.parentNode.removeChild(el);
        break;
      }
    }
  }

  // requirements — split at the first דרישות boundary (30/31 postings print one) and
  // then CUT that tail out of the description, so the two fields are disjoint. The cut
  // is done in the DOM (not by replacing description with injected text) so the worker's
  // own list/bullet formatting on the remaining body is preserved.
  if (!document.querySelector('[data-haide-requirements]')) {
    var cleaned = (ec.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
    var at = cleaned.search(/דרישות(\s*סף)?\s*:/);
    if (at !== -1) {
      var req = cleaned.slice(at).replace(/^דרישות(\s*סף)?\s*:\s*/, '').trim();
      if (req.length > 20) {
        var rd = document.createElement('div');
        rd.setAttribute('data-haide-requirements', '1');
        rd.style.display = 'none';
        rd.textContent = req;
        document.body.appendChild(rd);
      }

      // locate the innermost element whose own text opens the דרישות section
      var marker = null;
      var cand = ec.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li, span, strong, b');
      for (var c = 0; c < cand.length; c++) {
        var ct = (cand[c].textContent || '').replace(/\s+/g, ' ').trim();
        if (/^דרישות(\s*סף)?\s*:/.test(ct)) {
          // prefer the deepest match so we cut at the label, not at a wrapper
          if (!marker || marker.contains(cand[c])) marker = cand[c];
        }
      }
      // remove everything after the marker in document order, then the marker itself
      if (marker) {
        var cur = marker;
        while (cur && cur !== ec && cur.parentNode) {
          var par = cur.parentNode;
          while (cur.nextSibling) par.removeChild(cur.nextSibling);
          cur = par;
        }
        if (marker.parentNode) marker.parentNode.removeChild(marker);
      }
    }
  }
})();
