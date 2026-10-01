(function () {
  try {
    if (document.querySelector('#haide-jobs-root')) return;
    // intertool.co.il/דרושים: Elementor flip-boxes, h3 title on the front, free lines on the back.
    // No job number, no per-job URL (every button is href="#FORM") -> h-haideHash(title).
    // Headless requirement lines move to requirements (LRN-SETUP-18); the rest stay in description.
    // Location: Unknown by owner decision (contact page says חדרה, about page says עמק חפר).
    // Injected so the gazetteer cannot read "אזור השרון" out of the residence requirement.
    // Apply: the Elementor CV form at the bottom of this page (formCapture).
    var NBSP = String.fromCharCode(160);
    var HE = 'א-ת';
    function haideHash(s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); }
    function lines(el) {
      var c = el.cloneNode(true);
      Array.prototype.forEach.call(c.querySelectorAll('p,div,li,br'), function (e) { e.insertAdjacentText('afterend', '\n'); });
      return c.textContent.split(NBSP).join(' ').split('\n').map(function (l) { return l.replace(/[ \t]{2,}/g, ' ').trim(); }).filter(Boolean);
    }
    var KEEP = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, OTHER = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
    var REQ_WORD = new RegExp('^(ניסיון|נסיון|ידע|רישיון|רשיון|תעודה|תעודת|בעל|בעלת|בעל/ת|יכולת|יכולות|נכונות|זמינות|שליטה|הכרה|הכרת|מגורים|דובר|דוברת|עדיפות|נדרש|נדרשת|רצוי|גישה)(?![' + HE + '])');
    function isReq(l) {
      var t = l.replace(/^[^\p{L}\d]+/u, '');
      if (/דרוש/.test(t) || /\d:\d\d/.test(t) || /^שכר|\sשכר\s/.test(t) || t.length > 150) return false;
      return /חובה|יתרון/.test(t) || REQ_WORD.test(t);
    }
    var root = document.createElement('div');
    root.id = 'haide-jobs-root';
    root.style.display = 'none';
    function mk(cls, val) { var e = document.createElement('div'); e.className = cls; e.textContent = val; return e; }
    var seen = {};
    Array.prototype.forEach.call(document.querySelectorAll('main .elementor-flip-box'), function (box) {
      var tEl = box.querySelector('.elementor-flip-box__front .elementor-flip-box__layer__title');
      var dEl = box.querySelector('.elementor-flip-box__back .elementor-flip-box__layer__description');
      var title = tEl ? tEl.textContent.split(NBSP).join(' ').replace(/\s+/g, ' ').trim() : '';
      if (!title || !dEl) return;
      if (!KEEP.test(title) || OTHER.test(title)) return;
      var id = 'h-' + haideHash(title);
      if (seen[id]) return;
      seen[id] = 1;
      var desc = [], req = [];
      lines(dEl).forEach(function (l) { (isReq(l) ? req : desc).push(l); });
      var job = document.createElement('div');
      job.setAttribute('data-haide-job', '1');
      job.appendChild(mk('__ai-title', title));
      var idEl = mk('', id);
      idEl.setAttribute('data-haide-job-id', '1');
      job.appendChild(idEl);
      job.appendChild(mk('__ai-description', desc.join('\n')));
      if (req.length) job.appendChild(mk('__ai-requirements', req.join('\n')));
      job.appendChild(mk('__ai-location', 'Unknown'));
      root.appendChild(job);
    });
    document.body.appendChild(root);
  } catch (e) { }
})();
