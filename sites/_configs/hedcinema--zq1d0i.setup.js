(function () {
  try {
    if (document.querySelector('#haide-jobs-root')) return;
    // hedcinema.co.il career page: Elementor, one .e-con.hover-reveal container per job, all on the page.
    // No job number, no per-job URL -> h-haideHash(title). Apply is a mailto button per job, no instruction.
    // Meta line ("משרה מלאה, איזור המרכז") opens the description; its place maps to a verbatim city.csv entry.
    // "תפקידך יכלול:" / "דרישות:" are labels and are dropped; "דרישות:" opens requirements.
    var NBSP = String.fromCharCode(160);
    function haideHash(s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); }
    function lines(el) {
      var c = el.cloneNode(true);
      Array.prototype.forEach.call(c.querySelectorAll('p,div,li,br,h1,h2,h3,h4,tr'), function (e) { e.insertAdjacentText('afterend', '\n'); });
      return c.textContent.split(NBSP).join(' ').split('\n').map(function (l) { return l.replace(/[ \t]{2,}/g, ' ').trim(); }).filter(Boolean);
    }
    var KEEP = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, OTHER = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
    var DESC_H = /^(תפקידך יכלול|תיאור (ה)?תפקיד|תי?אור (ה)?משרה)\s*:?$/, REQ_H = /^(דרישות|דרישות (ה)?תפקיד|כישורים)\s*:?$/;
    var PLACES = [['אזור מרכז', /^א[י]?זור ה?מרכז$/], ['הרצליה', /^הרצליה$/]];
    function locate(meta) {
      var parts = meta.split(',').map(function (s) { return s.trim(); }), out = [];
      parts.forEach(function (p) { PLACES.forEach(function (c) { if (c[1].test(p) && out.indexOf(c[0]) < 0) out.push(c[0]); }); });
      return out.length ? out.join(', ') : 'Unknown';
    }
    var root = document.createElement('div');
    root.id = 'haide-jobs-root';
    root.style.display = 'none';
    function mk(cls, val) { var e = document.createElement('div'); e.className = cls; e.textContent = val; return e; }
    var seen = {};
    Array.prototype.forEach.call(document.querySelectorAll('.e-con.hover-reveal'), function (item) {
      var head = item.querySelector('.visible');
      var tEl = head && head.querySelector('.elementor-heading-title');
      var title = tEl ? tEl.textContent.split(NBSP).join(' ').replace(/\s+/g, ' ').trim() : '';
      var a = item.querySelector('a[href^="mailto:"]');
      if (!title || !a) return;
      if (!KEEP.test(title) || OTHER.test(title)) return;
      var id = 'h-' + haideHash(title);
      if (seen[id]) return;
      seen[id] = 1;
      var metaEl = head.querySelector('.elementor-widget-text-editor');
      var meta = metaEl ? lines(metaEl).join(' ') : '';
      var desc = meta ? [meta] : [], req = [], sec = 'desc';
      Array.prototype.forEach.call(item.querySelectorAll('.elementor-widget-text-editor'), function (block) {
        if (head.contains(block)) return;
        lines(block).forEach(function (l) {
          if (DESC_H.test(l)) { sec = 'desc'; return; }
          if (REQ_H.test(l)) { sec = 'req'; return; }
          (sec === 'req' ? req : desc).push(l);
        });
      });
      var mail = decodeURIComponent(a.getAttribute('href').replace(/^mailto:/i, '').split('?')[0]).trim();
      var job = document.createElement('div');
      job.setAttribute('data-haide-job', '1');
      job.appendChild(mk('__ai-title', title));
      var idEl = mk('', id);
      idEl.setAttribute('data-haide-job-id', '1');
      job.appendChild(idEl);
      job.appendChild(mk('__ai-description', desc.join('\n')));
      if (req.length) job.appendChild(mk('__ai-requirements', req.join('\n')));
      job.appendChild(mk('__ai-location', locate(meta)));
      job.appendChild(mk('__ai-apply-email', 'mailto:' + mail));
      root.appendChild(job);
    });
    document.body.appendChild(root);
  } catch (e) { }
})();
