(function () {
  try {
    // gazit.co.il — WordPress + Elementor accordion. All 7 jobs live on the
    // careers page itself; there are no detail pages. Every Tier-A field is
    // derived here because the raw DOM exposes none of them cleanly:
    //   • the tab title is a pipe-joined string ("role | dept | city | scope >")
    //   • description + requirements share one .elementor-tab-content blob
    //   • the only stable per-job id is the WP post_id in the inline apply form
    if (!document.querySelector('.elementor-accordion-item')) return;
    if (document.querySelector('.__ai-gazit')) return; // re-run guard

    // LRN-SETUP-7 — preserve block line breaks; never .replace(/\s+/g,' ')
    function structuredText(el) {
      if (!el) return '';
      var c = el.cloneNode(true);
      // A browser draws a marker beside every <li>; textContent does not. The
      // worker prefixes "•" for real <li>s it extracts, but these spans are
      // pre-rendered text, so do it here or the list arrives as flat prose.
      Array.prototype.forEach.call(c.querySelectorAll('li'), function (li) {
        var t = (li.textContent || '').replace(/^\s+/, '');
        if (t && !/^[\u2022\u25cf\u25aa\u2023\u25e6\u00b7\u2219*\u2714\u2713-]/.test(t)) {
          li.insertAdjacentText('afterbegin', '\u2022 ');
        }
      });
      Array.prototype.forEach.call(
        c.querySelectorAll('p,div,ul,ol,li,br,h1,h2,h3,h4,h5,h6,tr'),
        function (e) { e.insertAdjacentText('afterend', '\n'); }
      );
      return c.textContent
        .replace(/ /g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
    }

    // LRN-LOC-1 — single-office employer (מבטחים 4, קריית מטלון, פתח תקווה).
    // Field/travel roles are nationwide. Both values are verbatim rows in
    // "CSV files/city.csv"; hardcoded so the gazetteer cannot guess a
    // non-canonical spelling ("פתח תקוה").
    var HQ = 'פתח תקווה';
    var NATIONWIDE = 'פריסה ארצית';

    // Title-segment → canonical city.csv value. Keys include the spellings the
    // site is likely to print; values are verbatim city.csv rows.
    var CITY = {
      'פתח תקווה': 'פתח תקווה', 'פתח תקוה': 'פתח תקווה',
      'תל אביב': 'תל אביב-יפו', 'תל אביב-יפו': 'תל אביב-יפו', 'ת"א': 'תל אביב-יפו',
      'לוד': 'רמלה לוד', 'רמלה': 'רמלה לוד',
      'ירושלים': 'ירושלים', 'חיפה': 'חיפה', 'ראשון לציון': 'ראשון לציון',
      'אשדוד': 'אשדוד', 'נתניה': 'נתניה', 'באר שבע': 'באר שבע',
      'חולון': 'חולון', 'רמת גן': 'רמת גן', 'בני ברק': 'בני ברק',
      'רחובות': 'רחובות', 'הרצליה': 'הרצליה', 'כפר סבא': 'כפר סבא',
      'רעננה': 'רעננה', 'אשקלון': 'אשקלון', 'גבעתיים': 'גבעתיים',
      'ראש העין': 'ראש העין', 'יבנה': 'יבנה', 'נס ציונה': 'נס ציונה',
      'אור יהודה': 'אור יהודה', 'קריית אונו': 'קריית אונו', 'יהוד': 'יהוד',
      'מודיעין': 'מודיעין',
      'אזור מרכז': 'אזור מרכז', 'אזור שפלה': 'אזור שפלה', 'אזור השרון': 'אזור השרון',
      'אזור צפון': 'אזור צפון', 'אזור דרום': 'אזור דרום'
    };

    var JOBTYPE_RE = /^(משרה\s+(מלאה|חלקית|זמנית)|משרת\s+שטח|משרה\s+\d|היקף)/;
    // Headings that open the requirements block. "מה אנחנו מציעים" (benefits)
    // deliberately does NOT match — it belongs to description.
    var REQ_RE = /^(דרישות|מה\s+אנחנו\s+מחפשים|מי\s+מתאים|כישורים|הכישורים|תנאי\s+סף|דרוש)/;
    var FIELD_RE = /ברחבי\s+הארץ|בכל\s+הארץ|כל\s+הארץ|משרת\s+שטח|נסיעות\s+מרובות/;

    function mk(cls, text) {
      var e = document.createElement('span');
      e.className = cls;
      e.style.display = 'none';
      e.textContent = text;
      return e;
    }

    var items = document.querySelectorAll('.elementor-accordion-item');
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (item.querySelector('.__ai-gazit')) continue;

      var titleEl = item.querySelector('.elementor-tab-title');
      var contentEl = item.querySelector('.elementor-tab-content');
      if (!titleEl || !contentEl) continue;

      // ---- title line: "role | dept | city | scope >" -------------------
      var rawTitle = (titleEl.textContent || '')
        .replace(/ /g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\s*[>»]\s*$/, '');
      if (!rawTitle) continue;

      var segs = rawTitle.split('|').map(function (s) { return s.trim(); })
                         .filter(function (s) { return s.length > 0; });
      var title = segs.shift() || '';
      var jobType = '', dept = '', city = '';
      for (var s = 0; s < segs.length; s++) {
        var seg = segs[s];
        if (!jobType && JOBTYPE_RE.test(seg)) { jobType = seg; continue; }
        if (!city && CITY[seg]) { city = CITY[seg]; continue; }
        if (!dept) { dept = seg; }
      }

      // ---- split the body into description vs requirements --------------
      // State machine over the direct children: a short line ending in ? or :
      // is a section heading and switches the active bucket. Every child lands
      // in exactly one bucket, so the two fields can never overlap.
      var descParts = [], reqParts = [], bucket = descParts;
      var kids = contentEl.children;
      for (var k = 0; k < kids.length; k++) {
        var kid = kids[k];
        // skip the nested Elementor widget that holds the inline apply form
        if (kid.querySelector && kid.querySelector('form')) continue;
        if (kid.classList && kid.classList.contains('elementor')) continue;

        var txt = structuredText(kid);
        if (!txt) continue;

        var isHeading = txt.length < 60 && txt.indexOf('\n') === -1 && /[?:]\s*$/.test(txt);
        if (isHeading) bucket = REQ_RE.test(txt) ? reqParts : descParts;
        bucket.push(txt);
      }

      var description = descParts.join('\n\n').trim();
      var requirements = reqParts.join('\n\n').trim();

      // Employment scope only lives in the title line on some rows. Fold it in
      // as a meta line when the body has no "היקף המשרה" section of its own,
      // so the value is not lost and is not duplicated either (LRN-SETUP-3).
      if (jobType && !/היקף\s+המשרה/.test(description)) {
        description = ('היקף משרה: ' + jobType + '\n\n' + description).trim();
      }

      // ---- location ------------------------------------------------------
      var loc = city;
      if (!loc) loc = FIELD_RE.test(rawTitle + '\n' + description + '\n' + requirements)
        ? NATIONWIDE : HQ;

      // ---- stable id: WordPress post_id from the inline apply form --------
      // The Elementor DOM ids (elementor-tab-content-417N) are INDEX-based and
      // get reused for a different job when the accordion is reordered, which
      // is what collapsed dedup on the previous config. post_id is the WP
      // record id and survives reordering.
      var postIdEl = item.querySelector('input[name="post_id"]');
      var postId = postIdEl ? (postIdEl.value || '').trim() : '';
      var jobId;
      if (postId) {
        jobId = 'gazit-' + postId;
      } else {
        var h = 5381, str = title + '|' + dept + '|' + loc, n = str.length;
        while (n) { h = (h * 33) ^ str.charCodeAt(--n); }
        jobId = 'h-' + (h >>> 0).toString(36);
      }

      var box = document.createElement('div');
      box.className = '__ai-gazit';
      box.style.display = 'none';
      box.appendChild(mk('__ai-title', title));
      box.appendChild(mk('__ai-jobid', jobId));
      box.appendChild(mk('__ai-location', loc));
      box.appendChild(mk('__ai-description', description));
      box.appendChild(mk('__ai-requirements', requirements));
      if (dept) box.appendChild(mk('__ai-department', dept));
      box.appendChild(mk('__ai-applyinfo', 'https://www.gazit.co.il/קריירה/ — הגשה בטופס המקוון בכרטיס המשרה (צירוף קו"ח). לחלופין: info@gazit.co.il'));
      item.appendChild(box);
    }
  } catch (e) {
    console.log('[haide][gazit] setupScript error: ' + (e && e.message));
  }
})();
