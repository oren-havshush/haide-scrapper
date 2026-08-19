const ITEMS = document.querySelectorAll('ul.comeet-positions-list > li');
if (ITEMS.length && !document.querySelector('.__ai-jobid')) {
  const CID = 'C7.009';
  const CITY = { 'rosh haayin': 'ראש העין', 'rosh ha ayin': 'ראש העין', 'roshhaayin': 'ראש העין' };
  const REQ = /^(requirements|required\b|desired\b|minimum\b|preferred\b|essential$|qualifications|key\s+qualifications|skills\s*(&|and)\s*experience|what\s+we.?d\s+love\s+to\s+see|who\s+you\s+are|what\s+you.?ll\s+bring|key\s+competencies|competencies)/i;

  function clean(t) {
    return String(t).replace(/ /g, ' ').replace(/[ \t]+/g, ' ')
      .replace(/^[·•●▪‣◦∙*–—-]+\s*/, '').trim();
  }
  function blockLines(root) {
    const c = root.cloneNode(true);
    c.querySelectorAll('style,script,noscript').forEach(function (n) { n.remove(); });
    c.querySelectorAll('br').forEach(function (n) { n.replaceWith('\n'); });
    const out = [];
    function push(t, li) { const v = clean(t); if (v) out.push({ t: v, li: li }); }
    const kids = c.children;
    for (let i = 0; i < kids.length; i++) {
      const el = kids[i];
      if (el.tagName === 'UL' || el.tagName === 'OL') {
        el.querySelectorAll('li').forEach(function (li) {
          String(li.textContent).split('\n').forEach(function (t) { push(t, true); });
        });
      } else {
        String(el.textContent).split('\n').forEach(function (t) { push(t, false); });
      }
    }
    if (!out.length) String(c.textContent).split('\n').forEach(function (t) { push(t, false); });
    return out;
  }
  function isHead(l) { return REQ.test(l.t) || (l.t.length <= 70 && /[::]\s*$/.test(l.t)); }
  function render(item, cls, lines) {
    if (!lines.length) return;
    const box = document.createElement('div');
    box.className = cls; box.style.display = 'none';
    let ul = null;
    lines.forEach(function (l) {
      if (l.li && !isHead(l)) {
        if (!ul) { ul = document.createElement('ul'); box.appendChild(ul); }
        const li = document.createElement('li'); li.textContent = l.t; ul.appendChild(li);
      } else {
        ul = null;
        const d = document.createElement('div'); d.textContent = l.t; box.appendChild(d);
      }
    });
    item.appendChild(box);
  }
  function span(item, cls, val) {
    if (!val) return;
    const s = document.createElement('span');
    s.className = cls; s.style.display = 'none'; s.textContent = val;
    item.appendChild(s);
  }

  const cand = [];
  for (let i = 0; i < ITEMS.length; i++) {
    const item = ITEMS[i];
    const a = item.querySelector('a.comeet-position');
    const href = a ? a.getAttribute('href') || '' : '';
    const m = href.match(/\/co\/([^/]+)\/([^/]+)\//);
    const title = clean((item.querySelector('.comeet-position-name') || {}).textContent || '');
    if (!m || !title) { item.remove(); continue; }
    cand.push({
      item: item, title: title, region: m[1].toLowerCase(), uid: m[2],
      url: 'https:' + href.replace(/^https?:/, '').replace(/[?#].*$/, '').replace(/\/+$/, '') + '/',
    });
  }
  const before = cand.length;

  await Promise.all(cand.map(async function (j) {
    try { j.html = await (await fetch(j.url, { credentials: 'omit' })).text(); } catch (e) { j.html = ''; }
    j.locality = (j.html.match(/"addressLocality"\s*:\s*"([^"]*)"/) || [])[1] || '';
    j.country = (j.html.match(/"addressCountry"[\s\S]{0,60}?"name"\s*:\s*"([^"]*)"/) || [])[1]
      || (j.html.match(/"addressCountry"\s*:\s*"([^"]*)"/) || [])[1] || '';
  }));

  const dropped = [];
  for (const j of cand) {
    // Israel-only board: this product lists Israeli vacancies. Keep a row only when
    // the site's own grouping says israel OR its JSON-LD says addressCountry IL.
    if (j.region !== 'israel' && j.country.toUpperCase() !== 'IL') {
      dropped.push(j.title + ' [' + j.region + ']');
      j.item.remove();
      continue;
    }
    span(j.item, '__ai-jobid', j.uid);
    span(j.item, '__ai-detailUrl', j.url);
    span(j.item, '__ai-apply', 'https://www.comeet.co/jobs/' + CID + '/' + j.uid + '/apply');
    span(j.item, '__ai-dept', clean(((j.item.querySelector('.comeet-position-meta') || {}).textContent || '').split('·')[0]));
    const key = j.locality.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
    if (CITY[key]) span(j.item, '__ai-loc', CITY[key]);
    else if (key) console.warn('[waterfall] unmapped Israeli locality "' + j.locality + '" on ' + j.title);
    const el = j.html ? new DOMParser().parseFromString(j.html, 'text/html').querySelector('.comeet-position-description') : null;
    if (!el) continue;
    let L = blockLines(el);
    if (L.length && L[0].t.replace(/\s*\([^)]*\)\s*$/, '').toLowerCase() === j.title.toLowerCase()) L = L.slice(1);
    let cut = -1;
    for (let i = 0; i < L.length; i++) { if (REQ.test(L[i].t)) { cut = i; break; } }
    render(j.item, '__ai-desc', cut < 0 ? L : L.slice(0, cut));
    render(j.item, '__ai-req', cut < 0 ? [] : L.slice(cut + 1));
  }
  console.info('[waterfall] items before -> after: ' + before + ' -> ' + (before - dropped.length)
    + (dropped.length ? ' (dropped ' + dropped.length + ' non-Israel: ' + dropped.join(', ') + ')' : ''));
}
