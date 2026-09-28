(function () {
  try {
    if (document.querySelector('#haide-jobs-root')) return;
    // budget.co.il careers: one accordion, h3.accordionBtnTitle + div.accordion-panel per job.
    // No job number, no per-job URL; accordion ids are regenerated per request -> h-haideHash(title).
    // Sections: "תאור המשרה:" -> description, "דרישות התפקיד:" -> requirements (labels dropped).
    // A headless requirement line in the description moves (LRN-SETUP-18); the equal-opportunity
    // line stays in the description; mail/fax contact lines are dropped;
    // applicationInfo is the address only (the page gives no instruction for the email).
    var NBSP = String.fromCharCode(160);
    var HE = 'א-ת';
    function haideHash(s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); }
    function lines(el) {
      var c = el.cloneNode(true);
      Array.prototype.forEach.call(c.querySelectorAll('p,div,li,br,h1,h2,h3,h4,tr'), function (e) { e.insertAdjacentText('afterend', '\n'); });
      return c.textContent.split(NBSP).join(' ').split('\n').map(function (l) { return l.replace(/[ \t]{2,}/g, ' ').trim(); }).filter(Boolean);
    }
    var KEEP = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, OTHER = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
    var DESC_H = /^תי?אור (ה)?משרה\s*:?$/, REQ_H = /^דרישות (ה)?תפקיד\s*:?$/;
    var CONTACT = /^(פרטים ליצירת קשר|מייל\s*:|דוא["”״]?ל\s*:|מספר פקס\s*:|פקס\s*:)/;
    var EQUAL = /לנשים\s+ו?ל?גברים\s+כאחד/;
    var REQ_WORD = new RegExp('^(ניסיון|נסיון|ידע|רישיון|רשיון|תעודה|תעודת|בעל|בעלת|בעל/ת|יכולת|יכולות|נכונות|זמינות|שליטה|הכרה|הכרת|מגורים|דובר|דוברת|עדיפות|נדרש|נדרשת|רצוי|גישה)(?![' + HE + '])');
    function isReq(l) {
      var t = l.replace(/^[^\p{L}\d]+/u, '');
      if (/דרוש/.test(t) || /\d:\d\d/.test(t) || /^שכר|\sשכר\s/.test(t) || t.length > 150) return false;
      return /חובה|יתרון/.test(t) || REQ_WORD.test(t);
    }
    // Places, each mapped to its verbatim city.csv entry.
    var B = '(?:^|[^' + HE + '])[ובלמה]{0,2}', E = '(?![' + HE + '])';
    var PLACES = [
      ['איירפורט סיטי', 'איירפורט סיטי|קרי?ית\\s+שדה\\s+התעופה'],
      ['נתב"ג', 'נתב["”״\']?ג'],
      ['באר שבע', 'באר\\s+שבע'], ['יבנה', 'יבנה'], ['רמלה לוד', 'לוד'], ['בני ברק', 'בני\\s+ברק'],
      ['נתניה', 'נתניה'], ['ראשון לציון', 'ראשון\\s+לציון|ראשל["”״\']?צ'],
      ['תל אביב-יפו', 'תל[\\s-]+אביב|ת["”״\']א']
    ].map(function (p) { return [p[0], new RegExp(B + '(?:' + p[1] + ')' + E)]; });
    function locate(text) {
      text = text.replace(/\(\s*ליד[^)]*\)/g, ' ');                  // "(ליד נתב"ג)" is a landmark, not a place
      if (/פריסה\s+ה?ארצית/.test(text)) return 'פריסה ארצית';
      var out = [], m = /באזורי?\s+(.{0,30})/.exec(text);
      if (m) [['דרום', 'אזור דרום'], ['מרכז', 'אזור מרכז'], ['צפון', 'אזור צפון']].forEach(function (r) {
        if (new RegExp('(?:^|[^' + HE + '])ה?' + r[0] + E).test(m[1])) out.push(r[1]);
      });
      PLACES.forEach(function (p) { if (p[1].test(text) && out.indexOf(p[0]) < 0) out.push(p[0]); });
      return out.length ? out.join(', ') : 'Unknown';
    }
    var fallbackMail = document.querySelector('.accordion-panel a[href^="mailto:"]');
    var root = document.createElement('div');
    root.id = 'haide-jobs-root';
    root.style.display = 'none';
    function mk(cls, val) { var e = document.createElement('div'); e.className = cls; e.textContent = val; return e; }
    var seen = {};
    Array.prototype.forEach.call(document.querySelectorAll('.ymx_accordion h3.accordionBtnTitle'), function (h) {
      var tEl = h.querySelector('.sr-only') || h.querySelector('.isName');
      var title = tEl ? tEl.textContent.split(NBSP).join(' ').replace(/\s+/g, ' ').trim() : '';
      var panel = h.nextElementSibling;
      if (!title || !panel || !panel.classList.contains('accordion-panel')) return;
      if (!KEEP.test(title) || OTHER.test(title)) return;
      var id = 'h-' + haideHash(title);
      if (seen[id]) return;
      seen[id] = 1;
      var desc = [], req = [], sec = 'desc';
      var entry = panel.querySelector('.entry') || panel;
      Array.prototype.forEach.call(entry.children, function (block) {
        lines(block).forEach(function (l) {
          if (DESC_H.test(l)) { sec = 'desc'; return; }
          if (REQ_H.test(l)) { sec = 'req'; return; }
          if (CONTACT.test(l)) { sec = 'contact'; }
          if (sec === 'contact') return;
          if (EQUAL.test(l)) { desc.push(l); return; }
          if (sec === 'req' || isReq(l)) { if (req.indexOf(l) < 0) req.push(l); return; }
          desc.push(l);
        });
      });
      desc = desc.filter(function (l) { return req.indexOf(l) < 0; });
      var a = panel.querySelector('a[href^="mailto:"]') || fallbackMail;
      var mail = a ? a.getAttribute('href').replace(/^mailto:/i, '').split('?')[0].trim() : 'hrjobs@budget.co.il';
      var job = document.createElement('div');
      job.setAttribute('data-haide-job', '1');
      job.appendChild(mk('__ai-title', title));
      var idEl = mk('', id);
      idEl.setAttribute('data-haide-job-id', '1');
      job.appendChild(idEl);
      job.appendChild(mk('__ai-description', desc.join('\n')));
      if (req.length) job.appendChild(mk('__ai-requirements', req.join('\n')));
      job.appendChild(mk('__ai-location', locate(title + '\n' + desc.concat(req).join('\n'))));
      job.appendChild(mk('__ai-apply-email', 'mailto:' + mail));
      root.appendChild(job);
    });
    document.body.appendChild(root);
  } catch (e) { }
})();
