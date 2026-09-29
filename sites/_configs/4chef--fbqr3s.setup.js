(function () {
  try {
    if (document.querySelector('#haide-jobs-root')) return;
    // 4chef.co.il careers: one Shopify page, one <details> accordion per job (h3 title + .accordion__content_inner).
    // No job number, no per-job URL -> h-haideHash(title). "דרישות התפקיד:" / "מה אנחנו מחפשים?" -> requirements
    // (the list that follows), other headings dropped; branch, hours, pay and equal-opportunity lines stay.
    var NBSP = String.fromCharCode(160);
    var HE = 'א-ת';
    function haideHash(s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); }
    function lines(el) {
      var c = el.cloneNode(true);
      Array.prototype.forEach.call(c.querySelectorAll('p,div,li,br,h1,h2,h3,h4,h5,h6'), function (e) { e.insertAdjacentText('afterend', '\n'); });
      return c.textContent.split(NBSP).join(' ').split('\n').map(function (l) { return l.replace(/[ \t]{2,}/g, ' ').trim(); }).filter(Boolean);
    }
    var KEEP = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, OTHER = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
    var REQ_H = /^(דרישות (ה)?תפקיד|מה אנחנו מחפשים)\s*[:?]?$/, DESC_H = /^מה כולל התפקיד\s*[:?]?$/;
    // Places, each mapped to its verbatim city.csv entry. Title first, body only when the title names none.
    var B = '(?:^|[^' + HE + '])[ובלמה]{0,2}', E = '(?![' + HE + '])';
    var PLACES = [
      ['מודיעין', 'מודיעין(?!\\s+עילית|\\s+עלית)'],
      ['הוד השרון', 'הוד\\s+השרון'],
      ['תל אביב-יפו', 'תל[\\s-]+אביב|ת["”״\']א']
    ].map(function (p) { return [p[0], new RegExp(B + '(?:' + p[1] + ')' + E)]; });
    function places(text) { var out = []; PLACES.forEach(function (p) { if (p[1].test(text)) out.push(p[0]); }); return out; }
    var root = document.createElement('div');
    root.id = 'haide-jobs-root';
    root.style.display = 'none';
    function mk(cls, val) { var e = document.createElement('div'); e.className = cls; e.textContent = val; return e; }
    var seen = {};
    Array.prototype.forEach.call(document.querySelectorAll('.collapsible-content__grid details'), function (d) {
      var tEl = d.querySelector('summary .accordion__title');
      var title = tEl ? tEl.textContent.split(NBSP).join(' ').replace(/\s+/g, ' ').trim() : '';
      var body = d.querySelector('.accordion__content_inner');
      if (!title || !body) return;
      if (!KEEP.test(title) || OTHER.test(title)) return;
      var id = 'h-' + haideHash(title);
      if (seen[id]) return;
      seen[id] = 1;
      var desc = [], req = [], sec = 'desc';
      Array.prototype.forEach.call(body.children, function (block) {
        var isList = /^(UL|OL)$/.test(block.tagName);
        if (!isList && sec === 'reqlist') sec = 'desc';
        lines(block).forEach(function (l) {
          if (REQ_H.test(l)) { sec = 'req'; return; }
          if (DESC_H.test(l)) { sec = 'desc'; return; }
          if (sec === 'req' || sec === 'reqlist') { req.push(l); return; }
          desc.push(l);
        });
        if (isList && sec === 'req') sec = 'reqlist';
      });
      var text = desc.concat(req).join('\n');
      var loc = places(title);
      if (!loc.length) loc = places(text);
      var job = document.createElement('div');
      job.setAttribute('data-haide-job', '1');
      job.appendChild(mk('__ai-title', title));
      var idEl = mk('', id);
      idEl.setAttribute('data-haide-job-id', '1');
      job.appendChild(idEl);
      job.appendChild(mk('__ai-description', desc.join('\n')));
      if (req.length) job.appendChild(mk('__ai-requirements', req.join('\n')));
      job.appendChild(mk('__ai-location', loc.length ? loc.join(', ') : 'Unknown'));
      root.appendChild(job);
    });
    document.body.appendChild(root);
  } catch (e) { }
})();
