try {
  if (document.querySelector('#haide-jobs-root')) return;
  // chayuta.com/career: SvelteKit accordion, one li.position__panels-item per job (h3 + .career-content).
  // No job number and no per-job URL -> h-haideHash(title) (budget/bina rule).
  // "תיאור התפקיד" -> description, "דרישות" -> requirements (labels dropped); intro lines stay in
  // the description; a headless requirement line moves (LRN-SETUP-18).
  // The "להגשת מועמדות שלחו קו״ח ל-<mail> <instruction>" line leaves the description:
  // applicationInfo = mailto:<the card's own address> - <instruction, as printed>.
  // Location only from the job's own "המשרה ממטה החברה ב<place>" line, mapped to city.csv; else Unknown.
  var ITEM = 'li.position__panels-item';
  var prev = -1, stable = 0;
  for (var t = 0; t < 40; t++) {
    var n = document.querySelectorAll(ITEM).length;
    if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
    prev = n;
    await new Promise(function (r) { setTimeout(r, 500); });
  }
  var NBSP = String.fromCharCode(160);
  var HE = 'א-ת';
  var haideHash = function (s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); };
  var lines = function (el) {
    var c = el.cloneNode(true);
    Array.prototype.forEach.call(c.querySelectorAll('p,div,li,br,h1,h2,h3,h4,tr'), function (e) { e.insertAdjacentText('afterend', '\n'); });
    return c.textContent.split(NBSP).join(' ').split('\n').map(function (l) { return l.replace(/[ \t]{2,}/g, ' ').trim(); }).filter(function (l) { return l && !/^[•·\-–\s]+$/.test(l); });
  };
  var KEEP = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, OTHER = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
  var DESC_H = /^תי?אור (ה)?(תפקיד|משרה)\s*:?$/, REQ_H = /^(דרישות|כישורים)( (ה)?(תפקיד|משרה))?\s*:?$/;
  var APPLY = /^להגשת מועמדות/;
  var REQ_WORD = new RegExp('^(ניסיון|נסיון|ידע|רישיון|רשיון|תעודה|תעודת|תואר|בעל|בעלת|בעל/ת|יכולת|יכולות|נכונות|זמינות|שליטה|הכרה|הכרת|היכרות|דובר|דוברת|עדיפות|נדרש|נדרשת|רצוי)(?![' + HE + '])');
  var isReq = function (l) {
    var s = l.replace(/^[^\p{L}\d]+/u, '');
    if (/\d:\d\d/.test(s) || /(^|\s)שכר(\s|$)/.test(s) || s.length > 150) return false;
    return /חובה|יתרון/.test(s) || REQ_WORD.test(s);
  };
  var PLACES = { 'פתח תקווה': 'פתח תקווה', 'פתח תקוה': 'פתח תקווה' };
  var locate = function (text) {
    var m = /המשרה\s+ממטה\s+החברה\s+ב-?([^,.\n]+)/.exec(text);
    if (!m) return 'Unknown';
    var place = m[1].replace(/\s+/g, ' ').trim();
    return PLACES[place] || 'Unknown';
  };
  var root = document.createElement('div');
  root.id = 'haide-jobs-root';
  root.style.display = 'none';
  var mk = function (cls, val) { var e = document.createElement('div'); e.className = cls; e.textContent = val; return e; };
  var seen = {};
  Array.prototype.forEach.call(document.querySelectorAll(ITEM), function (it) {
    var tEl = it.querySelector('h3');
    var title = tEl ? tEl.textContent.split(NBSP).join(' ').replace(/\s+/g, ' ').trim() : '';
    var body = it.querySelector('.career-content');
    if (!title || !body || !KEEP.test(title) || OTHER.test(title)) return;
    var id = 'h-' + haideHash(title);
    if (seen[id]) return;
    seen[id] = 1;
    var desc = [], req = [], sec = 'desc', instr = '';
    var a = body.querySelector('a[href^="mailto:"]');
    var mail = a ? a.getAttribute('href').replace(/^mailto:/i, '').split('?')[0].trim() : '';
    lines(body).forEach(function (l) {
      if (DESC_H.test(l)) { sec = 'desc'; return; }
      if (REQ_H.test(l)) { sec = 'req'; return; }
      if (APPLY.test(l)) {
        var at = mail ? l.indexOf(mail) : -1;
        if (at >= 0) instr = l.slice(at + mail.length).replace(/^[\s.,:;-]+/, '').trim();
        return;
      }
      if (sec === 'req' || isReq(l)) { if (req.indexOf(l) < 0) req.push(l); return; }
      desc.push(l);
    });
    var job = document.createElement('div');
    job.setAttribute('data-haide-job', '1');
    job.appendChild(mk('__ai-title', title));
    var idEl = mk('', id);
    idEl.setAttribute('data-haide-job-id', '1');
    job.appendChild(idEl);
    job.appendChild(mk('__ai-description', desc.join('\n')));
    if (req.length) job.appendChild(mk('__ai-requirements', req.join('\n')));
    job.appendChild(mk('__ai-location', locate(desc.join('\n'))));
    if (mail) job.appendChild(mk('__ai-apply-email', 'mailto:' + mail + (instr ? ' - ' + instr : '')));
    root.appendChild(job);
  });
  document.body.appendChild(root);
} catch (e) { }
