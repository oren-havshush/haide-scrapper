(function () {
  try {
    // m-work.co.il/דרושים: every job is one <p> in a single Elementor text widget; title = the <p>'s first <strong>,
    // lines split on <br>. No job pages, no numbers, no dates. Id: h-haideHash(title) (no number, no URL).
    // Body: "דרישות:" opens requirements; the labels "תיאור התפקיד:" / "מה כולל התפקיד?" are dropped (owner rules).
    // Apply (owner, 2026-10-05): email is the apply path -> applicationInfo = the HR mailto in the page intro
    // (Cloudflare-obfuscated in the HTML; decoded here if the CF decoder has not run). The contact form is not an apply form.
    // Location: set manually (owner, 2026-10-05): every job -> שלומי. Jobs name no place; the site prints one address,
    // the plant at שלומי, א.ת. דורה, and its new plant is also in Shlomi (single-site manufacturer).
    if (document.getElementById('haide-jobs-root')) return;
    var LOC = 'שלומי';
    var NBSP = String.fromCharCode(160);
    function haideHash(s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); }
    function clean(s) { return (s || '').split(NBSP).join(' ').replace(/[ \t]+/g, ' ').trim(); }
    function cf(hex) { var k = parseInt(hex.substr(0, 2), 16), o = ''; for (var i = 2; i < hex.length; i += 2) o += String.fromCharCode(parseInt(hex.substr(i, 2), 16) ^ k); return o; }
    function jobPs(w) {
      return Array.prototype.filter.call(w.querySelectorAll('p'), function (p) {
        var s = p.querySelector('strong');
        return s && clean(s.textContent) && /דרישות\s*:/.test(p.textContent);
      });
    }
    var widget = Array.prototype.filter.call(document.querySelectorAll('.elementor-widget-text-editor'), function (w) { return jobPs(w).length >= 2; })[0];
    if (!widget) return;
    var email = '';
    Array.prototype.some.call(widget.querySelectorAll('a[href^="mailto:"], [data-cfemail], a[href*="email-protection#"]'), function (a) {
      var h = a.getAttribute('href') || '';
      if (/^mailto:/i.test(h)) email = h.replace(/^mailto:/i, '').split('?')[0];
      else if (a.getAttribute('data-cfemail')) email = cf(a.getAttribute('data-cfemail'));
      else if (/email-protection#/.test(h)) email = cf(h.split('#')[1]);
      return /@/.test(email);
    });
    var LABEL = /^(תיאור\s+(ה)?(תפקיד|משרה)|מה\s+כולל\s+התפקיד)\s*[:?\-–]?\s*$/;
    var REQ_H = /^דרישות\s*:\s*$/;
    var root = document.createElement('div');
    root.id = 'haide-jobs-root';
    root.style.display = 'none';
    function mk(cls, val) { var e = document.createElement('div'); e.className = cls; e.textContent = val; return e; }
    jobPs(widget).forEach(function (p) {
      var title = clean(p.querySelector('strong').textContent);
      if (!/(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u.test(title) || /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u.test(title)) return;
      var c = p.cloneNode(true);
      Array.prototype.forEach.call(c.querySelectorAll('br'), function (e) { e.insertAdjacentText('afterend', '\n'); });
      var lines = c.textContent.split('\n').map(clean).filter(Boolean);
      if (lines[0] === title) lines.shift();
      else if (lines[0] && lines[0].indexOf(title) === 0) lines[0] = clean(lines[0].slice(title.length));
      var desc = [], req = [], inReq = false;
      lines.forEach(function (l) {
        if (!l) return;
        if (REQ_H.test(l)) { inReq = true; return; }
        if (LABEL.test(l)) return;
        (inReq ? req : desc).push(l);
      });
      var job = document.createElement('div');
      job.setAttribute('data-haide-job', '1');
      job.appendChild(mk('__ai-title', title));
      job.appendChild(mk('__ai-id', 'h-' + haideHash(title)));
      job.appendChild(mk('__ai-description', desc.join('\n')));
      if (req.length) job.appendChild(mk('__ai-requirements', req.join('\n')));
      job.appendChild(mk('__ai-location', LOC));
      if (email) job.appendChild(mk('__ai-apply-email', 'mailto:' + email));
      root.appendChild(job);
    });
    document.body.appendChild(root);
  } catch (e) { }
})();
