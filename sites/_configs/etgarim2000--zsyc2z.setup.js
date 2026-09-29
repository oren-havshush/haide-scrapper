(function () {
  try {
    if (document.querySelector('#haide-jobs-root')) return;
    // etgarim2000.co.il/join-us: Elementor loop grid of CPT "drushim", one card per job, all on one page.
    // No job number and no per-job URL on the page (the CPT permalinks are never linked) -> h-haideHash(title).
    // Card widgets are labelled headings/text-editors: תחום / איזור גיאוגרפי / דרישות תפקיד / שעות העבודה,
    // "פרטים:" -> description, "דרישות התפקיד:" -> requirements (section labels dropped).
    // "דרישות תפקיד: <role>" repeats the תחום role text; dropped when תחום already carries it, else -> requirements.
    // The page's one headline above all cards is shared by every job -> appended to each description.
    var NBSP = String.fromCharCode(160);
    var HE = 'א-ת';
    function haideHash(s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); }
    function clean(s) { return s.split(NBSP).join(' ').replace(/\s+/g, ' ').trim(); }
    function lines(el) {
      var c = el.cloneNode(true);
      Array.prototype.forEach.call(c.querySelectorAll('p,div,li,br,h1,h2,h3,h4,h5,h6,tr'), function (e) { e.insertAdjacentText('afterend', '\n'); });
      return c.textContent.split(NBSP).join(' ').split('\n').map(function (l) { return l.replace(/[ \t]{2,}/g, ' ').trim(); }).filter(Boolean);
    }
    var KEEP = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, OTHER = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
    var REQ_WORD = new RegExp('^(ניסיון|נסיון|ידע|רישיון|רשיון|תעודה|תעודת|בעל|בעלת|בעל/ת|יכולת|נכונות|זמינות|שליטה|הכרה|הכרת|מגורים|דובר|דוברת|עדיפות|נדרש|נדרשת|רצוי|גישה)(?![' + HE + '])');
    function isReq(l) {
      if (/דרוש/.test(l) || /\d:\d\d/.test(l) || /^שכר|\sשכר\s/.test(l) || l.length > 150) return false;
      return /חובה|יתרון/.test(l) || REQ_WORD.test(l);
    }
    // Place names as the page writes them -> verbatim city.csv entry. An unlisted name is dropped, never guessed.
    var CITY = {
      'נתניה': 'נתניה', 'רעננה': 'רעננה', 'הרצליה': 'הרצליה', 'רמת השרון': 'רמת השרון',
      'תל אביב': 'תל אביב-יפו', 'תל אביב-יפו': 'תל אביב-יפו', 'ראש העין': 'ראש העין',
      'קריית אונו': 'קריית אונו', 'קרית אונו': 'קריית אונו', 'יהוד-מונוסון': 'יהוד', 'יהוד': 'יהוד',
      'שוהם': 'שוהם', 'חולון': 'חולון', 'נס ציונה': 'נס ציונה', 'יבנה': 'יבנה', 'באר יעקב': 'באר יעקב',
      'עומר': 'עומר', 'להבים': 'להבים', 'קריית טבעון': 'קרית טבעון', 'קרית טבעון': 'קרית טבעון',
      'קריית מוצקין': 'קרית מוצקין', 'קרית מוצקין': 'קרית מוצקין', 'יקנעם': 'יוקנעם', 'יוקנעם': 'יוקנעם',
      'זכרון יעקב': 'זכרון יעקב'
    };
    function locate(area) {
      var out = [];
      function add(c) { if (c && out.indexOf(c) < 0) out.push(c); }
      area.split(',').forEach(function (t) {
        t = clean(t).replace(/[.]+$/, '');
        if (!t) return;
        if (CITY[t]) return add(CITY[t]);
        var m = new RegExp('^(.+?)\\s+ו([' + HE + '].*)$').exec(t);
        if (m && CITY[m[1]] && CITY[m[2]]) { add(CITY[m[1]]); add(CITY[m[2]]); }
      });
      return out.length ? out.join(', ') : 'Unknown';
    }
    var shared = [];
    Array.prototype.forEach.call(document.querySelectorAll('[data-elementor-type="wp-page"] .elementor-widget-heading, [data-elementor-type="wp-page"] .elementor-widget-text-editor'), function (w) {
      if (w.closest('.e-loop-item')) return;
      lines(w).forEach(function (l) { shared.push(l); });
    });
    var root = document.createElement('div');
    root.id = 'haide-jobs-root';
    root.style.display = 'none';
    function mk(cls, val) { var e = document.createElement('div'); e.className = cls; e.textContent = val; return e; }
    var seen = {};
    Array.prototype.forEach.call(document.querySelectorAll('.e-loop-item.type-drushim'), function (item) {
      var tEl = item.querySelector('.elementor-widget-theme-post-title');
      var title = tEl ? clean(tEl.textContent) : '';
      if (!title || !KEEP.test(title) || OTHER.test(title)) return;
      var id = 'h-' + haideHash(title);
      if (seen[id]) return;
      seen[id] = 1;
      var head = [], desc = [], req = [], area = '', role = '', field = '';
      Array.prototype.forEach.call(item.querySelectorAll('.elementor-widget-heading, .elementor-widget-text-editor'), function (w) {
        var ls = lines(w);
        if (!ls.length) return;
        var first = ls[0], m;
        if ((m = /^תחום\s*:\s*(.*)$/.exec(first))) { field = m[1]; head.push(first); return; }
        if ((m = /^איזור גיאוגרפי\s*:\s*(.*)$/.exec(first))) { area = m[1]; head.push(first); return; }
        if ((m = /^דרישות תפקיד\s*:\s*(.*)$/.exec(first))) { role = m[1]; return; }
        if (/^שעות העבודה\s*:\s*\S/.test(first)) { head.push(first); return; }
        // The label may be an inline <strong>, sharing its line with the first bullet.
        if (!(m = /^(פרטים|דרישות התפקיד)\s*:\s*(.*)$/.exec(first))) return;
        var sec = m[1] === 'פרטים' ? 'desc' : 'req';
        [m[2]].concat(ls.slice(1)).forEach(function (l) {
          l = l.replace(/^[*•▪]\s*/, '');
          if (!l) return;
          if (sec === 'req' || isReq(l)) { if (req.indexOf(l) < 0) req.push(l); } else desc.push(l);
        });
      });
      var norm = function (s) { return clean(s).replace(/[.\s]+$/, ''); };
      if (role && norm(field).indexOf(norm(role)) !== 0) req.unshift(role);
      var job = document.createElement('div');
      job.setAttribute('data-haide-job', '1');
      job.appendChild(mk('__ai-title', title));
      var idEl = mk('', id);
      idEl.setAttribute('data-haide-job-id', '1');
      job.appendChild(idEl);
      job.appendChild(mk('__ai-description', head.concat(desc, shared).join('\n')));
      if (req.length) job.appendChild(mk('__ai-requirements', req.join('\n')));
      job.appendChild(mk('__ai-location', locate(area)));
      root.appendChild(job);
    });
    document.body.appendChild(root);
  } catch (e) { }
})();
