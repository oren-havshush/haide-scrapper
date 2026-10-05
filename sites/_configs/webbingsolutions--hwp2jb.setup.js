// webbingsolutions.com/careers/ — theme-rendered list of Comeet positions (.job cards).
// Israel-only scope (owner, 2026-10-05): a card is kept only when its own location tag says Israel.
// Body from the employer's detail page: DESCRIPTION + ABOUT WEBBING + WHAT WE OFFER -> description,
// REQUIREMENTS -> requirements. Id: webbing-<ASCII URL slug> (the slug is base64 of the Comeet uid).
await (async function () {
  if (!/^\/careers\/?$/.test(location.pathname)) return;
  var cards = document.querySelectorAll('.job');
  if (!cards.length || document.querySelector('.__ai-jobid')) return;
  var CITY = { 'petah tikva': 'פתח תקווה', 'petach tikva': 'פתח תקווה' };
  var NBSP = new RegExp(String.fromCharCode(160), 'g');
  var get = function (u) { return fetch(u, { credentials: 'omit' }).then(function (r) { return r.ok ? r.text() : ''; }).catch(function () { return ''; }); };
  var lines = function (el) {
    if (!el) return [];
    var c = el.cloneNode(true);
    c.querySelectorAll('script,style').forEach(function (n) { n.remove(); });
    c.querySelectorAll('br').forEach(function (n) { n.replaceWith('\n'); });
    c.querySelectorAll('p,li,div,h1,h2,h3,h4,h5,h6').forEach(function (n) { n.insertAdjacentText('afterend', '\n'); });
    return c.textContent.replace(NBSP, ' ').split('\n')
      .map(function (s) { return s.replace(/[ \t]+/g, ' ').trim(); })
      .filter(function (s) { return s.length > 0; });
  };
  var keep = [], dropped = 0;
  for (var i = 0; i < cards.length; i++) {
    var locEl = cards[i].querySelector('.location');
    var locText = locEl ? locEl.textContent.replace(/\s+/g, ' ').trim() : '';
    if (/,\s*Israel$/i.test(locText)) keep.push(cards[i]); else { cards[i].remove(); dropped++; }
  }
  console.info('[webbing] kept ' + keep.length + ' Israel cards, dropped ' + dropped);

  await Promise.all(keep.map(function (card) {
    var a = card.querySelector('a.btn[href*="/careers/"]');
    if (!a) return null;
    var href = a.href;
    return get(href).then(function (html) {
      var d = new DOMParser().parseFromString(html || '', 'text/html');
      var desc = [], reqs = [], inReq = false;
      var box = d.querySelector('.job-description');
      if (box) {
        for (var k = 0; k < box.children.length; k++) {
          var ch = box.children[k];
          if (ch.tagName === 'H3') { inReq = /^requirements$/i.test(ch.textContent.trim()); continue; }
          (inReq ? reqs : desc).push.apply(inReq ? reqs : desc, lines(ch));
        }
      }
      // ABOUT WEBBING / WHAT WE OFFER keep their own heading line, as the page prints them.
      ['.about-webbing', '.what-we-offer'].forEach(function (sel) { desc = desc.concat(lines(d.querySelector(sel))); });

      var title = (card.querySelector('h3') || {}).textContent || '';
      var place = card.querySelector('.location').textContent.replace(/\s+/g, ' ').trim().split(',')[0];
      var key = place.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
      var city = CITY[key] || '';
      if (!city) console.warn('[webbing] unmapped Israeli location "' + place + '" on ' + title);
      var slug = href.replace(/\/+$/, '').split('/').pop();
      var dep = card.querySelector('.category');

      var mk = function (cls, txt, isLink) {
        if (!txt) return;
        var s = document.createElement(isLink ? 'a' : 'span');
        s.className = cls; s.style.display = 'none';
        if (isLink) s.setAttribute('href', txt); else s.textContent = txt;
        card.appendChild(s);
      };
      mk('__ai-title', title.replace(/\s+/g, ' ').trim());
      mk('__ai-link', href, true);
      mk('__ai-description', desc.join('\n'));
      mk('__ai-requirements', reqs.join('\n'));
      mk('__ai-location', city);
      mk('__ai-department', dep ? dep.textContent.trim() : '');
      mk('__ai-jobid', 'webbing-' + slug);
    });
  }));
})();
