(function () {
  try {
    // -------- Listing-page logic --------
    // For each job article on the listing, pre-stamp a fallback JB-NNNN from
    // the URL pattern /jb-NNNN/. This only fires for the ~6 jobs whose slug
    // is a JB id. It is harmless on detail pages (no article.elementor-post
    // on detail pages, just plain article).
    var listingArticles = document.querySelectorAll('article.elementor-post');
    for (var i = 0; i < listingArticles.length; i++) {
      var a = listingArticles[i];
      if (a.querySelector('[data-extracted-jobid]')) continue;
      var link = a.querySelector('a.elementor-post__read-more, a[href]');
      var href = link ? (link.getAttribute('href') || '') : '';
      var m = href.match(/\/jb-(\d+)\/?$/i);
      if (m && m[1]) {
        var span = document.createElement('span');
        span.setAttribute('data-extracted-jobid', 'JB-' + m[1]);
        span.style.display = 'none';
        span.textContent = 'JB-' + m[1];
        a.appendChild(span);
      }
    }

    // -------- Detail-page logic --------
    // Skip on listing pages (which have many elementor-post articles).
    if (listingArticles.length > 1) return;
    var art = document.querySelector('article');
    if (!art) return;

    // Diagnostic: prove setupScript executed on the detail page. Worker
    // can read this via a probe field if needed.
    if (!art.querySelector('[data-setup-ran]')) {
      var probe = document.createElement('span');
      probe.setAttribute('data-setup-ran', '1');
      probe.style.display = 'none';
      art.appendChild(probe);
    }

    // Extract location from a <p><strong>מיקום גאוגרפי:</strong> "value"</p>.
    // Hebrew "geographic" has two spellings (גאוגרפי / גיאוגרפי) — yud is
    // optional. We strip the strong label and any quotes/whitespace.
    if (!art.querySelector('[data-extracted-location]')) {
      var paras = art.querySelectorAll('p');
      for (var j = 0; j < paras.length; j++) {
        var p = paras[j];
        var strong = p.querySelector('strong');
        if (!strong) continue;
        if (/\u05de\u05d9\u05e7\u05d5\u05dd\s*\u05d2\u05d9?\u05d0\u05d5\u05d2\u05e8\u05e4\u05d9/.test(strong.textContent || '')) {
          var clone = p.cloneNode(true);
          var s = clone.querySelector('strong');
          if (s) s.remove();
          var val = (clone.textContent || '').replace(/[:\s\u00A0]+/g, ' ').trim();
          val = val.replace(/^["'\u201C\u201D\s]+|["'\u201C\u201D\s]+$/g, '');
          if (val) {
            var locSpan = document.createElement('span');
            locSpan.setAttribute('data-extracted-location', val);
            locSpan.style.display = 'none';
            locSpan.textContent = val;
            art.appendChild(locSpan);
          }
          break;
        }
      }
    }

    // Extract JB-NNNN job id from a heading like "מספר משרה: JB-1314". Some
    // pages have the digits and the JB label swapped ("1506-JB") — handle
    // both. Articles whose detail page has no such heading (e.g. older
    // Hebrew-slug jobs without a real id) get no marker, leaving the
    // externalJobId field empty per product requirement.
    if (!art.querySelector('[data-extracted-jobid]')) {
      var headings = art.querySelectorAll('h1, h2, h3, h4, h5, h6');
      var foundJb = null;
      for (var k = 0; k < headings.length; k++) {
        var txt = headings[k].textContent || '';
        var mm = txt.match(/JB[-\s]*(\d+)/i) || txt.match(/(\d+)[-\s]*JB/i);
        if (mm && mm[1]) { foundJb = 'JB-' + mm[1]; break; }
      }
      if (foundJb) {
        var idSpan = document.createElement('span');
        idSpan.setAttribute('data-extracted-jobid', foundJb);
        idSpan.style.display = 'none';
        idSpan.textContent = foundJb;
        art.appendChild(idSpan);
      }
    }
  } catch (e) {
    try {
      var host = document.querySelector('article') || document.body;
      var es = document.createElement('span');
      es.setAttribute('data-setup-err', String(e).slice(0, 200));
      es.style.display = 'none';
      host.appendChild(es);
    } catch (_) {}
  }
})();
