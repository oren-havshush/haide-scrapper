await (async function () {
  try {
    if (document.querySelector('#haide-jobs-root')) return;
    if (!document.querySelector('.jet-listing-grid__item')) return;
    // m-shuk.net/jobs: JetEngine listing grid, one .jet-listing-grid__item per role (h2 title, an accordion
    // holding the body, an apply link to /jobs/jobs-submission?job=<title>). No job number; the only per-job
    // URL is that apply page with a Hebrew job= value -> m-shuk-haideHash(job value) (LRN-ID-6).
    // Body headings: "דרישות:" -> requirements; "תיאור התפקיד:" / "מסגרת המשרה:" stay in description; labels dropped.
    // No per-job place (60+ branches, the ad says only "בסניף") -> Unknown (LRN-LOC-7).
    // The page shows no dates; publishDate = the card's own WP post date (jobss REST route), owner call 2026-09-30.
    var dates = {};
    try {
      var r = await fetch('/wp-json/wp/v2/jobss?per_page=100&_fields=id,date', { credentials: 'omit' });
      if (r.ok) (await r.json()).forEach(function (p) { if (p && p.id && p.date) dates[p.id] = String(p.date).slice(0, 10); });
    } catch (e) { }
    var NBSP = String.fromCharCode(160);
    function haideHash(s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); }
    function lines(el) {
      var c = el.cloneNode(true);
      Array.prototype.forEach.call(c.querySelectorAll('p,div,li,br,h1,h2,h3,h4,h5,h6'), function (e) { e.insertAdjacentText('afterend', '\n'); });
      return c.textContent.split(NBSP).join(' ').split('\n').map(function (l) { return l.replace(/[ \t]{2,}/g, ' ').trim(); }).filter(Boolean);
    }
    var KEEP = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, OTHER = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
    var HEAD = /^(.{2,30}?)\s*:$/, REQ_H = /^(דרישות|דרישות התפקיד|כישורים)$/;
    var root = document.createElement('div');
    root.id = 'haide-jobs-root';
    root.style.display = 'none';
    function mk(cls, val) { var e = document.createElement('div'); e.className = cls; e.textContent = val; return e; }
    var seen = {};
    Array.prototype.forEach.call(document.querySelectorAll('.jet-listing-grid__item'), function (item) {
      var tEl = item.querySelector('h2.elementor-heading-title');
      var title = tEl ? tEl.textContent.split(NBSP).join(' ').replace(/\s+/g, ' ').trim() : '';
      var a = item.querySelector('a[href*="jobs-submission"]');
      if (!title || !a) return;
      if (!KEEP.test(title) || OTHER.test(title)) return;
      var job = new URL(a.href, location.href).searchParams.get('job') || '';
      if (!job) return;
      var id = 'm-shuk-' + haideHash(job);
      if (seen[id]) return;
      seen[id] = 1;
      var desc = [], req = [], sec = 'desc';
      Array.prototype.forEach.call(item.querySelectorAll('.elementor-tab-content'), function (body) {
        lines(body).forEach(function (l) {
          var m = HEAD.exec(l);
          if (m) { sec = REQ_H.test(m[1].trim()) ? 'req' : 'desc'; return; }
          (sec === 'req' ? req : desc).push(l);
        });
      });
      var j = document.createElement('div');
      j.setAttribute('data-haide-job', '1');
      j.appendChild(mk('__ai-title', title));
      var idEl = mk('', id);
      idEl.setAttribute('data-haide-job-id', '1');
      j.appendChild(idEl);
      j.appendChild(mk('__ai-description', desc.join('\n')));
      if (req.length) j.appendChild(mk('__ai-requirements', req.join('\n')));
      j.appendChild(mk('__ai-location', 'Unknown'));
      var pd = dates[item.getAttribute('data-post-id')];
      if (pd && /^\d{4}-\d{2}-\d{2}$/.test(pd)) j.appendChild(mk('__ai-publishDate', pd));
      var link = document.createElement('a');
      link.className = '__ai-link';
      link.href = new URL(a.getAttribute('href'), location.href).href;
      j.appendChild(link);
      root.appendChild(j);
    });
    document.body.appendChild(root);
  } catch (e) { }
})();
