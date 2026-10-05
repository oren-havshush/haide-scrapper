(function () {
  try {
    // mertens-hoffman.co.il/דרושים: server-rendered FAQ accordion, li.qWrapper per job, no detail pages.
    // Fields are labeled rows (.filed_title + next .filed_text): איזור המשרה / תיאור המשרה / דרישות המשרה / שלח קורות חיים.
    // Id: the printed "מספר משרה: N" -> mertens-N; no number -> mertens-haideHash(title).
    // Location: the row's own tag. "כל הארץ"/"רחבי הארץ" -> פריסה ארצית; else the last comma part only if it is
    // in the closed PLACES list ("בנייני עזריאלי, חולון" -> חולון); else Unknown (owner, 2026-10-05).
    // Body: requirement lines live only in requirements; a "דרישות:" block repeated inside the description is dropped
    // there. The apply-by-email lines stay in the description (owner: the form is the apply path, email stays in text).
    var NBSP = String.fromCharCode(160);
    var PLACES = { 'חולון': 'חולון' };
    function haideHash(s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); }
    function clean(s) { return (s || '').split(NBSP).join(' ').replace(/[ \t]+/g, ' ').trim(); }
    function lines(el) {
      var c = el.cloneNode(true);
      Array.prototype.forEach.call(c.querySelectorAll('form'), function (f) { f.remove(); });
      Array.prototype.forEach.call(c.querySelectorAll('p,div,li,br,h1,h2,h3,h4,h5,tr'), function (e) { e.insertAdjacentText('afterend', '\n'); });
      return c.textContent.split('\n').map(clean).filter(function (l) { return l && !/^[:\-–•*]+$/.test(l); });
    }
    var EMAIL_LINE = /@|מספר\s+משרה|(^|\s)קו"ח|קורות\s+חיים/;
    var REQ_H = /^דרישות(\s+(ה)?(משרה|תפקיד))?\s*[:\-–]?\s*$/;
    var items = document.querySelectorAll('.Faq li.qWrapper');
    Array.prototype.forEach.call(items, function (it) {
      if (it.querySelector('.__ai-title')) return;
      var tEl = it.querySelector('.FaqTitleText');
      if (!tEl) return;
      var title = clean(tEl.textContent);
      if (!title) return;
      var rows = {};
      Array.prototype.forEach.call(it.querySelectorAll('.filed_title'), function (h) {
        var v = h.nextElementSibling;
        if (v && v.classList.contains('filed_text')) rows[clean(h.textContent).replace(/[:\s]+$/, '')] = v;
      });
      var all = it.textContent.replace(/\s+/g, ' ');
      var nm = /מספר\s+משרה\s*[:\-–]?\s*(\d{3,6})/.exec(all);
      var id = nm ? 'mertens-' + nm[1] : 'mertens-' + haideHash(title);
      var locRaw = rows['איזור המשרה'] ? clean(rows['איזור המשרה'].textContent) : '';
      var loc = 'Unknown';
      if (/(כל|רחבי)\s+הארץ/.test(locRaw)) loc = 'פריסה ארצית';
      else if (locRaw) { var last = locRaw.split(',').pop().trim(); if (PLACES[last]) loc = PLACES[last]; }
      var desc = [], req = [], move = [];
      if (rows['תיאור המשרה']) {
        var inReq = false;
        lines(rows['תיאור המשרה']).forEach(function (l) {
          if (REQ_H.test(l)) { inReq = true; return; }
          if (inReq && /^[-–•*]/.test(l)) { req.push(l); return; }
          inReq = false;
          desc.push(l);
        });
      }
      var reqRows = rows['דרישות המשרה'] ? lines(rows['דרישות המשרה']) : [];
      if (reqRows.length) {
        req = [];
        reqRows.forEach(function (l) { (EMAIL_LINE.test(l) ? move : req).push(l); });
      }
      desc = desc.concat(move);
      function add(cls, v) { if (!v) return; var s = document.createElement('span'); s.className = cls; s.style.display = 'none'; s.textContent = v; it.appendChild(s); }
      add('__ai-title', title);
      add('__ai-id', id);
      add('__ai-location', loc);
      add('__ai-description', desc.join('\n'));
      add('__ai-requirements', req.join('\n'));
    });
  } catch (e) { }
})();
