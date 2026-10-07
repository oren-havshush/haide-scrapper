try {
  // audiocodes.com/careers: Umbraco positions block fed by Comeet (company 85.004), 10 rows + "Load More...".
  // Global board -> keep only rows whose Comeet country is IL (LRN-SPA-16). Id = audiocodes-<ASCII position
  // segment of the Read More URL> (the Comeet UID without its dot). Detail body = <p><strong>Label</strong></p>
  // sections: Requirements(-class) -> requirements, the rest -> description. Apply = the page's Comeet iframe.
  var NBSP = String.fromCharCode(160), MID = String.fromCharCode(183);
  var ROW = '.positions-block .js-accordion';
  var PLACE = { 'Or Yehuda': 'אור יהודה' };
  function span(cls, val) { var e = document.createElement('span'); e.className = cls; e.style.display = 'none'; e.textContent = val; return e; }
  function clean(s) { return (s || '').split(NBSP).join(' ').replace(/\s+/g, ' ').trim(); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  if (!/\/careers\/positions\//.test(location.pathname)) {
    var prev = -1, stable = 0;
    for (var t = 0; t < 60; t++) {
      var n = document.querySelectorAll(ROW).length;
      if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
      prev = n; await sleep(500);
    }
    if (!document.querySelector(ROW) || document.querySelector('.__ai-done')) return;
    var printed = document.querySelector('.positions-block .info-text b');
    var total = printed ? parseInt(printed.textContent, 10) : NaN;
    for (var c = 0; c < 30; c++) {
      var btn = null;
      for (var w = 0; w < 20; w++) {
        btn = document.querySelector('.positions-load-more button.btn-more');
        if (btn && btn.offsetParent !== null) break;
        if (document.querySelectorAll(ROW).length >= total) break;
        await sleep(500);
      }
      if (!btn || btn.offsetParent === null) break;
      var before = document.querySelectorAll(ROW).length;
      btn.click();
      for (var g = 0; g < 30 && document.querySelectorAll(ROW).length <= before; g++) await sleep(500);
      if (document.querySelectorAll(ROW).length <= before) break;
    }
    var rows = document.querySelectorAll(ROW);
    // all-or-nothing: a load that stopped short publishes nothing rather than a partial set
    if (!isNaN(total) && rows.length < total) {
      Array.prototype.forEach.call(rows, function (r) { r.remove(); });
      document.body.appendChild(span('__ai-done', 'short ' + rows.length + '/' + total));
      return;
    }
    var OK = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u;
    var BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
    Array.prototype.forEach.call(rows, function (row) {
      if (row.querySelector('.__ai-id')) return;
      var ap = row.querySelector('a.btn-apply');
      var country = ap ? clean(ap.getAttribute('data-position-country')) : '';
      var locText = clean((row.querySelector('.accordion__head .location') || {}).textContent);
      var isIL = country ? /^(IL|Israel)$/i.test(country) : /(^|, )(Israel|IL)$/.test(locText);
      var title = clean((row.querySelector('h3.subtitle') || {}).textContent);
      if (!isIL || !title || !OK.test(title) || BAD.test(title)) { row.remove(); return; }
      var a = row.querySelector('.btn-holder a.btn:not(.btn-apply)');
      var m = a ? /\/careers\/positions\/([A-Za-z0-9-]+)\/?(?:[?#]|$)/.exec(a.getAttribute('href') || '') : null;
      if (m) row.appendChild(span('__ai-id', 'audiocodes-' + m[1]));
      var city = '';
      locText.split(',').forEach(function (p) { p = p.trim(); if (!city && Object.prototype.hasOwnProperty.call(PLACE, p)) city = PLACE[p]; });
      row.appendChild(span('__ai-location', city || 'Unknown'));
    });
    document.body.appendChild(span('__ai-done', 'ok'));
    return;
  }
  var shell = document.querySelector('.section__body .shell');
  if (!shell || document.querySelector('.__ai-description') || document.querySelector('.__ai-requirements')) return;
  function text(el) {
    var c = el.cloneNode(true);
    c.querySelectorAll('style,script').forEach(function (x) { x.remove(); });
    c.querySelectorAll('li').forEach(function (li) { li.insertAdjacentText('afterbegin', '- '); });
    c.querySelectorAll('p,div,li,br,h1,h2,h3,h4,h5,h6,tr').forEach(function (x) { x.insertAdjacentText('afterend', '\n'); });
    return c.textContent.split(NBSP).join(' ').split(String.fromCharCode(65279)).join('').split('\n').map(function (l) { return l.replace(/[ \t]+/g, ' ').trim(); })
      .filter(function (l) { return l && l.split(MID).join('').replace(/[-\s]/g, '') !== ''; }).join('\n');
  }
  var secs = [], cur = { label: '', parts: [] };
  Array.prototype.forEach.call(shell.children, function (el) {
    var strong = el.tagName === 'P' ? el.querySelector('strong,b') : null;
    var head = strong && clean(strong.textContent) === clean(el.textContent) ? clean(el.textContent) : '';
    if (head && !/:$/.test(head)) { secs.push(cur); cur = { label: head, parts: [] }; return; }
    var t = text(el); if (t) cur.parts.push(t);
  });
  secs.push(cur);
  var desc = [], req = [];
  secs.forEach(function (s) {
    var body = s.parts.join('\n').trim(); if (!body) return;
    var isReq = /^(requirements|qualifications|skills|advantages|nice to have)\b/i.test(s.label);
    var restates = /^(description|job description|requirements|qualifications)$/i.test(s.label);
    (isReq ? req : desc).push(s.label && !restates ? s.label + '\n' + body : body);
  });
  if (desc.length) document.body.appendChild(span('__ai-description', desc.join('\n\n')));
  if (req.length) document.body.appendChild(span('__ai-requirements', req.join('\n\n')));
  Array.prototype.forEach.call(document.querySelectorAll('.list-info-alt li'), function (li) {
    var v = clean(li.textContent);
    if (!document.querySelector('.__ai-type') && /^(full|part)[- ]time$|^contract|^temporary|^internship$|^freelance$/i.test(v)) document.body.appendChild(span('__ai-type', v));
  });
  var ifr = null;
  for (var k = 0; k < 20 && !ifr; k++) {
    ifr = Array.prototype.map.call(document.querySelectorAll('iframe'), function (f) { return f.src || f.getAttribute('data-src') || ''; })
      .filter(function (s) { return /comeet\.co\/jobs\/[^/]+\/[^/]+\/apply/.test(s); })[0] || null;
    if (!ifr) await sleep(500);
  }
  if (ifr) document.body.appendChild(span('__ai-apply', ifr));
} catch (e) { }
