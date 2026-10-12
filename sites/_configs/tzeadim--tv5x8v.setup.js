// tzeadim.co.il/jobs/: 12 cards + a "טען עוד" button (admin-ajax tzadim_jobs_load, 12 per page). This script calls the
// same endpoint for every page and replaces the grid, then fetches each job page for its body, type, date and form.
// All-or-nothing (LRN-CO-4): any failed page or job page empties the grid -> empty_results, nothing deleted.
// externalJobId: an ASCII job address (/job/1810/, /job/2211-3/) -> tzeadim-<address>; WordPress keeps addresses unique.
// A Hebrew address gets no id and the worker hashes title|url (LRN-ID-6). The page's form job-id is NOT used: it repeats.
// Locations: card tags only, by the owner's tag rule (LRN-LOC-21). Apply: per-job copy of CF7 46653 (LRN-FORM-13).
var GRID = document.querySelector('.tzadim-grid[data-tzadim-grid="1"]');
if (GRID && !GRID.getAttribute('data-ai')) {
  GRID.setAttribute('data-ai', '1');
  var BAD = false, html = [];
  var NONCE = (window.TZADIM_JOBS && window.TZADIM_JOBS.nonce) || '';
  var post = function (p) {
    return fetch(location.origin + '/wp-admin/admin-ajax.php', { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
      body: 'action=tzadim_jobs_load&nonce=' + NONCE + '&page=' + p + '&per_page=12&tz_keyword=&tz_type=' })
      .then(function (r) { return r.json(); }).catch(function () { return null; });
  };
  for (var p = 1; p <= 40; p++) {
    var j = await post(p);
    if (!j || !j.success || !j.data) { BAD = true; console.warn('[tzeadim] page ' + p + ' failed'); break; }
    html.push(j.data.html || '');
    if (!j.data.has_more) break;
    if (p === 40) BAD = true;
  }
  var tmp = document.createElement('div');
  tmp.innerHTML = BAD ? '' : html.join('');
  var cards = [].slice.call(tmp.querySelectorAll('article.tzadim-card'));
  if (!cards.length) BAD = true;
  // owner tag rule 2026-10-12; a tag not in this table is dropped, never guessed
  var TAG = {};
  ('גוש דן=אזור מרכז;השפלה=אזור שפלה;השרון=אזור השרון;חיפה והקריות=חיפה|אזור צפון;צפון=אזור צפון;דרום=אזור דרום;' +
   'ירושלים יו"ש=ירושלים|אזור יהודה ושומרון').split(';').forEach(function (e) { var kv = e.split('='); TAG[kv[0]] = kv[1].split('|'); });
  var MATH = new RegExp('[' + String.fromCodePoint(0x1D400) + '-' + String.fromCodePoint(0x1D7FF) + ']', 'gu');
  var WS = new RegExp('[ \\t' + String.fromCharCode(160) + ']+', 'g');
  var lines = function (el) {
    var c = el.cloneNode(true);
    c.querySelectorAll('br').forEach(function (b) { b.replaceWith('\n'); });
    c.querySelectorAll('p, li, div, h1, h2, h3, h4, h5, h6').forEach(function (b) { b.append('\n'); });
    return c.textContent.split('\n').map(function (l) { return l.replace(WS, ' ').trim(); }).filter(Boolean);
  };
  var DATA = [];
  var queue = cards.map(function (c, i) { return i; });
  var one = async function (i) {
    var a = cards[i].querySelector('a.tzadim-link'), url = a ? new URL(a.getAttribute('href'), location.href).href : '';
    for (var t = 0; t < 3 && url; t++) {
      try {
        var r = await fetch(url, { credentials: 'same-origin' });
        if (!r.ok || r.redirected) continue;
        var h = await r.text(), d = new DOMParser().parseFromString(h, 'text/html');
        var body = d.querySelector('.single_job_listing .job_description');
        if (!body) continue;
        return { h: h, d: d, body: body };
      } catch (e) { }
    }
    return null;
  };
  var worker = async function () {
    while (queue.length && !BAD) {
      var i = queue.shift(), x = await one(i);
      if (!x) { BAD = true; console.warn('[tzeadim] job page failed: ' + i); return; }
      DATA[i] = x;
    }
  };
  if (!BAD) await Promise.all([1, 2, 3, 4, 5, 6].map(worker));
  GRID.querySelectorAll('article.tzadim-card').forEach(function (e) { e.remove(); });
  var ld = GRID.parentNode.querySelector('.tzadim-loadmore-wrap');
  if (ld) ld.remove();
  if (!BAD) cards.forEach(function (card, i) {
    var x = DATA[i];
    var add = function (c, v) { var e = document.createElement('div'); e.className = c; e.style.display = 'none'; e.textContent = v; card.appendChild(e); };
    var h3 = card.querySelector('h3.tzadim-title');
    var title = (h3 ? h3.textContent : '').replace(MATH, function (c) { return c.normalize('NFKC'); }).replace(/\s+/g, ' ').trim();
    if (!/(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u.test(title) || /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u.test(title)) return;
    if (h3) h3.textContent = title;
    var sl = /\/job\/([A-Za-z0-9-]+)\/?$/.exec(new URL(card.querySelector('a.tzadim-link').href).pathname);
    if (sl) add('__ai-externalJobId', 'tzeadim-' + sl[1].toLowerCase());
    var loc = [], lt = card.querySelector('.tzadim-locs');
    (lt ? lt.textContent.split('·') : []).forEach(function (g) { (TAG[g.trim()] || []).forEach(function (c) { if (loc.indexOf(c) < 0) loc.push(c); }); });
    add('__ai-location', loc.length ? loc.join(', ') : 'Unknown');
    // body: lines before the דרישות heading -> description, after it -> requirements; the heading itself is dropped
    var L = lines(x.body), k = -1;
    for (var n = 0; n < L.length; n++) if (/^דרישות\s*[:\-–]*\s*$/.test(L[n])) { k = n; break; }
    var desc = k < 0 ? L : L.slice(0, k), req = k < 0 ? [] : L.slice(k + 1);
    add('__ai-description', desc.join('\n'));
    if (req.length) add('__ai-requirements', req.join('\n'));
    x.d.querySelectorAll('.job_detail_container').forEach(function (c) {
      var im = c.querySelector('img'), v = c.querySelector('div');
      if (im && v && /job_type\.png$/.test(im.getAttribute('src') || '') && v.textContent.trim()) add('__ai-employmentType', v.textContent.trim());
    });
    var dp = /"datePublished":"(\d{4}-\d\d-\d\d)/.exec(x.h);
    if (dp) add('__ai-publishDate', dp[1]);
    // per-job form: the job page's own CF7 form; its script fills job-title and job-id, copied here as the page sets them
    var fm = x.d.querySelector('form.wpcf7-form');
    if (fm) {
      var jt = /input\[name="job-title"\]'\)\.val\("([^"]*)"\)/.exec(x.h), ji = /input\[name="job-id"\]'\)\.val\("([^"]*)"\)/.exec(x.h);
      var fields = [];
      fm.querySelectorAll('input, select, textarea').forEach(function (f) {
        var ft = (f.tagName === 'INPUT' ? (f.getAttribute('type') || 'text') : f.tagName.toLowerCase()).toLowerCase();
        if (/^(submit|button|reset|image)$/.test(ft) || !f.name) return;
        var lab = f.closest('label'), lt2 = lab ? lab.textContent.replace(/\s+/g, ' ').trim() : '';
        var fo = { name: f.name, label: lt2 || f.name, fieldType: ft, tagName: f.tagName,
          required: f.hasAttribute('required') || f.getAttribute('aria-required') === 'true' };
        if (f.name === 'job-title') fo.value = jt ? jt[1] : '';
        else if (f.name === 'job-id') fo.value = ji ? ji[1] : '';
        else if (ft === 'hidden') fo.value = f.getAttribute('value') || '';
        if (ft === 'file' && f.getAttribute('accept')) fo.accept = f.getAttribute('accept');
        fields.push(fo);
      });
      var act = new URL(fm.getAttribute('action') || card.querySelector('a.tzadim-link').href, card.querySelector('a.tzadim-link').href).href;
      var blob = JSON.stringify({ actionUrl: act, actionAttribute: act, formClass: fm.getAttribute('class') || '', formTag: 'form',
        method: (fm.getAttribute('method') || 'post').toUpperCase(), enctype: fm.getAttribute('enctype') || undefined, fields: fields });
      add('__ai-applicationInfo', blob);
      add('__ai-formData', blob);
    }
    GRID.appendChild(card);
  });
}
