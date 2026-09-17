(function () {
  try {
    if (document.querySelector('#haide-jobs-root')) return;
    // heara.co.il: all jobs are prose in ONE <td>, split by dash lines and/or underlined
    // "... - משרה NNN" headings. Rules set by the site owner (see adminNote):
    // - a GROUP block (משרה 100) is not a job; each sub-track "משרה 10N - X" is
    // - a standalone posting owns its number (group track 107 dropped for היטקלאס)
    // - "לא זמין" postings are closed; the closing section ("הכשרות -" up to the
    //   "how to apply" lines) is appended to every job
    // - the email instructions go to applicationInfo, with the job's own number
    // - requirements only in the requirements field; "תיאור-"/"דרישות-" labels dropped
    var JOB_NO = /משרה\s*(\d{3})/, TRACK = /^משרה\s*(\d{3})\s*-?\s*(.+)$/, LEAD = /^משרה\s*\d{3}/;
    var NBSP = String.fromCharCode(160);

    // LRN-SETUP §7 — keep block line breaks
    function structuredText(el) {
      var c = el.cloneNode(true);
      Array.prototype.forEach.call(c.querySelectorAll('p,div,li,br,h1,h2,h3,h4,tr'), function (e) { e.insertAdjacentText('afterend', '\n'); });
      return c.textContent.split(NBSP).join(' ').replace(/[ \t]{2,}/g, ' ');
    }
    function lines(s) { return s.split('\n').map(function (l) { return l.trim(); }).filter(Boolean); }
    function splitTitle(s) { var p = s.split(/\s+-\s+/); return { title: p.shift().trim(), rest: p.join(' - ').trim() }; }

    var cells = Array.prototype.filter.call(document.querySelectorAll('td'), function (td) {
      return JOB_NO.test(td.textContent) && /-{20,}/.test(td.textContent);
    });
    var cell = cells.filter(function (a) { return !cells.some(function (b) { return b !== a && a.contains(b); }); })[0];
    if (!cell) return;

    var SEP = '\n@@JOB@@\n', clone = cell.cloneNode(true);
    Array.prototype.forEach.call(clone.querySelectorAll('u'), function (u) {
      if (JOB_NO.test(u.textContent)) u.insertAdjacentText('beforebegin', SEP);
    });
    var text = structuredText(clone).replace(/\n[ \t]*-{10,}[ \t]*(?=\n|$)/g, SEP);
    var em = /[\w.+-]+@heara\.co\.il/i.exec(text);
    var EMAIL = em ? em[0] : 'jobs@heara.co.il';

    // Closing section: from "הכשרות -" up to (not including) the how-to-apply lines
    // ("חושב שמתאים...?" / the line with the email). Those, and the links row under
    // the cell, are not job content; the email instruction goes to applicationInfo.
    var all = lines(text.replace(/@@JOB@@/g, '')), common = [], NOTE = '';
    for (var k = 0; k < all.length; k++) {
      if (!/^הכשרות\s*-/.test(all[k])) continue;
      for (var e = k; e < all.length && !/^חושב שמתאים/.test(all[e]) && all[e].indexOf(EMAIL) < 0; e++) common.push(all[e]);
      break;
    }
    for (var n = 0; n < all.length; n++) {
      var at = all[n].indexOf(EMAIL);
      // "של מייל ל jobs@heara.co.il בציון מספר משרה,פירוט זיקה מקצועית והדרכה."
      if (at >= 0 && /מספר משרה/.test(all[n])) { NOTE = all[n].slice(at + EMAIL.length).trim(); break; }
    }
    var COMMON = common.join('\n');

    var jobs = [], groups = [], seen = {};
    text.split('@@JOB@@').forEach(function (block) {
      var ls = lines(block);
      if (!ls.length) return;
      var head = ls[0], m = JOB_NO.exec(head);
      if (!m || /לא\s*זמין/.test(head)) return;
      var body = ls.slice(1), tracks = body.filter(function (l) { return TRACK.test(l); });
      if (!LEAD.test(head) && tracks.length >= 2) {
        groups.push({ shared: body.filter(function (l) { return !TRACK.test(l); }), tracks: tracks });
        return;
      }
      var t = LEAD.test(head)
        ? splitTitle(head.replace(/^משרה\s*\d{3}\s*-?\s*/, ''))            // "משרה 107- title - lead"
        : { title: head.replace(/\s*-?\s*משרה\s*\d{3}.*$/, '').trim(), rest: '' };
      if (t.title && !seen[m[1]]) { seen[m[1]] = 1; jobs.push({ no: m[1], title: t.title, lines: [t.rest].concat(body) }); }
    });
    groups.forEach(function (g) {
      g.tracks.forEach(function (l) {
        var tm = TRACK.exec(l);
        if (seen[tm[1]]) return;
        var t = splitTitle(tm[2]);
        if (!t.title) return;
        var field = t.title.replace(/^(מדריך|מדריכים|מדריכה|מדריך\/ה)\s+/, '');   // final kaf ך
        seen[tm[1]] = 1;
        jobs.push({ no: tm[1], title: t.title, lines: [t.rest].concat(g.shared.map(function (s) {
          return /בתחום\s*:\s*$/.test(s) ? s + ' ' + field : s;             // "בתחום:" introduced the track list
        })) });
      });
    });

    var root = document.createElement('div');
    root.id = 'haide-jobs-root';
    root.style.display = 'none';
    function mk(cls, val) { var e = document.createElement('div'); e.className = cls; e.textContent = val; return e; }

    jobs.forEach(function (j) {
      var src = j.lines.filter(Boolean), own = src.join('\n');
      if (own.length < 40) return;
      var req = [], desc = [];
      src.forEach(function (l) {
        if (!/^דרישות\s*-/.test(l)) return desc.push(l.replace(/^תיאור\s*-\s*/, ''));
        var r = l.replace(/^דרישות\s*-\s*/, ''), cut = r.search(/\s+שכר\s/);
        if (cut < 0) cut = r.length;
        if (!r.slice(0, cut).trim()) return desc.push(l);            // bare label: nothing to move
        req.push(r.slice(0, cut).trim());
        if (r.slice(cut).trim()) desc.push(r.slice(cut).trim());     // pay sentence is not a requirement
      });
      // location verbatim from city.csv, only what the job text establishes
      var loc = /קדימה/.test(own) ? 'קדימה צורן'
        : /בכל (רחבי )?הארץ|קייטנ|בתי ספר|חטיבות ביניים/.test(own) ? 'פריסה ארצית' : 'Unknown';
      // "בציון מספר משרה,פירוט..." -> "בציון מספר משרה 101, פירוט..."
      var note = NOTE.replace(/מספר משרה\s*,?\s*/, 'מספר משרה ' + j.no + ', ');

      var job = document.createElement('div');
      job.setAttribute('data-haide-job', '1');
      job.appendChild(mk('__ai-title', j.title));
      var idEl = mk('', 'heara-' + j.no);
      idEl.setAttribute('data-haide-job-id', '1');
      job.appendChild(idEl);
      job.appendChild(mk('__ai-description', desc.join('\n') + (COMMON ? '\n\n' + COMMON : '')));
      if (req.length) job.appendChild(mk('__ai-requirements', req.join('\n')));
      job.appendChild(mk('__ai-location', loc));
      job.appendChild(mk('__ai-apply-email', 'mailto:' + EMAIL + (note ? ' - ' + note : '')));
      root.appendChild(job);
    });
    document.body.appendChild(root);
  } catch (e) { }
})();
