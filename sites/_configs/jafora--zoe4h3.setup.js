(function () {
  try {
    if (document.querySelector('#haide-jobs-root')) return;
    // jafora.co.il/jobs: WordPress theme accordion, every job on one page, no per-job URL.
    // .job-row > .job-row-header[data-jobnumber] + .job-row-content .job-row-content-text.
    // Header: "<gray>דרוש/ה</gray> <role> - <gray>city</gray>" + "משרה מספר - N" -> id jafora-N.
    // Body <p>s: "מהות התפקיד:" -> description, "דרישות התפקיד:" -> requirements (labels dropped).
    // Each body ends with a bare hr@ address -> applicationInfo (not description), then a shared line that stays.
    // The benefits block above the jobs (.section-droshim-two) is shared by every job -> appended to each description.
    var NBSP = String.fromCharCode(160);
    function clean(s) { return s.split(NBSP).join(' ').replace(/\s+/g, ' ').trim(); }
    function lines(el) {
      var c = el.cloneNode(true);
      Array.prototype.forEach.call(c.querySelectorAll('p,div,li,br,h1,h2,h3,h4,h5,h6,tr'), function (e) { e.insertAdjacentText('afterend', '\n'); });
      return c.textContent.split(NBSP).join(' ').split('\n').map(function (l) { return l.replace(/[ \t]{2,}/g, ' ').trim(); }).filter(Boolean);
    }
    var KEEP = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, OTHER = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
    var EMAIL = /^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i;
    // Place names as the page writes them -> verbatim city.csv entry. An unlisted name is dropped, never guessed.
    var CITY = { 'רחובות': 'רחובות', 'צרעה': 'צרעה' };
    var shared = [];
    var box = document.querySelector('.section-droshim-two .container.hidden-xs') || document.querySelector('.section-droshim-two');
    if (box) Array.prototype.forEach.call(box.querySelectorAll('.box-padding'), function (b) { lines(b).forEach(function (l) { shared.push(l); }); });
    var root = document.createElement('div');
    root.id = 'haide-jobs-root';
    root.style.display = 'none';
    function mk(cls, val) { var e = document.createElement('div'); e.className = cls; e.textContent = val; return e; }
    var seen = {};
    Array.prototype.forEach.call(document.querySelectorAll('.job-wrap .job-row'), function (row) {
      var head = row.querySelector('.job-row-header');
      var tEl = row.querySelector('.job-title');
      if (!head || !tEl) return;
      var dEl = row.querySelector('.job-date');
      var m = dEl && /משרה מספר\s*-\s*(\d+)/.exec(clean(dEl.textContent));
      var num = m ? m[1] : clean(head.getAttribute('data-jobnumber') || '');
      if (!/^\d+$/.test(num)) return;
      var id = 'jafora-' + num;
      if (seen[id]) return;
      var spans = Array.prototype.filter.call(tEl.children, function (s) { return s.tagName === 'SPAN'; });
      var roleEl = spans.filter(function (s) { return !s.classList.contains('gray-color'); })[0];
      var title = roleEl ? clean(roleEl.textContent) : '';
      if (!title || !KEEP.test(title) || OTHER.test(title)) return;
      var grays = spans.filter(function (s) { return s.classList.contains('gray-color'); });
      var place = grays.length > 1 ? clean(grays[grays.length - 1].textContent) : '';
      seen[id] = 1;
      var desc = [], req = [], tail = [], email = '', howto = '';
      var body = row.querySelector('.job-row-content-text');
      if (body) {
        // Labels are lines of their own (a <p>, a <br> run, or inside a <table>); each one switches
        // the section until the next. Loose text after the elements is the email + shared closing line.
        var sec = 'desc';
        Array.prototype.forEach.call(body.childNodes, function (n) {
          if (n.nodeType !== 1) {
            var t = clean(n.textContent || '');
            if (!t) return;
            if (EMAIL.test(t)) { if (!email) email = t; } else tail.push(t);
            return;
          }
          lines(n).forEach(function (l) {
            var lm = /^(מהות התפקיד|תיאור התפקיד|במסגרת התפקיד|דרישות התפקיד|דרישות)\s*[:\-–]?\s*(.*)$/.exec(l);
            if (lm) { sec = /^דרישות/.test(lm[1]) ? 'req' : 'desc'; l = lm[2]; }
            l = l.replace(/^[*•▪]\s*/, '');
            if (!l) return;
            // "נא לשלוח קו"ח למייל: X בצירוף מספר משרה N" is how to apply -> applicationInfo.
            var em = /([\w.+-]+@[\w.-]+\.[a-z]{2,})(.*)$/i.exec(l);
            if (em) { email = em[1]; howto = clean(em[2]).replace(/^[\s,.:\-–]+|[\s.]+$/g, ''); return; }
            // Pay and working hours are not requirements.
            if (sec === 'req' && !/שכר/.test(l) && !/\d:\d\d/.test(l)) req.push(l); else desc.push(l);
          });
        });
      }
      var job = document.createElement('div');
      job.setAttribute('data-haide-job', '1');
      job.appendChild(mk('__ai-title', title));
      var idEl = mk('', id);
      idEl.setAttribute('data-haide-job-id', '1');
      job.appendChild(idEl);
      job.appendChild(mk('__ai-description', desc.concat(tail, shared).join('\n')));
      if (req.length) job.appendChild(mk('__ai-requirements', req.join('\n')));
      job.appendChild(mk('__ai-location', CITY[place] || 'Unknown'));
      if (email) job.appendChild(mk('__ai-applicationInfo', 'mailto:' + email + (howto ? ' - ' + howto : '')));
      root.appendChild(job);
    });
    document.body.appendChild(root);
  } catch (e) { }
})();
