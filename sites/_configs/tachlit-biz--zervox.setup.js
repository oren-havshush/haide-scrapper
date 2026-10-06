await (async function () {
  if (document.getElementById('haide-jobs-root') || !/\/דרושים\/?$/.test(decodeURIComponent(location.pathname))) return;
  // tachlit.biz/דרושים: Elementor posts grid, one article.elementor-post per job; body, date and the
  // per-job CV form live on the job page, fetched here (LRN-SETUP-2).
  // id: the job page's printed "מספר משרה N" -> tachlit-N (the 193 job's card title says "(195)";
  // the page body and URL say 193); no number -> tachlit-haideHash(decoded Hebrew slug) (LRN-ID-6).
  // Title = card title without a leading "(N)" number (rule 7).
  // "התפקיד כולל" -> description, "דרישות התפקיד" -> requirements, labels dropped; the
  // equal-opportunity line stays in the description; the "מספר משרה N" line is dropped.
  // Location: "משרת שטח" -> Unknown; else the ad's own "משרדי החברה ב<place>" mapped to city.csv; else Unknown.
  var hash = function (s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); };
  var get = function (u) { return fetch(u, { credentials: 'omit' }).then(function (r) { return r.ok ? r.text() : ''; }).catch(function () { return ''; }); };
  var NBSP = String.fromCharCode(160);
  var lines = function (el) {
    var c = el.cloneNode(true);
    Array.prototype.forEach.call(c.querySelectorAll('p,div,li,br,h1,h2,h3,h4,tr'), function (e) { e.insertAdjacentText('afterend', '\n'); });
    return c.textContent.split(NBSP).join(' ').split('\n').map(function (l) { return l.replace(/[ \t]{2,}/g, ' ').trim(); }).filter(Boolean);
  };
  var KEEP = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, OTHER = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
  var DESC_H = /^(התפקיד כולל|תי?אור (ה)?(תפקיד|משרה))\s*:?$/, REQ_H = /^(דרישות|כישורים)( (ה)?(תפקיד|משרה))?\s*:?$/;
  var NUM_LINE = /^מספר משרה\s*:?\s*(\d+)\s*$/;
  var EQUAL = /לנשים\s+ו?ל?גברים|לשני\s+הקהלים/;
  var PLACES = { 'נס ציונה': 'נס ציונה' };
  var locate = function (text) {
    if (/משרת\s+שטח/.test(text)) return 'Unknown';
    var m = /משרדי\s+החברה\s+ב([^,.\n]+)/.exec(text);
    return m && PLACES[m[1].trim()] ? PLACES[m[1].trim()] : 'Unknown';
  };
  var cards = [], seen = {};
  Array.prototype.forEach.call(document.querySelectorAll('article.elementor-post'), function (a) {
    var link = a.querySelector('.elementor-post__title a');
    if (!link || seen[link.href]) return;
    seen[link.href] = 1;
    cards.push({ href: link.href, raw: (link.textContent || '').split(NBSP).join(' ').replace(/\s+/g, ' ').trim() });
  });
  var root = document.createElement('div');
  root.id = 'haide-jobs-root';
  root.style.display = 'none';
  var mk = function (cls, val) { var e = document.createElement('div'); e.className = cls; e.textContent = val; return e; };
  var pages = await Promise.all(cards.map(function (c) { return get(c.href); }));
  cards.forEach(function (c, k) {
    var title = c.raw.replace(/^\(\s*\d+\s*\)\s*/, '').trim();
    if (!title || !KEEP.test(title) || OTHER.test(title)) return;
    var d = new DOMParser().parseFromString(pages[k] || '', 'text/html');
    var ws = Array.prototype.filter.call(d.querySelectorAll('.elementor-widget-text-editor'), function (w) { return !w.closest('footer, header, .elementor-location-footer, .elementor-location-header'); });
    ws.sort(function (x, y) { return y.textContent.length - x.textContent.length; });
    var desc = [], req = [], sec = 'desc', num = '';
    if (ws[0]) lines(ws[0]).forEach(function (l) {
      var n = NUM_LINE.exec(l);
      if (n) { num = n[1]; return; }
      if (DESC_H.test(l)) { sec = 'desc'; return; }
      if (REQ_H.test(l)) { sec = 'req'; return; }
      if (EQUAL.test(l)) { desc.push(l); return; }
      (sec === 'req' ? req : desc).push(l);
    });
    if (!num) { var t = /^\(\s*(\d+)\s*\)/.exec(c.raw); if (t) num = t[1]; }
    var slug = decodeURIComponent(c.href.replace(/\/+$/, '').split('/').pop() || '');
    var id = num ? 'tachlit-' + num : 'tachlit-' + hash(slug);
    var pub = d.querySelector('meta[property="article:published_time"]');
    var job = document.createElement('div');
    job.setAttribute('data-haide-job', '1');
    job.appendChild(mk('__ai-title', title));
    var idEl = mk('', id);
    idEl.setAttribute('data-haide-job-id', '1');
    job.appendChild(idEl);
    job.appendChild(mk('__ai-description', desc.join('\n')));
    if (req.length) job.appendChild(mk('__ai-requirements', req.join('\n')));
    job.appendChild(mk('__ai-location', locate(desc.join('\n'))));
    if (pub && /^\d{4}-\d{2}-\d{2}/.test(pub.getAttribute('content') || '')) job.appendChild(mk('__ai-publishdate', pub.getAttribute('content')));
    var a = document.createElement('a');
    a.className = '__ai-detail';
    a.href = c.href;
    job.appendChild(a);
    root.appendChild(job);
  });
  document.body.appendChild(root);
})();
