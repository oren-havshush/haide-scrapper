(function () {
  try {
    if (document.querySelector('#haide-jobs-root')) return;
    // giantsafety.co.il/page/3 (Webuildit CMS, the jobs page gsil.co.il links to): every posting
    // is free text inside one .body-content, each opened by an underlined heading "N. title".
    // No fetch. Rules (addsite3 recipe setupScript §13, LRN-SETUP-16):
    // - "N." is the list position, not a job number: stripped from the title, never an id.
    //   No native id -> no externalJobId; the worker synthesises h-<hash>.
    // - blocks calling for subcontractors (קבלני משנה) or repair labs (מעבדות) are supplier
    //   requests, not jobs: left out.
    // - "תאור/תיאור התפקיד:" and "דרישות התפקיד:" labels dropped; their lines go to description /
    //   requirements. Under דרישות, a working-hours line (8:00-17:00 ביבנה) is the schedule and
    //   stays in description (LRN-SETUP-18). Any other label ("התנאים המוצאים:") is kept, in description.
    // - a block with no label: scope/terms lines (משרה מלאה/חלקית, משרת אם, תנאים, קידום, שכר)
    //   stay in description, the other lines are requirements.
    // - from the line carrying the apply email to the end is the shared closing: the email lines
    //   become applicationInfo (bare mailto, no instruction on what to write); the rest
    //   ("סודיות מלאה מובטחת.") is appended to every description.
    // - location: a work line in the job naming יבנה -> יבנה; else the single company city
    //   printed in the footer (LRN-LOC-20), unless the job hints at field work -> Unknown.
    var body = document.querySelector('.body-content');
    if (!body) return;
    var NBSP = String.fromCharCode(160);
    var HEAD = /^\s*(\d{1,2})\s*\.\s*(\S[\s\S]*)$/;
    var NOT_JOB = /קבלני\s+משנה|מעבדות/;
    var SEP = '@@HAIDEJOB@@';
    function norm(s) { return String(s || '').split(NBSP).join(' '); }
    var clone = body.cloneNode(true);
    Array.prototype.forEach.call(clone.querySelectorAll('.history-back'), function (a) { a.remove(); });  // "< לעמוד הקודם"
    Array.prototype.forEach.call(clone.querySelectorAll('u'), function (u) {
      if (HEAD.test(norm(u.textContent).trim())) u.insertAdjacentText('beforebegin', '\n' + SEP + '\n');
    });
    Array.prototype.forEach.call(clone.querySelectorAll('p,div,li,br,h1,h2,h3,h4,tr'), function (e) {
      e.insertAdjacentText('afterend', '\n');
    });
    var text = norm(clone.textContent);
    function lines(s) { return s.split('\n').map(function (l) { return l.replace(/[ \t]+/g, ' ').trim(); }).filter(Boolean); }

    var mail = body.querySelector('a[href^="mailto:"]');
    var EMAIL = mail ? mail.getAttribute('href').replace(/^mailto:/i, '').split('?')[0].trim() : '';
    if (!EMAIL) { var em = /[\w.+-]+@[\w-]+(\.[\w-]+)+/.exec(text); EMAIL = em ? em[0] : ''; }

    var blocks = text.split(SEP);
    blocks.shift();                                     // text before the first heading (image)
    if (!blocks.length) return;
    // shared closing: cut from the line with the email (in the last block) to the end
    var last = lines(blocks[blocks.length - 1]), at = -1;
    for (var i = 0; i < last.length; i++) { if (EMAIL && last[i].indexOf(EMAIL) >= 0) { at = i; break; } }
    var CLOSING = [];
    if (at >= 0) {
      CLOSING = last.slice(at + 1).filter(function (l) { return !/^פניות\s+טלפוניות/.test(l); });
      blocks[blocks.length - 1] = last.slice(0, at).join('\n');
    }

    // footer: "דרך הים 11 יבנה 81000 | ..." and "שירות לקוחות ומחסן: הירמוך 1 יבנה" - one city
    var fe = document.querySelector('.footer-section-1');
    var footer = fe ? norm(fe.textContent) : '';
    var COMPANY_CITY = /(^|\s)יבנה(\s|$|[.,|])/.test(footer) ? 'יבנה' : 'Unknown';
    var OK_SCRIPT = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}]/u;
    var BAD_SCRIPT = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;

    var root = document.createElement('div');
    root.id = 'haide-jobs-root';
    root.style.display = 'none';
    function mk(cls, val) { var e = document.createElement('div'); e.className = cls; e.textContent = val; return e; }

    blocks.forEach(function (b) {
      var ls = lines(b);
      if (!ls.length) return;
      var m = HEAD.exec(ls[0]);
      if (!m) return;
      var title = m[2].replace(/\s*:\s*$/, '').trim();
      if (!title || NOT_JOB.test(title)) return;
      if (!OK_SCRIPT.test(title) || BAD_SCRIPT.test(title)) return;
      var rest = ls.slice(1), desc = [], req = [], mode = 'none', labelled = false;
      rest.forEach(function (l) {
        if (/^(תאור|תיאור)\s+התפקיד\s*:?$/.test(l)) { mode = 'desc'; labelled = true; return; }
        if (/^דרישות(\s+התפקיד)?\s*:?$/.test(l)) { mode = 'req'; labelled = true; return; }
        if (/:$/.test(l) && l.length < 40) { mode = 'desc'; labelled = true; desc.push(l); return; }
        if (mode === 'req') { (/\d{1,2}:\d\d/.test(l) ? desc : req).push(l); return; }
        desc.push(l);
      });
      if (!labelled) {
        desc = []; req = [];
        rest.forEach(function (l) {
          (/משר(ה|ת)\s|למשרה|תנאים|קידום|שכר/.test(l) || l.length > 80 ? desc : req).push(l);
        });
      }
      var own = [title].concat(rest).join('\n');
      var loc = /(^|\s)ביבנה(\s|$|[.,])/.test(own) ? 'יבנה'
        : /בכל (רחבי )?הארץ|עבודת שטח|נסיעות בכל/.test(own) ? 'Unknown' : COMPANY_CITY;
      var job = document.createElement('div');
      job.setAttribute('data-haide-job', '1');
      job.appendChild(mk('__ai-title', title));
      job.appendChild(mk('__ai-description', desc.join('\n') + (CLOSING.length ? '\n\n' + CLOSING.join('\n') : '')));
      if (req.length) job.appendChild(mk('__ai-requirements', req.join('\n')));
      job.appendChild(mk('__ai-location', loc));
      if (EMAIL) job.appendChild(mk('__ai-apply-email', 'mailto:' + EMAIL));
      root.appendChild(job);
    });
    document.body.appendChild(root);
  } catch (e) { }
})();
