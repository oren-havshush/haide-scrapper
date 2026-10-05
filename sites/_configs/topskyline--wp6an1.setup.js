(function () {
  try {
    if (document.querySelector('#haide-jobs-root')) return;
    // topskyline.com/career: one page, div.l_job per job; "Read More" is href="#" (no per-job URL),
    // no job number -> h-haideHash(title). Header <strong>: Role / Location / Type.
    // Description = Type line + intro <p> + .more-text up to "Requirements:"; the rest -> requirements.
    // Labels that only restate the field (Description:, Role Description:, Requirements:) are dropped;
    // "Key Responsibilities:" stays (LRN-SPA-13). Apply = the shared CF7 modal form (formCapture).
    var NBSP = String.fromCharCode(160);
    function haideHash(s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); }
    function lines(el) {
      var c = el.cloneNode(true);
      Array.prototype.forEach.call(c.querySelectorAll('p,div,li,br,h1,h2,h3,h4,h5,h6'), function (e) { e.insertAdjacentText('afterend', '\n'); });
      return c.textContent.split(NBSP).join(' ').split('\n').map(function (l) { return l.replace(/\s{2,}/g, ' ').trim(); }).filter(Boolean);
    }
    var KEEP = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, OTHER = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
    var root = document.createElement('div');
    root.id = 'haide-jobs-root';
    root.style.display = 'none';
    function mk(cls, val) { var e = document.createElement('div'); e.className = cls; e.textContent = val; return e; }
    var seen = {};
    Array.prototype.forEach.call(document.querySelectorAll('.carrer_jobs .l_job'), function (card) {
      var tw = card.querySelector('.text-wrapper');
      var head = tw && tw.querySelector('strong');
      if (!head) return;
      var title = '', loc = '', desc = [], req = [];
      // The header is "Role: X<br>Location:<newline>Y<br>Type: Z"; read it as one flat string.
      var ht = head.textContent.split(NBSP).join(' ').replace(/\s+/g, ' ').trim();
      var tm = /Role\s*:\s*(.+?)\s*(?:Location\s*:|$)/i.exec(ht);
      var lm = /Location\s*:\s*(.+?)\s*(?:Type\s*:|$)/i.exec(ht);
      var ym = /(Type\s*:.+)$/i.exec(ht);
      if (tm) title = tm[1];
      if (lm) loc = lm[1];
      if (ym) desc.push(ym[1]);
      if (!title || !KEEP.test(title) || OTHER.test(title)) return;
      var id = 'h-' + haideHash(title);
      if (seen[id]) return;
      seen[id] = 1;
      var sec = 'desc';
      Array.prototype.forEach.call(tw.children, function (block) {
        if (block === head || block.tagName === 'A' || block.tagName === 'H6') return;
        lines(block).forEach(function (l) {
          if (/^(Role\s+)?Description\s*:\s*$/i.test(l)) return;
          if (/^Requirements\s*:?\s*$/i.test(l)) { sec = 'req'; return; }
          l = l.replace(/^Role\s+Description\s*:\s*/i, '');
          if (/^Read More$/i.test(l)) return;
          (sec === 'req' ? req : desc).push(l);
        });
      });
      var job = document.createElement('div');
      job.setAttribute('data-haide-job', '1');
      job.appendChild(mk('__ai-title', title));
      var idEl = mk('', id);
      idEl.setAttribute('data-haide-job-id', '1');
      job.appendChild(idEl);
      job.appendChild(mk('__ai-description', desc.join('\n')));
      if (req.length) job.appendChild(mk('__ai-requirements', req.join('\n')));
      job.appendChild(mk('__ai-location', /Ra\S{0,2}anana/i.test(loc) ? 'רעננה' : 'Unknown'));
      root.appendChild(job);
    });
    document.body.appendChild(root);
  } catch (e) { }
})();
