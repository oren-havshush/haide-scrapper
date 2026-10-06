try {
  // gilar.co.il /משרות: WordPress page, one Bootstrap .accordion-item per job (h3 title, header spans
  // [employment type, place], .accordion-body). No job number, no per-job URL -> h-haideHash(title).
  // Body: "במסגרת התפקיד:" label dropped; lines after "דרישות התפקיד:" -> requirements; the
  // "קורות חיים ניתן לשלוח ל:" line leaves the description, its mailto -> applicationInfo.
  var NBSP = String.fromCharCode(160);
  function haideHash(s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); }
  function txt(el) { return el ? el.textContent.split(NBSP).join(' ').replace(/\s+/g, ' ').trim() : ''; }
  function lines(el) {
    var c = el.cloneNode(true);
    Array.prototype.forEach.call(c.querySelectorAll('p,div,li,br,h1,h2,h3,h4,h5,h6'), function (e) { e.insertAdjacentText('afterend', '\n'); });
    return c.textContent.split(NBSP).join(' ').split('\n').map(function (l) { return l.replace(/[ \t]{2,}/g, ' ').trim(); }).filter(Boolean);
  }
  function span(cls, val) { var e = document.createElement('span'); e.className = cls; e.style.display = 'none'; e.textContent = val; return e; }
  var PLACES = { 'שוהם': 'שוהם' };
  var DESC_H = /^במסגרת (ה)?תפקיד\s*:?$/, REQ_H = /^דרישות (ה)?תפקיד\s*:?$/, APPLY = /קורות חיים ניתן לשלוח|@/;
  Array.prototype.forEach.call(document.querySelectorAll('.accordion-item'), function (item) {
    if (item.querySelector('.__ai-id')) return;
    var title = txt(item.querySelector('.accordion-item-title'));
    var body = item.querySelector('.accordion-body');
    if (!title || !body) return;
    var info = item.querySelectorAll('.accordion-item-header-info');
    var desc = [], req = [], inReq = false;
    lines(body).forEach(function (l) {
      if (APPLY.test(l)) return;
      if (DESC_H.test(l)) { inReq = false; return; }
      if (REQ_H.test(l)) { inReq = true; return; }
      (inReq ? req : desc).push(l);
    });
    var mail = body.querySelector('a[href^="mailto:"]');
    item.appendChild(span('__ai-id', 'h-' + haideHash(title)));
    item.appendChild(span('__ai-description', desc.join('\n')));
    if (req.length) item.appendChild(span('__ai-requirements', req.join('\n')));
    item.appendChild(span('__ai-location', PLACES[txt(info[1])] || 'Unknown'));
    if (info[0]) item.appendChild(span('__ai-type', txt(info[0])));
    if (mail) item.appendChild(span('__ai-apply', 'mailto:' + mail.getAttribute('href').replace(/^mailto:/i, '').split('?')[0].trim()));
  });
} catch (e) { }
