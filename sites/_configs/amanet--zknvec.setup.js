try {
  if (document.querySelector('#haide-jobs-root')) return;
  // amanet.co.il/career: JetEngine listing, one accordion card per job (.jet-listing-grid__item).
  // No job number and the card links to no job page -> h-haideHash(title) (budget/bina rule).
  // "תיאור התפקיד" label dropped; a requirement line moves to requirements, and a requirement
  // line ending in ":" carries the list after it (LRN-SETUP-18). The group company label on the
  // card (h4: AMAN / dialogue) is the department, as printed. No location is printed -> Unknown.
  // publishDate = WordPress post date of the card's post (REST), the page shows none.
  // applicationInfo = the card's own mailto (the page gives no instruction for the email).
  var ITEM = '.jet-listing-grid__item';
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
    return c.textContent.split(NBSP).join(' ').split('\n').map(function (l) { return l.replace(/[ \t]{2,}/g, ' ').trim(); }).filter(Boolean);
  };
  var KEEP = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, OTHER = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
  var DESC_H = /^תי?אור (ה)?(תפקיד|משרה)\s*:?$/, REQ_H = /^(דרישות|כישורים)( (ה)?(תפקיד|משרה))?\s*:?$/;
  var REQ_WORD = new RegExp('^(ניסיון|נסיון|ידע|רישיון|רשיון|תעודה|תעודת|תואר|בעל|בעלת|בעל/ת|יכולת|יכולות|נכונות|זמינות|שליטה|הכרה|הכרת|דובר|דוברת|עדיפות|נדרש|נדרשת|רצוי)(?![' + HE + '])');
  var isReq = function (l) {
    if (/\d:\d\d/.test(l) || /(^|\s)שכר(\s|$)/.test(l) || l.length > 150) return false;
    return /חובה|יתרון/.test(l) || REQ_WORD.test(l);
  };
  var dates = {};
  var ids = Array.prototype.map.call(document.querySelectorAll(ITEM + '[data-post-id]'), function (i) { return i.getAttribute('data-post-id'); }).filter(function (v) { return /^\d+$/.test(v); });
  if (ids.length) {
    try {
      var res = await fetch('/wp-json/wp/v2/job?per_page=100&_fields=id,date&include=' + ids.join(','), { credentials: 'omit' });
      if (res.ok) { (await res.json()).forEach(function (r) { if (r && r.id && /^\d{4}-\d{2}-\d{2}/.test(r.date || '')) dates[String(r.id)] = r.date; }); }
    } catch (e) { }
  }
  var root = document.createElement('div');
  root.id = 'haide-jobs-root';
  root.style.display = 'none';
  var mk = function (cls, val) { var e = document.createElement('div'); e.className = cls; e.textContent = val; return e; };
  var seen = {};
  Array.prototype.forEach.call(document.querySelectorAll(ITEM), function (it) {
    var tEl = it.querySelector('.jet-toggle__label-text');
    var title = tEl ? tEl.textContent.split(NBSP).join(' ').replace(/\s+/g, ' ').trim() : '';
    if (!title || !KEEP.test(title) || OTHER.test(title)) return;
    var id = 'h-' + haideHash(title);
    if (seen[id]) return;
    seen[id] = 1;
    var desc = [], req = [], sec = 'desc';
    Array.prototype.forEach.call(it.querySelectorAll('.elementor-widget-text-editor .elementor-widget-container'), function (block) {
      lines(block).forEach(function (l) {
        if (DESC_H.test(l)) { sec = 'desc'; return; }
        if (REQ_H.test(l)) { sec = 'req'; return; }
        if (sec === 'req' || isReq(l)) {
          if (req.indexOf(l) < 0) req.push(l);
          if (/:$/.test(l)) sec = 'req';
          return;
        }
        desc.push(l);
      });
    });
    var dEl = it.querySelector('h4.elementor-heading-title');
    var dept = dEl ? dEl.textContent.replace(/\s+/g, ' ').trim() : '';
    var a = it.querySelector('a[href^="mailto:"]');
    var mail = a ? a.getAttribute('href').replace(/^mailto:/i, '').split('?')[0].trim() : '';
    var job = document.createElement('div');
    job.setAttribute('data-haide-job', '1');
    job.appendChild(mk('__ai-title', title));
    var idEl = mk('', id);
    idEl.setAttribute('data-haide-job-id', '1');
    job.appendChild(idEl);
    job.appendChild(mk('__ai-description', desc.join('\n')));
    if (req.length) job.appendChild(mk('__ai-requirements', req.join('\n')));
    if (dept) job.appendChild(mk('__ai-department', dept));
    job.appendChild(mk('__ai-location', 'Unknown'));
    if (mail) job.appendChild(mk('__ai-apply-email', 'mailto:' + mail));
    var pid = it.getAttribute('data-post-id');
    if (pid && dates[pid]) job.appendChild(mk('__ai-publishdate', dates[pid]));
    root.appendChild(job);
  });
  document.body.appendChild(root);
} catch (e) { }
