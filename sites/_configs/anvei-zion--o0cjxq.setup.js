await (async function () {
  if (document.getElementById('haide-jobs-root') || !/^\/job\/?$/.test(location.pathname)) return;
  // anvei-zion.com/job: WordPress "job" CPT archive, one a.box.box-job card per job with the full body.
  // id: no printed number, Hebrew slug -> anvei-zion-haideHash(decoded slug) (LRN-ID-6).
  // "תיאור התפקיד"/"תאור תפקיד" -> description, "דרישות…" -> requirements, labels dropped; a headless
  // requirement line ("…- חובה", "נכונות…") moves; hours lines and the equal-opportunity line stay.
  // Location: one factory, the only address published (החרש 3 א.ת. דרומי אשקלון) -> אשקלון (LRN-LOC-1).
  // publishDate = WordPress post date (REST, matched by slug); the page shows none.
  var hash = function (s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); };
  var NBSP = String.fromCharCode(160);
  var HE = 'א-ת';
  var lines = function (el) {
    var c = el.cloneNode(true);
    Array.prototype.forEach.call(c.querySelectorAll('p,div,li,br,h1,h2,h3,h4,tr'), function (e) { e.insertAdjacentText('afterend', '\n'); });
    return c.textContent.split(NBSP).join(' ').split('\n').map(function (l) { return l.replace(/[ \t]{2,}/g, ' ').trim(); }).filter(Boolean);
  };
  var KEEP = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, OTHER = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
  var DESC_H = /^תי?אור (ה)?(תפקיד|משרה)\s*:?$/, REQ_H = /^(דרישות|כישורים)( (ל|ה)?(תפקיד|משרה))?\s*:?$/;
  var EQUAL = /לנשים\s+ו?ל?גברים|לגברים\s+ו?ל?נשים/;
  var REQ_WORD = new RegExp('^(ניסיון|נסיון|ידע|רישיון|רשיון|תעודה|תעודת|תואר|השכלה|בעל|בעלת|יכולת|יכולות|נכונות|זמינות|שליטה|הכרה|היכרות|דובר|עברית|אנגלית|חובה)(?![' + HE + '])');
  var isReq = function (l) {
    var s = l.replace(/^[^\p{L}\d]+/u, '');
    if (/\d:\d\d/.test(s) || /(^|\s)שכר(\s|$)/.test(s) || s.length > 150) return false;
    return /חובה|יתרון/.test(s) || REQ_WORD.test(s);
  };
  var dates = {};
  try {
    var res = await fetch('/wp-json/wp/v2/job?per_page=100&_fields=slug,date', { credentials: 'omit' });
    if (res.ok) (await res.json()).forEach(function (r) { if (r && r.slug && /^\d{4}-\d{2}-\d{2}/.test(r.date || '')) dates[decodeURIComponent(r.slug)] = r.date; });
  } catch (e) { }
  var root = document.createElement('div');
  root.id = 'haide-jobs-root';
  root.style.display = 'none';
  var mk = function (cls, val) { var e = document.createElement('div'); e.className = cls; e.textContent = val; return e; };
  var seen = {};
  Array.prototype.forEach.call(document.querySelectorAll('a.box.box-job'), function (a) {
    var tEl = a.querySelector('.title'), body = a.querySelector('.content');
    var title = tEl ? tEl.textContent.split(NBSP).join(' ').replace(/\s+/g, ' ').trim() : '';
    if (!title || !body || seen[a.href] || !KEEP.test(title) || OTHER.test(title)) return;
    seen[a.href] = 1;
    var slug = decodeURIComponent(a.href.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop() || '');
    var desc = [], req = [], sec = 'desc';
    lines(body).forEach(function (l) {
      if (DESC_H.test(l)) { sec = 'desc'; return; }
      if (REQ_H.test(l)) { sec = 'req'; return; }
      if (EQUAL.test(l)) { desc.push(l); return; }
      if (sec === 'req' || isReq(l)) { if (req.indexOf(l) < 0) req.push(l); return; }
      desc.push(l);
    });
    var job = document.createElement('div');
    job.setAttribute('data-haide-job', '1');
    job.appendChild(mk('__ai-title', title));
    var idEl = mk('', 'anvei-zion-' + hash(slug));
    idEl.setAttribute('data-haide-job-id', '1');
    job.appendChild(idEl);
    job.appendChild(mk('__ai-description', desc.join('\n')));
    if (req.length) job.appendChild(mk('__ai-requirements', req.join('\n')));
    job.appendChild(mk('__ai-location', 'אשקלון'));
    if (dates[slug]) job.appendChild(mk('__ai-publishdate', dates[slug]));
    var d = document.createElement('a');
    d.className = '__ai-detail';
    d.href = a.href;
    job.appendChild(d);
    root.appendChild(job);
  });
  document.body.appendChild(root);
})();
