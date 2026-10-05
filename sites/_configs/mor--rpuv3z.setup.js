// mor.org.il/career: listing of .hotsets_group links; every field lives on the job page (server-rendered,
// labeled .hotseat_info_group blocks), fetched here same-origin and injected into the listing row (LRN-SETUP-2).
// Id: printed "מספר משרה" -> mor-N; a number shared by different jobs (1338, plus any new clash on the page) gets
// mor-N-haideHash(decoded slug) on every job carrying it, as shapir (owner, 2026-10-05). No number -> mor-<ASCII slug>
// or mor-haideHash(Hebrew slug).
// Location set manually (owner, 2026-10-05): closed table of the page's own "אזור העבודה" values; a nationwide
// phrase -> פריסה ארצית; anything else, or empty -> Unknown.
// Apply: email as printed (jobs.mor@adamtotal.co.il) + the ad's "בציון מספר משרה" with the job's number.
// Empty description / requirements ship empty (owner).
if (!document.querySelector('.__ai-done')) {
  var NBSP = String.fromCharCode(160);
  var PINNED = { '1338': 1 };
  var LOCS = {
    'לניאדו נתניה, באר שבע': 'נתניה, באר שבע',
    'רחבי הארץ': 'פריסה ארצית',
    'המרכז': 'אזור מרכז',
    '- מרפאות מטיילים ברחבי הארץ (מומחיות ברפואת משפחה, בריאות הציבור, פנימית)': 'פריסה ארצית',
    'אפשרות לעבודה באחד מבין 8 סניפי מור או בעבודה היברידית.': 'פריסה ארצית'
  };
  var haideHash = function (s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); };
  var clean = function (s) { return (s || '').split(NBSP).join(' ').replace(/[ \t]+/g, ' ').trim(); };
  var lines = function (el) {
    var c = el.cloneNode(true);
    c.querySelectorAll('p,div,li,br').forEach(function (e) { e.insertAdjacentText('afterend', '\n'); });
    return c.textContent.split('\n').map(clean).filter(Boolean).join('\n');
  };
  var rows = Array.prototype.slice.call(document.querySelectorAll('.hotsets_group'));
  var jobs = [];
  for (var i = 0; i < rows.length; i++) {
    var a = rows[i].querySelector('a.hotsets_link');
    if (!a) continue;
    var url = new URL(a.getAttribute('href'), location.href).href;
    var html = '';
    try { var res = await fetch(url, { credentials: 'same-origin' }); if (res.ok) html = await res.text(); } catch (e) { html = ''; }
    if (!html) continue;
    var d = new DOMParser().parseFromString(html, 'text/html');
    var g = {};
    d.querySelectorAll('.hotseat_info_group').forEach(function (b) {
      var t = b.querySelector('.hotseat_info_group_title');
      var v = t && t.nextElementSibling;
      if (t && v) g[clean(t.textContent)] = lines(v);
    });
    var h4 = d.querySelector('h4.hotseats_title');
    var title = clean(h4 ? h4.textContent : a.textContent);
    if (!/(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u.test(title) || /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u.test(title)) continue;
    var slug = '';
    try { slug = decodeURIComponent(new URL(url).pathname).replace(/\/+$/, '').split('/').pop(); } catch (e) { slug = ''; }
    var link = d.querySelector('a.hotseat_contact_link');
    var lt = clean(link ? link.textContent : '');
    var em = /[\w.+-]+@[\w-]+(\.[\w-]+)+/.exec(lt);
    jobs.push({ row: rows[i], title: title, no: (/^\d{3,6}$/.test(g['מספר משרה'] || '') ? g['מספר משרה'] : ''), slug: slug, g: g,
      email: em ? em[0] : '', note: em ? clean(lt.slice(em.index + em[0].length)).replace(/[\s.]+$/, '') : '' });
  }
  var count = {};
  jobs.forEach(function (j) { if (j.no) count[j.no] = (count[j.no] || 0) + 1; });
  jobs.forEach(function (j) {
    var id;
    if (j.no) id = 'mor-' + j.no + ((PINNED[j.no] || count[j.no] > 1) && j.slug ? '-' + haideHash(j.slug) : '');
    else if (/^[a-z0-9-]+$/i.test(j.slug)) id = 'mor-' + j.slug.toLowerCase();
    else id = 'mor-' + haideHash(j.slug || j.title);
    var raw = (j.g['אזור העבודה'] || '').replace(/\s*\n\s*/g, ' ');
    var loc = LOCS[raw] || (/(בכל|ברחבי|רחבי|כל)\s+הארץ/.test(raw) ? 'פריסה ארצית' : 'Unknown');
    var app = '';
    if (j.email) {
      var note = j.note;
      if (j.no && /מספר\s+משרה/.test(note)) note = note.replace(/מספר\s+משרה/, 'מספר משרה ' + j.no);
      app = 'mailto:' + j.email + (note ? ' - ' + note : '');
    }
    var add = function (cls, v) { if (!v) return; var s = document.createElement('span'); s.className = cls; s.style.display = 'none'; s.textContent = v; j.row.appendChild(s); };
    add('__ai-title', j.title);
    add('__ai-id', id);
    add('__ai-location', loc);
    add('__ai-type', j.g['סוג המשרה']);
    add('__ai-description', j.g['תאור המשרה'] || j.g['תיאור המשרה']);
    add('__ai-requirements', j.g['דרישות']);
    add('__ai-apply', app);
  });
  var done = document.createElement('span'); done.className = '__ai-done'; done.style.display = 'none'; document.body.appendChild(done);
}
