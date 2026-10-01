(function () {
  try {
    if (document.querySelector('#haide-jobs-root')) return;
    // hgj.co.il: every job is prose in ONE Elementor post-content block: <h2> category,
    // <h3> title, then <p>/<ul> body until the next heading. No job number, no job page.
    // - id: h- + djb2(title) (no number, no URL)
    // - requirements only in requirements; a "דרישות:" label is dropped
    // - "*המשרות מיועדות לנשים וגברים כאחד." from the intro is appended to every job
    // - apply: the intro's email (Cloudflare-obfuscated); the fax line is dropped
    // - location: the page footer's one office, except field audit (ביקורת שטח) -> Unknown
    var NBSP = String.fromCharCode(160);
    function haideHash(s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); }
    function clean(s) { return (s || '').split(NBSP).join(' ').replace(/[ \t]+/g, ' ').trim(); }
    function lines(el) {
      var c = el.cloneNode(true);
      Array.prototype.forEach.call(c.querySelectorAll('br,li,p'), function (e) { e.insertAdjacentText('afterend', '\n'); });
      return c.textContent.split('\n').map(clean).filter(Boolean);
    }
    function cfDecode(a) {
      var s = a.getAttribute('data-cfemail'); if (!s) return '';
      var k = parseInt(s.substr(0, 2), 16), out = '';
      for (var i = 2; i < s.length; i += 2) out += String.fromCharCode(parseInt(s.substr(i, 2), 16) ^ k);
      return out;
    }
    var box = Array.prototype.filter.call(document.querySelectorAll('.elementor-widget-theme-post-content .elementor-widget-container'), function (b) {
      return b.querySelector('h3');
    })[0];
    if (!box) return;

    var EMAIL = '', SHARED = [];
    var cf = box.querySelector('[data-cfemail]');
    if (cf) EMAIL = cfDecode(cf);
    if (!EMAIL) { var ml = box.querySelector('a[href^="mailto:"]'); if (ml) EMAIL = ml.getAttribute('href').replace(/^mailto:/i, '').split('?')[0]; }
    if (!EMAIL) { var pm = /[\w.+-]+@[\w-]+(\.[\w-]+)+/.exec(box.textContent); if (pm) EMAIL = pm[0]; }
    if (EMAIL.indexOf('@') < 0) return;

    var kids = Array.prototype.slice.call(box.children), first = kids.findIndex(function (k) { return k.tagName === 'H3'; });
    kids.slice(0, first).forEach(function (k) {
      if (k.tagName !== 'P') return;
      lines(k).forEach(function (l) { if (/^\*?\s*המשרות מיועדות/.test(l)) SHARED.push(l); });
    });

    var foot = /,\s*(פתח תקווה)\s*\./.exec(document.body.textContent.split(NBSP).join(' '));
    var OFFICE = foot ? foot[1] : 'Unknown';
    var REQ = /^(ניסיון|נסיון|ידע|רישיון|רשיון|תעודה|תעודת|בעל\/ת|בעל |בעלת|יכולת|נכונות|זמינות|שליטה|הכרה|הכרת|דובר|עדיפות|נדרש|רצוי|אמינות|דייקנות|יחסי אנוש|סטודנט)/;
    var NOT_REQ = /^(התפקיד|ניתן לשלוח|עבודה|משרה|למשרה)|שכר/;

    var root = document.createElement('div');
    root.id = 'haide-jobs-root';
    root.style.display = 'none';
    function mk(cls, val) { var e = document.createElement('div'); e.className = cls; e.textContent = val; return e; }
    var seen = {};

    for (var i = first; i < kids.length; i++) {
      if (kids[i].tagName !== 'H3') continue;
      var title = clean(kids[i].textContent);
      if (!title || seen[title]) continue;
      seen[title] = 1;
      var desc = [], req = [], labelled = false;
      for (var j = i + 1; j < kids.length && !/^H[23]$/.test(kids[j].tagName); j++) {
        var el = kids[j];
        if (el.tagName === 'UL' || el.tagName === 'OL') {
          Array.prototype.forEach.call(el.querySelectorAll('li'), function (li) {
            var l = clean(li.textContent); if (!l) return;
            (labelled || (REQ.test(l) && !NOT_REQ.test(l)) ? req : desc).push(l);
          });
        } else {
          lines(el).forEach(function (l) {
            if (/^דרישות\s*:?\s*$/.test(l)) { labelled = true; return; }
            (REQ.test(l) ? req : desc).push(l);
          });
        }
      }
      if (!desc.length && !req.length) continue;
      var loc = /ביקורת שטח/.test(title + ' ' + desc.join(' ')) ? 'Unknown' : OFFICE;
      var job = document.createElement('div');
      job.setAttribute('data-haide-job', '1');
      job.appendChild(mk('__ai-title', title));
      var idEl = mk('', 'h-' + haideHash(title));
      idEl.setAttribute('data-haide-job-id', '1');
      job.appendChild(idEl);
      job.appendChild(mk('__ai-description', desc.concat(SHARED).join('\n')));
      if (req.length) job.appendChild(mk('__ai-requirements', req.join('\n')));
      job.appendChild(mk('__ai-location', loc));
      job.appendChild(mk('__ai-apply-email', 'mailto:' + EMAIL));
      root.appendChild(job);
    }
    document.body.appendChild(root);
  } catch (e) { }
})();
