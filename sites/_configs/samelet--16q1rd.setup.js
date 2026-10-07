try {
  // samelet.com /samelet-career/: 14 .cv_item cards (title, an unlabeled code, place, link to
  // /?post_type=cvs&p=<post id>). The code repeats across jobs (1130, 1213 twice each), so the id is
  // samelet-<post id>. Each job page: .cv_top col (h3 label + duties) and .cv_bottom col (h3 label +
  // requirements, then sub-sections such as "על סביבת העבודה" / "פרטים נוספים" / "למה סמלת?").
  // A sub-section heading (a fully bold block) ends the requirements; it and its lines go to the
  // description. Apply = the page's own "שלח קורות חיים" mailto.
  var NBSP = String.fromCharCode(160);
  function txt(el) { return el ? el.textContent.split(NBSP).join(' ').replace(/\s+/g, ' ').trim() : ''; }
  function span(cls, val) { var e = document.createElement('span'); e.className = cls; e.style.display = 'none'; e.textContent = val; return e; }
  function isHeading(el) {
    if (/^H[1-6]$/.test(el.tagName)) return true;
    if (el.tagName !== 'P') return false;
    var t = txt(el); if (!t || t.length > 40) return false;
    var bold = Array.prototype.map.call(el.querySelectorAll('b,strong'), txt).join(' ').replace(/\s+/g, ' ').trim();
    return bold === t;
  }
  // Ordered blocks of one column: [{text, heading}] — headings, paragraphs and list items, no empties.
  function blocks(col) {
    var out = [];
    Array.prototype.forEach.call(col.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li'), function (el) {
      if (el.tagName === 'P' && el.closest('li')) return;
      if (el.tagName === 'LI' && el.querySelector('li')) return;
      var c = el.cloneNode(true);
      Array.prototype.forEach.call(c.querySelectorAll('br'), function (br) { br.replaceWith('\n'); });
      var ls = c.textContent.split(NBSP).join(' ').split('\n').map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
      var hd = ls.length === 1 && isHeading(el);
      ls.forEach(function (l) { out.push({ text: l, heading: hd }); });
    });
    return out;
  }
  var LABEL = /^(מה עושים בתפקיד|אחריות כללית|למה סמלת)\s*\??\s*:?$/;
  var PLACE = {
    'פתח תקווה': 'פתח תקווה', 'מרכז': 'אזור מרכז', 'ירושלים ודרום הארץ': 'אזור ירושלים, אזור דרום',
    'מרכז שירות פרמיום פ"ת': 'פתח תקווה', 'ת"א, חיפה, ירושלים, פ"ת': 'תל אביב-יפו, חיפה, ירושלים, פתח תקווה'
  };
  var cards = Array.prototype.slice.call(document.querySelectorAll('.cv_item'));
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    if (card.querySelector('.__ai-id')) continue;
    var a = card.querySelector('.cv_view a');
    var m = a ? /[?&]p=(\d+)/.exec(a.getAttribute('href') || '') : null;
    if (!m) continue;
    card.appendChild(span('__ai-id', 'samelet-' + m[1]));
    card.appendChild(span('__ai-location', PLACE[txt(card.querySelector('.cv_location'))] || 'Unknown'));
    var doc = null;
    try {
      var r = await fetch(a.href, { credentials: 'same-origin' });
      if (r.ok) doc = new DOMParser().parseFromString(await r.text(), 'text/html');
    } catch (e) { }
    if (!doc) continue;
    var ld = doc.querySelector('script.yoast-schema-graph');
    var dm = ld ? /"datePublished":"(\d{4}-\d{2}-\d{2})/.exec(ld.textContent) : null;
    if (dm) card.appendChild(span('__ai-date', dm[1]));
    var top = doc.querySelector('.cv_wrapper .cv_top > .col-sm-6');
    var bottom = doc.querySelector('.cv_wrapper .cv_bottom > .col-sm-6:last-child');
    var desc = [], req = [], tail = [];
    if (top) blocks(top).forEach(function (b, k) {
      if (b.heading && (k === 0 || LABEL.test(b.text))) return;
      if (LABEL.test(b.text)) return;
      desc.push(b.text);
    });
    if (bottom) {
      var inReq = true;
      blocks(bottom).forEach(function (b, k) {
        if (k === 0 && b.heading) return;
        if (b.heading) inReq = false;
        (inReq ? req : tail).push(b.text);
      });
    }
    card.appendChild(span('__ai-description', desc.concat(tail).join('\n')));
    if (req.length) card.appendChild(span('__ai-requirements', req.join('\n')));
    var mail = doc.querySelector('.cv_wrapper a.send_cv[href^="mailto:"]');
    if (mail) card.appendChild(span('__ai-apply', 'mailto:' + mail.getAttribute('href').replace(/^mailto:/i, '').split('?')[0].trim()));
  }
} catch (e) { }
