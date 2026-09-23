(function () {
  try {
    if (document.querySelector('#haide-jobs-root')) return;
    // domicile.co.il: every opening is prose on ONE WordPress page. No job CPT, no
    // detail pages, no repeating element (triage's cluster is the shop menu).
    // Blocks are separated by <hr> and by long underscore rules; apply is email
    // (Cloudflare-obfuscated). Owner job-body rules applied: requirements only in
    // requirements, field labels dropped, how-to-apply moved to applicationInfo.
    var NBSP = String.fromCharCode(160);
    var SEP = '\n@@JOB@@\n';

    function structuredText(el) {
      var c = el.cloneNode(true);
      Array.prototype.forEach.call(c.querySelectorAll('p,div,li,br,h1,h2,h3,h4,tr'), function (e) { e.insertAdjacentText('afterend', '\n'); });
      return c.textContent.split(NBSP).join(' ').replace(/[ \t]{2,}/g, ' ');
    }
    function lines(s) { return s.split('\n').map(function (l) { return l.trim(); }).filter(Boolean); }
    function cfdecode(hex) { var k = parseInt(hex.substr(0, 2), 16), o = ''; for (var i = 2; i < hex.length; i += 2) o += String.fromCharCode(parseInt(hex.substr(i, 2), 16) ^ k); return o; }
    function haideHash(s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); }

    var main = document.querySelector('main.l-main') || document.querySelector('main');
    if (!main) return;

    var clone = main.cloneNode(true);
    Array.prototype.forEach.call(clone.querySelectorAll('img,script,style,noscript'), function (e) { e.parentNode.removeChild(e); });
    // Cloudflare email obfuscation: put the real address back before reading text
    Array.prototype.forEach.call(clone.querySelectorAll('.__cf_email__'), function (e) {
      var hx = e.getAttribute('data-cfemail');
      e.textContent = hx ? cfdecode(hx) : '';
    });
    Array.prototype.forEach.call(clone.querySelectorAll('hr'), function (e) { e.insertAdjacentText('beforebegin', SEP); });

    var text = structuredText(clone).replace(/\n[ \t]*_{10,}[ \t]*(?=\n|$)/g, SEP);
    var em = /[\w.+-]+@domicile\.co\.il/i.exec(text);
    var EMAIL = em ? em[0] : 'jobs@domicile.co.il';

    var blocks = text.split('@@JOB@@');

    // Shared how-to-apply instruction, printed once in the page intro.
    var HOWTO = '';
    lines(blocks[0] || '').forEach(function (l) {
      if (l.indexOf(EMAIL) >= 0) HOWTO = l.split(EMAIL).join('').replace(/\s{2,}/g, ' ').replace(/\s+$/, '');
    });

    // "דרישות" / "דרישות התפקיד" is the field label, not content -> dropped.
    var REQ_LABEL = /^דרישות(\s+התפקיד)?\s*:?$/;
    // A requirements run ends at the offer/terms/hours/location lines.
    var NOT_REQ = /^(אנחנו מציעים|שעות עבודה|מיקום\s*:|\*)/;
    var APPLY_CUE = /קורות חיים|להגשת מועמדות|ניתן להתקשר|או לשלוח/;
    // leading list markers: bullet, black circle, small square, hyphen (built by
    // code, never as a \u escape — the file writer decodes those, see CLAUDE.md)
    var BULLET = new RegExp('^[' + String.fromCharCode(8226, 9679, 9642) + '-]\\s*');

    var root = document.createElement('div');
    root.id = 'haide-jobs-root';
    root.style.display = 'none';
    function mk(cls, val) { var e = document.createElement('div'); e.className = cls; e.textContent = val; return e; }

    blocks.forEach(function (block, bi) {
      var ls = lines(block);
      if (ls.length < 3) return;
      // block 0 is the page intro (company blurb + the shared apply line), not a job
      if (bi === 0 && (/מתרחבת/.test(block) || block.indexOf(EMAIL) >= 0)) return;

      var title = ls[0].replace(/\s{2,}/g, ' ').trim();
      if (!title) return;

      var desc = [], req = [], applyLines = [], mode = 'desc';
      ls.slice(1).forEach(function (raw) {
        var l = raw.replace(BULLET, '').trim();
        if (!l) return;
        if (APPLY_CUE.test(l) || l.indexOf(EMAIL) >= 0) { applyLines.push(l); mode = 'desc'; return; }
        if (REQ_LABEL.test(l)) { mode = 'req'; return; }
        if (mode === 'req' && NOT_REQ.test(l)) mode = 'desc';
        (mode === 'req' ? req : desc).push(l);
      });
      if (!desc.length) return;

      var own = ls.join('\n');
      // location: verbatim city.csv entries only. The job text keeps the employer's own
      // wording ("azor taasiya Gezer" / "kibbutz Gezer") in the description; the city
      // field carries just the place. Nothing stated -> Unknown.
      var loc = /בני ברק/.test(own) ? 'בני ברק'
        : /קיבוץ גזר|אזור תעשיה גזר|אזור תעשייה גזר|דומיסיל בגזר/.test(own) ? 'גזר'
          : 'Unknown';

      // apply: the shared instruction, plus any phone the job prints itself
      var extra = applyLines.filter(function (l) { return /\d{7,}/.test(l); })
        .map(function (l) { return l.split(EMAIL).join('').replace(/\s{2,}/g, ' ').trim(); });
      var note = [HOWTO].concat(extra).filter(Boolean).join('. ');

      var job = document.createElement('div');
      job.setAttribute('data-haide-job', '1');
      job.appendChild(mk('__ai-title', title));
      var idEl = mk('', 'h-' + haideHash(title.toLowerCase().replace(/\s+/g, ' ')));
      idEl.setAttribute('data-haide-job-id', '1');
      job.appendChild(idEl);
      job.appendChild(mk('__ai-description', desc.join('\n')));
      if (req.length) job.appendChild(mk('__ai-requirements', req.join('\n')));
      job.appendChild(mk('__ai-location', loc));
      job.appendChild(mk('__ai-apply-email', 'mailto:' + EMAIL + (note ? ' - ' + note : '')));
      root.appendChild(job);
    });

    document.body.appendChild(root);
  } catch (e) { }
})();
