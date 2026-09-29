(function () {
  try {
    if (document.querySelector('#haide-jobs-root')) return;
    // limedigital.co.il/jobs: Elementor page, each job an inner section (heading + text-editor + .job-ap popup button).
    // No job number, no per-job URL -> id h-haideHash(title). Every Apply opens the same CV popup (formCapture).
    // A section hidden at desktop+tablet+mobile is retired (no visitor sees it) and is skipped.
    // Body split per LRN-SETUP-18: labels switch section and are dropped; a block whose lines mostly qualify moves
    // whole and makes the following short-line block requirements too; an email line -> applicationInfo.
    var NBSP = String.fromCharCode(160);
    function clean(s) { return s.split(NBSP).join(' ').replace(/\s+/g, ' ').trim(); }
    function haideHash(s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); }
    function lines(el) {
      var c = el.cloneNode(true);
      Array.prototype.forEach.call(c.querySelectorAll('p,div,li,br,h1,h2,h3,h4,h5,h6,tr'), function (e) { e.insertAdjacentText('afterend', '\n'); });
      Array.prototype.forEach.call(c.querySelectorAll('ul,ol'), function (e) { e.insertAdjacentText('beforebegin', '\n'); });
      return c.textContent.split(NBSP).join(' ').split('\n').map(function (l) { return l.replace(/[ \t]{2,}/g, ' ').trim(); }).filter(Boolean);
    }
    var KEEP = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, OTHER = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
    var REQ_WORD = /^(ניסיון|נסיון|ידע|רישיון|רשיון|תעודה|תעודת|בעל|בעלת|בעלי|יכולת|יכולות|נכונות|זמינות|שליטה|הכרה|הכרת|מגורים|דובר|דוברת|עדיפות|נדרש|נדרשת|יוצא|יוצאי|רצוי|גישה|ראש גדול)/;
    function isReq(l) {
      if (/דרוש/.test(l) || /\d:\d\d/.test(l) || l.length > 150) return false;
      if (/^תנאים|שכר/.test(l.replace(/חשב\S*\s+שכר/g, ''))) return false;
      return /חובה|יתרון/.test(l) || REQ_WORD.test(l);
    }
    var DESC_LABEL = /^(הגדרת התפקיד|תחומי אחריות|תיאור התפקיד)[^:]*:$/;
    var REQ_LABEL = /^(דרישות|כישורים)[^:]*:$/;
    var EMAIL = /([\w.+-]+@[\w.-]+\.[a-z]{2,})/i;
    var root = document.createElement('div');
    root.id = 'haide-jobs-root';
    root.style.display = 'none';
    function mk(cls, val) { var e = document.createElement('div'); e.className = cls; e.textContent = val; return e; }
    function retired(el) {
      for (var e = el; e && e !== document.body; e = e.parentElement) {
        var c = e.classList;
        if (c && c.contains('elementor-hidden-desktop') && c.contains('elementor-hidden-tablet') && c.contains('elementor-hidden-mobile')) return true;
      }
      return false;
    }
    var seen = {};
    Array.prototype.forEach.call(document.querySelectorAll('.job-ap'), function (btn) {
      var sec = btn.closest('section.elementor-inner-section');
      if (!sec || retired(sec)) return;
      var hEl = sec.querySelector('.elementor-widget-heading');
      var body = sec.querySelector('.elementor-widget-text-editor .elementor-widget-container');
      var title = hEl ? clean(hEl.textContent) : '';
      if (!title || !KEEP.test(title) || OTHER.test(title)) return;
      var id = 'h-' + haideHash(title);
      if (seen[id]) return;
      seen[id] = 1;
      var desc = [], req = [], apply = '';
      if (body) {
        var sec2 = 'desc', sticky = false;
        Array.prototype.forEach.call(body.children, function (blk) {
          var ls = lines(blk);
          var plain = ls.filter(function (l) { return !DESC_LABEL.test(l) && !REQ_LABEL.test(l) && !EMAIL.test(l); });
          var q = plain.filter(isReq).length;
          var block = null;
          if (sec2 === 'desc' && plain.length >= 2 && plain.length === ls.length && q * 2 >= plain.length) block = 'req';
          else if (sec2 === 'desc' && sticky && plain.length === ls.length && plain.length && q === 0 &&
            plain.every(function (l) { return l.length < 40 && l.indexOf(':') < 0; })) block = 'req';
          sticky = block === 'req';
          ls.forEach(function (l) {
            if (DESC_LABEL.test(l)) { sec2 = 'desc'; return; }
            if (REQ_LABEL.test(l)) { sec2 = 'req'; return; }
            var em = EMAIL.exec(l);
            if (em) {
              var how = clean(l.replace(em[1], '')).replace(/(יש\s+)?לשלוח\s+ל-?\s*$/, '').replace(/^[\s,.:\-–]+|[\s.:\-–]+$/g, '');
              apply = 'mailto:' + em[1] + (how && !/^לשליחת קורות חיים$/.test(how) ? ' - ' + how : '');
              return;
            }
            if (sec2 === 'req' || block === 'req' || (block === null && isReq(l))) req.push(l); else desc.push(l);
          });
        });
      }
      var job = document.createElement('div');
      job.setAttribute('data-haide-job', '1');
      job.appendChild(mk('__ai-title', title));
      var idEl = mk('', id);
      idEl.setAttribute('data-haide-job-id', '1');
      job.appendChild(idEl);
      if (desc.length) job.appendChild(mk('__ai-description', desc.join('\n')));
      if (req.length) job.appendChild(mk('__ai-requirements', req.join('\n')));
      job.appendChild(mk('__ai-location', 'Unknown'));
      if (apply) job.appendChild(mk('__ai-applicationInfo', apply));
      root.appendChild(job);
    });
    document.body.appendChild(root);
  } catch (e) { }
})();
