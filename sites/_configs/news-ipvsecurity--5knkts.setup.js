(function () {
  try {
    // news.ipvsecurity.com/דרושים: jobs are toggles of ONE WordPress (Cherry/tm builder)
    // accordion. The first toggle is empty (no title, no body) and is not a job.
    // No detail pages, no dates, no native id. Apply = "Please send CV to <mailto>".
    // Location: the company's only office (contacts page: זרחין 10, רעננה).
    var toggles = document.querySelectorAll('.tm_pb_accordion .tm_pb_toggle');
    Array.prototype.forEach.call(toggles, function (item) {
      if (item.hasAttribute('data-haide-job')) return;
      var h = item.querySelector('.tm_pb_toggle_title');
      var body = item.querySelector('.tm_pb_toggle_content');
      var title = h ? h.textContent.replace(/\s+/g, ' ').trim() : '';
      if (!title || !body) return;

      // LRN-SETUP §7 — keep block line breaks
      var c = body.cloneNode(true);
      Array.prototype.forEach.call(c.querySelectorAll('p,div,li,br,h1,h2,h3,h4,h5,h6,ul,ol'), function (e) {
        if (e.tagName === 'LI') e.insertAdjacentText('afterbegin', '• ');
        e.insertAdjacentText('afterend', '\n');
      });
      var all = c.textContent
        .split(String.fromCharCode(160)).join(' ') // non-breaking space -> space
        .replace(/\[easy-social-share\]/g, '')
        .split('\n').map(function (l) { return l.replace(/[ \t]+/g, ' ').trim(); })
        .filter(function (l) { return l && l !== '•'; });
      var text = all.join('\n');

      // Requirements = from the first "Qualifications"/"Skills" heading up to the
      // "Please send CV" line. Everything else (intro, responsibilities, the apply
      // line) stays in the description. No heading → no requirements, body intact.
      var HEAD = /^(qualifications|skills|requirements)\s*:?$/i, APPLY = /send\s+(your\s+)?cv/i;
      var q = -1, a = all.length;
      for (var i = 0; i < all.length; i++) { if (HEAD.test(all[i])) { q = i; break; } }
      if (q >= 0) {
        for (var k = q + 1; k < all.length; k++) { if (APPLY.test(all[k])) { a = k; break; } }
      }
      // The "Please send CV to …" line is dropped: the address lives in applicationInfo.
      var description = (q >= 0 ? all.slice(0, q).concat(all.slice(a)) : all)
        .filter(function (l) { return !APPLY.test(l); }).join('\n');
      var requirements = q >= 0 ? all.slice(q, a).join('\n') : '';

      var mail = item.querySelector('a[href^="mailto:"]');
      var email = mail ? mail.getAttribute('href').replace(/^mailto:/i, '').split('?')[0].trim() : '';
      if (!email) {
        var m = /[\w.+-]+@[\w-]+(\.[\w-]+)+/.exec(text);
        email = m ? m[0] : '';
      }

      var slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      if (!slug) return;

      function add(cls, val) {
        if (!val) return;
        var s = document.createElement('span');
        s.className = cls;
        s.textContent = val;
        item.appendChild(s);
      }
      add('__ai-title', title);
      add('__ai-description', description);
      add('__ai-requirements', requirements);
      add('__ai-apply-email', email);
      add('__ai-location', 'רעננה');
      add('__ai-id', 'ipvsecurity-' + slug);
      item.setAttribute('data-haide-job', '1');
    });
  } catch (e) { /* leave the page untouched: no marked items → no jobs */ }
})();
