(function () {
  try {
    if (document.querySelector('#haide-jobs-root')) return;
    // holoor.co.il/careers: Elementor toggle, a.elementor-toggle-title + .elementor-tab-content per job.
    // No job number, no per-job URL -> h-haideHash(title). Apply = the Elementor CV form (formCapture);
    // applicationInfo is NOT mapped (LRN-APPLY-12). The page's own apply paragraph (email sentence) is
    // printed once for all jobs -> appended to every description (job body rule 4, owner 2026-10-05).
    // Labels that restate the field (Job Description / הגדרות התפקיד / Requirements / דרישות התפקיד)
    // are dropped; About us / קצת עלינו / תכונות נדרשות stay as sub-headings (LRN-SPA-13).
    var NBSP = String.fromCharCode(160);
    function haideHash(s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); }
    function cfDecode(hex) { var k = parseInt(hex.substr(0, 2), 16), o = ''; for (var i = 2; i < hex.length; i += 2) o += String.fromCharCode(parseInt(hex.substr(i, 2), 16) ^ k); return o; }
    function lines(el) {
      var c = el.cloneNode(true);
      Array.prototype.forEach.call(c.querySelectorAll('[data-cfemail]'), function (e) { e.textContent = cfDecode(e.getAttribute('data-cfemail')); });
      Array.prototype.forEach.call(c.querySelectorAll('p,div,li,br,h1,h2,h3,h4,h5,h6'), function (e) { e.insertAdjacentText('afterend', '\n'); });
      return c.textContent.split(NBSP).join(' ').split('\n').map(function (l) { return l.replace(/\s{2,}/g, ' ').trim(); }).filter(Boolean);
    }
    var KEEP = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, OTHER = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
    function lbl(re) { return new RegExp('^[:\\s]*(?:' + re + ')[:\\s]*$', 'i'); }
    var DROP = lbl('Job Description|הגדרות התפקיד|תיאור התפקיד');
    var REQ = lbl('Requirements|דרישות התפקיד|דרישות');
    var EQUAL = /לנשים\s+ו?ל?גברים\s+כאחד/;
    // Shared apply paragraph: the text-editor block on the page that carries an email address.
    var shared = [];
    Array.prototype.some.call(document.querySelectorAll('.elementor-widget-text-editor'), function (w) {
      if (w.closest('.elementor-toggle')) return false;
      if (!w.querySelector('[data-cfemail], a[href*="email-protection"], a[href^="mailto:"]')) return false;
      shared = lines(w); return true;
    });
    // Job location: set only where the ad itself places the job (owner, 2026-10-05). The production job
    // is clean-room work at the Ness Ziona science-park plant its ad names (owner call); any other or
    // renamed job falls back to Unknown rather than inheriting it.
    var LOC = { 'h-t1pfzu': 'נס ציונה' };
    var root = document.createElement('div');
    root.id = 'haide-jobs-root';
    root.style.display = 'none';
    function mk(cls, val) { var e = document.createElement('div'); e.className = cls; e.textContent = val; return e; }
    var seen = {};
    Array.prototype.forEach.call(document.querySelectorAll('.elementor-toggle .elementor-toggle-item'), function (item) {
      var tEl = item.querySelector('.elementor-toggle-title');
      var body = item.querySelector('.elementor-tab-content');
      var title = tEl ? tEl.textContent.split(NBSP).join(' ').replace(/\s+/g, ' ').trim() : '';
      if (!title || !body || !KEEP.test(title) || OTHER.test(title)) return;
      var id = 'h-' + haideHash(title);
      if (seen[id]) return;
      seen[id] = 1;
      var desc = [], req = [], sec = 'desc';
      lines(body).forEach(function (l) {
        if (!/[\p{L}\d]/u.test(l)) return;
        if (DROP.test(l)) { sec = 'desc'; return; }
        if (REQ.test(l)) { sec = 'req'; return; }
        if (EQUAL.test(l)) { desc.push(l); return; }
        (sec === 'req' ? req : desc).push(l);
      });
      desc = desc.concat(shared);
      var job = document.createElement('div');
      job.setAttribute('data-haide-job', '1');
      job.appendChild(mk('__ai-title', title));
      var idEl = mk('', id);
      idEl.setAttribute('data-haide-job-id', '1');
      job.appendChild(idEl);
      job.appendChild(mk('__ai-description', desc.join('\n')));
      if (req.length) job.appendChild(mk('__ai-requirements', req.join('\n')));
      job.appendChild(mk('__ai-location', LOC[id] || 'Unknown'));
      root.appendChild(job);
    });
    document.body.appendChild(root);
  } catch (e) { }
})();
