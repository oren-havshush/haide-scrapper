(function () {
  try {
    if (document.querySelector('#haide-jobs-root')) return;
    // sano.co.il careers: one page, div.job per posting (.top-job: title + "מיקום:"; .content-job:
    // "תאור המשרה:", "דרישות התפקיד:", then an unlabelled closing block, then a.cv mailto).
    // No job number, no per-job URL -> h-haideHash(title). Labels dropped. Headless requirement
    // lines move (LRN-SETUP-18); a leading run of the closing block where at least half the lines
    // qualify moves as a block. Lines carrying the mail address are dropped (the address is in
    // applicationInfo; the page gives no instruction for the email). The "מיקום:" line opens the
    // description: it names the group company (סנו / קוסמופארם), which the city field cannot carry.
    var NBSP = String.fromCharCode(160);
    var HE = 'א-ת';
    function haideHash(s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); }
    function clean(s) { return s.split(NBSP).join(' ').replace(/\s+/g, ' ').trim(); }
    function lines(el) {
      var c = el.cloneNode(true);
      Array.prototype.forEach.call(c.querySelectorAll('p,div,li,br,h1,h2,h3,h4,tr'), function (e) { e.insertAdjacentText('afterend', '\n'); });
      return c.textContent.split(NBSP).join(' ').split('\n').map(function (l) { return l.replace(/[ \t]{2,}/g, ' ').trim(); }).filter(Boolean);
    }
    var KEEP = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, OTHER = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
    var DESC_H = /^תי?אור (ה)?משרה\s*:?$/, REQ_H = /^דרישות (ה)?תפקיד\s*:?$/;
    var MAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;
    var EQUAL = /לנשים\s+ו?ל?גברים\s+כאחד|לגברים\s*\/\s*נשים\s+כאחד/;
    var REQ_WORD = new RegExp('^(ניסיון|נסיון|ידע|רישיון|רשיון|תעודה|תעודת|בעל|בעלת|בעל/ת|יכולת|יכולות|נכונות|זמינות|שליטה|הכרה|הכרת|היכרות|מגורים|דובר|דוברת|עדיפות|נדרש|נדרשת|רצוי|גישה|הבנה|חשיבה|מוטיבציה|יחסי אנוש)(?![' + HE + '])');
    function isReq(l) {
      var t = l.replace(/^[^\p{L}\d]+/u, '');
      if (/דרוש/.test(t) || /\d:\d\d/.test(t) || /^שכר|\sשכר\s/.test(t) || t.length > 150) return false;
      return /חובה|יתרון/.test(t) || REQ_WORD.test(t);
    }
    function city(loc) {
      if (/הוד\s+השרון/.test(loc)) return 'הוד השרון';
      if (/עמק\s+חפר/.test(loc)) return 'עמק חפר';
      return 'Unknown';
    }
    var root = document.createElement('div');
    root.id = 'haide-jobs-root';
    root.style.display = 'none';
    function mk(cls, val) { var e = document.createElement('div'); e.className = cls; e.textContent = val; return e; }
    var seen = {};
    Array.prototype.forEach.call(document.querySelectorAll('.odot_content .job'), function (card) {
      var top = card.querySelectorAll('.top-job .line');
      var tEl = top[0] && top[0].querySelector('.title');
      var title = tEl ? clean(tEl.textContent) : '';
      if (!title || !KEEP.test(title) || OTHER.test(title)) return;
      var id = 'h-' + haideHash(title);
      if (seen[id]) return;
      seen[id] = 1;
      var locEl = top[1] && top[1].querySelector('.text');
      var loc = locEl ? clean(locEl.textContent) : '';
      var desc = [], req = [];
      if (loc) desc.push('מיקום: ' + loc);
      Array.prototype.forEach.call(card.querySelectorAll('.content-job > .line'), function (block) {
        var ls = lines(block), sec = 'tail';
        if (ls.length && DESC_H.test(ls[0])) { sec = 'desc'; ls.shift(); }
        else if (ls.length && REQ_H.test(ls[0])) { sec = 'req'; ls.shift(); }
        ls = ls.filter(function (l) { return !MAIL.test(l); });
        if (sec === 'req') { ls.forEach(function (l) { if (req.indexOf(l) < 0) req.push(l); }); return; }
        var run = 0;
        if (sec === 'tail') {
          while (run < ls.length && !EQUAL.test(ls[run])) run++;
          var q = ls.slice(0, run).filter(isReq).length;
          if (!(run >= 2 && q * 2 >= run)) run = 0;
        }
        ls.forEach(function (l, i) {
          if (EQUAL.test(l)) { desc.push(l); return; }
          if (i < run || isReq(l)) { if (req.indexOf(l) < 0) req.push(l); return; }
          desc.push(l);
        });
      });
      desc = desc.filter(function (l) { return req.indexOf(l) < 0; });
      var a = card.querySelector('a.cv[href^="mailto:"]') || card.querySelector('a[href^="mailto:"]');
      var mail = a ? a.getAttribute('href').replace(/^mailto:/i, '').split('?')[0].trim() : '';
      var job = document.createElement('div');
      job.setAttribute('data-haide-job', '1');
      job.appendChild(mk('__ai-title', title));
      var idEl = mk('', id);
      idEl.setAttribute('data-haide-job-id', '1');
      job.appendChild(idEl);
      job.appendChild(mk('__ai-description', desc.join('\n')));
      if (req.length) job.appendChild(mk('__ai-requirements', req.join('\n')));
      job.appendChild(mk('__ai-location', city(loc)));
      if (mail) job.appendChild(mk('__ai-apply-email', 'mailto:' + mail));
      root.appendChild(job);
    });
    document.body.appendChild(root);
  } catch (e) { }
})();
