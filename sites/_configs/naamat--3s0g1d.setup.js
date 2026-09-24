(function () {
  try {
    var NBSP = String.fromCharCode(160);

    function haideHash(s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); }
    function isAscii(s) { for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); if (c < 32 || c > 126) return false; } return s.length > 0; }
    function clean(s) { return (s || '').split(NBSP).join(' ').replace(/[ \t]{2,}/g, ' ').trim(); }
    var BULLET = new RegExp('^[' + String.fromCharCode(45, 8211, 8212, 42, 8226, 9642) + ']\\s*');
    function toLines(s) { return String(s || '').split('\n').map(function (l) { return clean(clean(l).replace(BULLET, '')); }).filter(Boolean); }
    function structuredText(el) {
      if (!el) return '';
      var c = el.cloneNode(true);
      Array.prototype.forEach.call(c.querySelectorAll('p,div,li,br,h1,h2,h3,h4,h5,h6,tr'), function (e) { e.insertAdjacentText('afterend', '\n'); });
      return c.textContent.split(NBSP).join(' ').replace(/\n{3,}/g, '\n\n');
    }
    function block(cls) { return document.querySelector('.jobs-row.' + cls + ' .jobs-row-input'); }
    function add(host, attr, val) {
      if (!val || document.querySelector('[' + attr + ']')) return;
      var d = document.createElement('div');
      d.setAttribute(attr, '1');
      d.style.display = 'none';
      d.textContent = val;
      host.appendChild(d);
    }

    // ---- LISTING: externalJobId = naamat-<ascii slug> | naamat-<hash> ----
    var items = document.querySelectorAll('div.job-preview.clearfix');
    for (var n = 0; n < items.length; n++) {
      var item = items[n];
      if (item.querySelector('[data-haide-job-id]')) continue;
      var link = item.querySelector('.job-content h5 a,.job-content a');
      if (!link) continue;
      var slug = (link.href || '').replace(/.*\/job\//, '').replace(/\/$/, '');
      try { slug = decodeURIComponent(slug); } catch (e) { /* keep raw */ }
      slug = clean(slug);
      if (!slug) continue;
      var idEl = document.createElement('span');
      idEl.setAttribute('data-haide-job-id', '1');
      idEl.style.display = 'none';
      idEl.textContent = 'naamat-' + (isAscii(slug) ? slug : haideHash(slug));
      item.appendChild(idEl);
    }

    // ---- DETAIL ----
    if (document.querySelector('[data-haide-description]')) return;
    var descEl = block('position_description');
    var respEl = block('position_responsibilities');
    var qualEl = block('position_qualifications');
    var hoursEl = block('position_work_hours');
    var locEl = block('position_job_location');
    if (!descEl && !qualEl) return;

    // Not requirements, even inside the qualifications block: shift/schedule,
    // employment scope, and the both-genders notice (owner rule: hours/terms
    // stay in the description).
    var SHIFT = /משמר|\d{1,2}:\d{2}|שעות\s+העבודה/;
    var SCOPE = /משרה\s+(מלאה|חלקית)|אפשרות\s+למשרה|היקף\s+משרה/;
    var NOTICE = /לשני\s+המינים|מיועד\S*\s+לשני|בלשון\s+נקבה|בלשון\s+זכר/;

    // LRN-SETUP-18: a line with no heading is still a requirement. Contains
    // חובה/יתרון, or STARTS with one of these.
    var REQ_START = /^(ניסיון|נסיון|ידע|רישיון|רשיון|תעודה|תעודת|בעל|בעלת|יכולת|נכונות|זמינות|שליטה|הכרה|הכרת|מגורים|דובר|דוברת|עדיפות|נדרש|נדרשת|יוצא|יוצאי|רצוי|גישה|יחסי\s+אנוש|ראש\s+גדול|תואר|השכלה|\d+\s+שנות)/;
    var REQ_ANY = /חובה|יתרון/;
    // LRN-SETUP-18 "must stay": the role/intro line, working hours, pay, long lines.
    var STAY = /דרוש|שכר|תנאים\s*\+|^תנאים/;

    // Classify against a copy with leading non-letters removed: this employer
    // prefixes lines with emoji, which would break the ^-anchored REQ_START.
    // Only the test is stripped; the stored line keeps its original text.
    function bare(line) {
      var i = 0;
      while (i < line.length) {
        var c = line.charCodeAt(i);
        var letter = (c >= 0x05D0 && c <= 0x05EA) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57);
        if (letter) break;
        i++;
      }
      return line.slice(i);
    }
    function isRequirement(line) {
      if (line.length > 150) return false;
      if (STAY.test(line)) return false;
      if (SHIFT.test(line) || SCOPE.test(line) || NOTICE.test(line)) return false;
      return REQ_ANY.test(line) || REQ_START.test(bare(line));
    }

    var reqLines = [], descLines = [], tailLines = [];

    // Qualifications block: requirements by default; the non-requirements are
    // held back and appended AFTER the body, so the ad still opens on its intro.
    var ql = toLines(structuredText(qualEl));
    for (var a = 0; a < ql.length; a++) {
      if (SHIFT.test(ql[a]) || SCOPE.test(ql[a]) || NOTICE.test(ql[a])) tailLines.push(ql[a]);
      else reqLines.push(ql[a]);
    }

    // Description + responsibilities: description by default; rescue requirement
    // lines the employer filed in the wrong block.
    var body = toLines(structuredText(descEl)).concat(toLines(structuredText(respEl)));
    var rescued = [];
    for (var c2 = 0; c2 < body.length; c2++) {
      if (isRequirement(body[c2])) rescued.push(body[c2]);
      else descLines.push(body[c2]);
    }
    reqLines = rescued.concat(reqLines);

    var hoursTxt = toLines(structuredText(hoursEl));
    for (var h = 0; h < hoursTxt.length; h++) descLines.push(hoursTxt[h]);
    for (var t2 = 0; t2 < tailLines.length; t2++) descLines.push(tailLines[t2]);

    var host = document.body;
    add(host, 'data-haide-description', descLines.join('\n'));
    add(host, 'data-haide-requirements', reqLines.join('\n'));

    // Location: the page's own labelled field, else a nationwide title, else Unknown.
    var loc = clean(locEl ? locEl.textContent : '');
    if (!loc) {
      var t = clean((block('position_title') || {}).textContent || document.title || '');
      if (/בכל\s+הארץ/.test(t)) loc = 'פריסה ארצית';
    }
    if (!loc) loc = 'Unknown';
    add(host, 'data-haide-location', loc);
  } catch (e) {
    /* never throw inside the worker setupScript */
  }
})();
