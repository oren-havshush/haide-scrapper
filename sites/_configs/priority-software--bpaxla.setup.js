// priority-software.com/il/careers (WP CPT) + Niloos apply pages. Runs on both.
// Listing: all admin-ajax pages (load-more skips cards 10-12); Israeli tags only; body + Niloos link from the
// employer's own job page. Any failed fetch empties the grid (no partial set).
// Detail = the Niloos page: a closed vacancy (200 + IsJobFound:false from its own /api/getVacancy) is marked
// unavailable, so no row is written; else the page URL is the apply link.
var put = function (host, cls, val) {
  var s = document.createElement('span'); s.className = cls; s.style.display = 'none'; s.textContent = val; host.appendChild(s);
};
var HE_OR_LAT = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u;
var OTHER = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var CITY = { haifa: 'חיפה', roshhaayin: 'ראש העין', jerusalem: 'ירושלים', bneibrak: 'בני ברק' };
var path = location.pathname;

if (/(^|\.)priority-software\.com$/.test(location.hostname) && /^\/il\/careers\/?$/.test(path)) {
  var box = document.querySelector('.js-cpt-container');
  if (box && !box.hasAttribute('data-ai-pooled')) {
    box.setAttribute('data-ai-pooled', '1');
    var ok = true;
    var wipe = function () { box.querySelectorAll('.careers-card').forEach(function (c) { c.remove(); }); };
    var before = [].slice.call(box.querySelectorAll('.careers-card h3 a')).map(function (a) { return a.href; });
    var html = [], max = 1;
    for (var pg = 1; pg <= max && pg <= 10; pg++) {
      try {
        var fd = new FormData();
        fd.append('action', 'load_filter_cpt'); fd.append('page', String(pg)); fd.append('cat', 'all');
        fd.append('locations', 'all'); fd.append('cpt', 'careers');
        var r = await fetch('/wp-admin/admin-ajax.php', { method: 'POST', body: fd, credentials: 'same-origin' });
        var j = r.ok ? await r.json() : null;
        if (!j || !j.success || !j.data || !/careers-card/.test(j.data.cpt || '')) { ok = false; break; }
        if (pg === 1) max = parseInt(j.data.max_page, 10) || 1;
        html.push(j.data.cpt);
      } catch (e) { ok = false; break; }
    }
    var tmp = document.createElement('div');
    if (ok) tmp.innerHTML = html.join('');
    var hrefs = [].slice.call(tmp.querySelectorAll('.careers-card h3 a')).map(function (a) { return a.href; });
    if (!ok || before.some(function (h) { return hrefs.indexOf(h) < 0; })) ok = false;
    else { box.innerHTML = ''; tmp.querySelectorAll('.careers-card').forEach(function (c) { box.appendChild(c); }); }
    var lm = document.querySelector('.load-more-wrapper'); if (lm) lm.remove();
    var dates = {};
    try {
      var rr = await fetch('/il/wp-json/wp/v2/careers?per_page=100&_fields=link,date', { credentials: 'same-origin' });
      if (rr.ok) (await rr.json()).forEach(function (p) { if (p && p.link && /^\d{4}-\d\d-\d\d/.test(p.date || '')) dates[p.link] = p.date.slice(0, 10); });
    } catch (e) { }
    var REQ = /^(requirements|skills|qualifications|what we'?re looking for|relevant technologies)\b/i;
    var DESC = /^(why join us|what we offer|we offer|benefits)\b/i;
    var EEO = /open to all genders|equal opportunit/i;
    var txt = function (el) {
      var c = el.cloneNode(true);
      c.querySelectorAll('li').forEach(function (li) { if (!li.textContent.trim()) li.remove(); });
      c.querySelectorAll('p,div,ul,ol,li,br,h1,h2,h3,h4,h5,h6,tr,blockquote').forEach(function (e) { e.insertAdjacentText('afterend', '\n'); });
      return c.textContent.split('\n').map(function (l) { return l.trim(); }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    };
    var join = function (parts) { return parts.join('\n\n').replace(/(^|\n)([^\n]{1,60}[:?])\n\n/g, '$1$2\n'); };
    var cards = ok ? [].slice.call(box.querySelectorAll('.careers-card')) : [];
    for (var k = 0; k < cards.length && ok; k++) {
      var item = cards[k];
      var a = item.querySelector('h3 a[href]');
      var title = a ? a.textContent.trim() : '';
      var m = a ? /\/il\/careers\/([a-z0-9-]+)\/?$/.exec(a.getAttribute('href') || '') : null;
      if (!a || !m || !title || !HE_OR_LAT.test(title) || OTHER.test(title)) { item.remove(); continue; }
      var israeli = false, locs = [], dept = [];
      item.querySelectorAll('.careers-card__tag').forEach(function (t) {
        var x = t.textContent.trim();
        var im = /^Israel(?:[^A-Za-z]+([A-Za-z].*))?$/.exec(x);
        if (im) { israeli = true; if (im[1]) locs.push(CITY[im[1].toLowerCase().replace(/[^a-z]/g, '')] || '?'); }
        else if (!/^(USA|UK|United|Germany|India|Canada|Europe|Netherlands|Australia)/i.test(x)) dept.push(x);
      });
      if (!israeli) { item.remove(); continue; }
      // the employer's own job page: body, requirements, Niloos link
      var doc = null;
      try {
        var dr = await fetch(a.href, { credentials: 'same-origin' });
        if (dr.ok && !dr.redirected) doc = new DOMParser().parseFromString(await dr.text(), 'text/html');
      } catch (e) { }
      var body = doc && doc.querySelector('.page-content__careers');
      if (!body) { ok = false; break; }
      var ex = doc.querySelector('.single-careers__excerpt');
      var desc = [], req = [], into = desc, dropR = false, dropD = false;
      if (ex && ex.textContent.trim()) desc.push(ex.textContent.trim());
      [].slice.call(body.children).forEach(function (el) {
        var t = txt(el);
        if (!t) return;
        var isH = /^H\d$/.test(el.tagName);
        var isLabel = isH || (el.tagName === 'P' && t.length < 60 && /[:?]$/.test(t));
        if (isLabel && REQ.test(t)) { into = req; if (!dropR) { dropR = true; return; } }
        else if (isLabel && DESC.test(t)) into = desc;
        else if (isH) { into = desc; if (!dropD) { dropD = true; return; } }
        if (into === req && el.tagName === 'P' && EEO.test(t)) { desc.push(t); return; }
        into.push(t);
      });
      var good = locs.filter(function (c, i) { return c !== '?' && locs.indexOf(c) === i; });
      put(item, '__ai-location', locs.indexOf('?') >= 0 || !good.length ? 'Unknown' : good.join(', '));
      put(item, '__ai-jobid', 'priority-software-' + m[1]);
      if (dept.length) put(item, '__ai-department', dept.join(', '));
      var d = dates[a.href] || dates[a.href.replace(/\/?$/, '/')];
      if (d) put(item, '__ai-date', d);
      put(item, '__ai-description', join(desc));
      put(item, '__ai-requirements', join(req));
      var ap = doc.querySelector('a.single-careers__apply-btn[href]');
      if (ap) { var l = document.createElement('a'); l.className = '__ai-niloos'; l.style.display = 'none'; l.href = ap.getAttribute('href'); item.appendChild(l); }
    }
    if (!ok) wipe();
  }
} else if (/^minisite\./.test(location.hostname) && /^\/(vacancy|apply)\/[0-9a-f]+/i.test(path) && !document.getElementById('__ai-niloos')) {
  var dead = /Job information error|Failed to get vacancy information/i.test(document.body.innerText || '');
  try {
    var cfg = window.__NUXT__ && window.__NUXT__.config && window.__NUXT__.config.public;
    var q = '?ShortlinkId=' + encodeURIComponent(path.split('/')[2]) + '&ShortlinkBaseUrl=' + encodeURIComponent((cfg && cfg.baseUrl) || 'https://minisite.hunter-edge.me');
    var vr = await fetch(((cfg && cfg.apiTransportRoute) || '/api/getVacancy') + q, { credentials: 'same-origin' });
    var vj = vr.ok ? await vr.json() : null;
    if (vj && vj.data && vj.data.IsJobFound === false) dead = true;
  } catch (e) { }
  var nb = document.createElement('div'); nb.id = '__ai-niloos'; nb.style.display = 'none';
  if (dead) nb.setAttribute('data-haide-detail-unavailable', '1');
  else put(nb, '__ai-applyinfo', location.href);
  document.body.appendChild(nb);
}
