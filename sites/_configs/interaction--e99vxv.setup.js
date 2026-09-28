await (async function () {
  if (!/^\/careers\/?$/.test(location.pathname)) return;
  var ITEM = 'a.name-position-item';
  for (var t = 0; t < 20 && !document.querySelector(ITEM); t++) await new Promise(function (r) { setTimeout(r, 500); });
  var hash = function (s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); };
  var get = function (u) { return fetch(u, { credentials: 'omit' }).then(function (r) { return r.ok ? r.text() : ''; }).catch(function () { return ''; }); };
  var norm = function (u) { try { return decodeURIComponent(new URL(u, location.href).pathname).replace(/\/+$/, ''); } catch (e) { return ''; } };
  var MATH = new RegExp('[' + String.fromCodePoint(0x1D400) + '-' + String.fromCodePoint(0x1D7FF) + ']', 'gu');
  var LANG_OK = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, LANG_BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
  var GERSHAYIM = String.fromCharCode(0x5F4);
  var TLV = new RegExp('ב?ת[' + '"' + "'" + GERSHAYIM + ']א|תל[ -]אביב');
  var REQ_HEAD = /^מה נשמח שתביאו/;
  var NOT_REQ = /לנשים ולגברים|לגברים ולנשים/;

  // Publish dates: the page shows none; WP REST supplies them for the jobs the page lists.
  var dates = {};
  try {
    JSON.parse(await get('/wp-json/wp/v2/position?per_page=100&_fields=link,date') || '[]').forEach(function (p) { if (p.link && p.date) dates[norm(p.link)] = p.date.slice(0, 10); });
  } catch (e) {}

  var add = function (el, cls, text, href) { if (!text) return; var s = document.createElement(href ? 'a' : 'span'); s.className = cls; s.style.display = 'none'; s.textContent = text; if (href) s.setAttribute('href', href); el.appendChild(s); };
  var seen = {};
  var items = Array.prototype.slice.call(document.querySelectorAll(ITEM));
  await Promise.all(items.map(function (item) {
    if (item.querySelector('.__ai-jobid')) return null;
    var href = item.href, key = norm(href);
    if (!key || seen[key]) { item.remove(); return null; }
    seen[key] = 1;
    var tEl = item.querySelector('.name-ux-ui');
    var title = (tEl ? tEl.textContent : '').replace(/\s+/g, ' ').trim().replace(MATH, function (c) { return c.normalize('NFKC'); });
    if (!title || !LANG_OK.test(title) || LANG_BAD.test(title)) { item.remove(); return null; }
    var slug = key.split('/').pop();
    add(item, '__ai-title', title);
    add(item, '__ai-link', href, href);
    add(item, '__ai-jobid', 'interaction-' + (/^[A-Za-z0-9._~-]+$/.test(slug) ? slug : hash(slug)));
    add(item, '__ai-date', dates[key] || '');
    return get(href).then(function (html) {
      if (!html) return;
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var body = Array.prototype.slice.call(doc.querySelectorAll('.fmo-text')).filter(function (e) { return e.querySelector('ul'); })
        .sort(function (a, b) { return b.textContent.length - a.textContent.length; })[0];
      if (!body) return;
      var desc = [], req = [], inReq = false;
      var push = function (arr, s) { s = s.replace(/\s+/g, ' ').trim(); if (s) arr.push(s); };
      var gap = function () { if (desc.length && desc[desc.length - 1] !== '') desc.push(''); };
      Array.prototype.forEach.call(body.children, function (el) {
        var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text) return;
        if (el.tagName === 'UL' || el.tagName === 'OL') {
          el.querySelectorAll('li').forEach(function (li) {
            var s = '• ' + (li.textContent || '').replace(/\s+/g, ' ').trim();
            if (s === '• ') return;
            if (!inReq) push(desc, s); else if (NOT_REQ.test(s)) push(desc, s.slice(2)); else push(req, s);
          });
          return;
        }
        var bold = el.tagName === 'P' && el.querySelector('span[style*="bold"],strong,b') && text.length < 80 && /[?:]$/.test(text)
          && (el.querySelector('span[style*="bold"],strong,b').textContent || '').replace(/\s+/g, ' ').trim() === text;
        if (bold) { inReq = REQ_HEAD.test(text); gap(); return; }
        var c = el.cloneNode(true);
        c.querySelectorAll('br').forEach(function (b) { b.replaceWith('\n'); });
        c.textContent.split('\n').forEach(function (s) { push(desc, s); });
      });
      while (desc.length && desc[desc.length - 1] === '') desc.pop();
      add(item, '__ai-description', desc.join('\n'));
      add(item, '__ai-requirements', req.join('\n'));
      if (TLV.test(body.textContent || '')) add(item, '__ai-location', 'תל אביב-יפו');
    });
  }));
})();
