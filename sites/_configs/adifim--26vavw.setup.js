(function () {
  try {
    if (document.querySelector('#haide-jobs-root')) return;

    function haideHash(s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); }

    // LRN-SETUP §7 — preserve block line breaks; never .replace(/\s+/g,' ')
    function structuredText(el) {
      if (!el) return '';
      var c = el.cloneNode(true);
      Array.prototype.forEach.call(c.querySelectorAll('p,div,ul,ol,li,br,h1,h2,h3,h4,h5,h6,tr'), function (e) { e.insertAdjacentText('afterend', '\n'); });
      return c.textContent.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
    }

    // adifim.co.il serves the apply address Cloudflare-obfuscated (a.__cf_email__[data-cfemail])
    function cfDecode(a) {
      try {
        var s = a.getAttribute('data-cfemail'); if (!s) return '';
        var k = parseInt(s.substr(0, 2), 16), out = '';
        for (var i = 2; i < s.length; i += 2) out += String.fromCharCode(parseInt(s.substr(i, 2), 16) ^ k);
        return out;
      } catch (e) { return ''; }
    }

    var APPLY_FALLBACK = 'adifim@adifim.co.il';
    // Single-office employer: בניין A, מטרופארק, משה דיין 10, פתח תקווה 49528.
    // Hardcoded because the gazetteer previously guessed the non-canonical spelling "פתח תקוה".
    // Value is verbatim from "CSV files/city.csv".
    var OFFICE = 'פתח תקווה';

    var root = document.createElement('div');
    root.id = 'haide-jobs-root';
    root.style.display = 'none';

    function mk(cls, text) { var e = document.createElement('div'); if (cls) e.className = cls; e.style.display = 'none'; e.textContent = text; return e; }

    // Top-level job bodies only — one job nests a .jobDescription inside a .jobDescription.
    var bodies = Array.prototype.filter.call(document.querySelectorAll('.jobDescription'), function (d) {
      return !d.parentElement || !d.parentElement.closest('.jobDescription');
    });

    var seen = {};
    for (var i = 0; i < bodies.length; i++) {
      var body = bodies[i];
      var section = body.closest('section.elementor-top-section') || body.closest('section');
      if (!section) continue;

      var h2 = section.querySelector('h2.elementor-heading-title, h2');
      var title = h2 ? (h2.textContent || '').replace(/\s+/g, ' ').trim() : '';
      if (!title || seen[title]) continue;

      // description = job body MINUS any requirements block nested inside it (no field overlap)
      var descClone = body.cloneNode(true);
      Array.prototype.forEach.call(descClone.querySelectorAll('.jobRequirements'), function (e) { e.parentNode && e.parentNode.removeChild(e); });
      var desc = structuredText(descClone);
      if (!desc) continue;

      // requirements = its own block MINUS the "דרישות המשרה:" sub-header and the "send CV" line
      var req = '';
      var reqEl = section.querySelector('.jobRequirements');
      if (reqEl) {
        var reqClone = reqEl.cloneNode(true);
        Array.prototype.forEach.call(reqClone.querySelectorAll('.JobItemSubHeader'), function (e) { e.parentNode && e.parentNode.removeChild(e); });
        Array.prototype.forEach.call(reqClone.querySelectorAll('div,p'), function (e) {
          if (/לשליחת קורות חיים/.test(e.textContent || '')) { e.parentNode && e.parentNode.removeChild(e); }
        });
        req = structuredText(reqClone);
      }
      if (req && desc && req === desc) req = '';

      var email = '';
      var cf = section.querySelector('a.__cf_email__[data-cfemail]');
      if (cf) email = cfDecode(cf);
      if (!email) {
        var m = section.querySelector('a[href^="mailto:"]');
        if (m) email = (m.getAttribute('href') || '').replace(/^mailto:/, '').split('?')[0];
      }
      if (!email || email.indexOf('@') === -1) email = APPLY_FALLBACK;

      seen[title] = 1;

      var job = document.createElement('div');
      job.setAttribute('data-haide-job', '1');
      job.appendChild(mk('__ai-title', title));
      var idEl = mk('', 'h-' + haideHash(title.toLowerCase().replace(/\s+/g, ' ').trim()));
      idEl.setAttribute('data-haide-job-id', '1');
      job.appendChild(idEl);
      job.appendChild(mk('__ai-description', desc));
      if (req) job.appendChild(mk('__ai-requirements', req));
      job.appendChild(mk('__ai-location', OFFICE));
      job.appendChild(mk('__ai-apply-email', 'mailto:' + email));
      root.appendChild(job);
    }

    document.body.appendChild(root);
  } catch (e) { }
})();
