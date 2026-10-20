// meptagon.com/he/קריירה (WordPress `job` CPT, Unlimited Elements post grid) + Niloos apply pages. Runs on both.
// Listing: the grid's cards; each job's own page (GET, no cookie, 20 s limit each, 4 at a time) gives the body,
// the WordPress post id, the post date and the Niloos apply link. ALL-OR-NOTHING: a fetch that fails, times out,
// redirects or answers non-2xx, a job page without its post id or text, or a card count that differs from the
// grid's own total builds no job at all. No id is emitted: no job number is printed anywhere, so the worker
// builds its own (owner 2026-10-20). The post id only keeps two cards sharing one vacancy apart (fragment below).
// Detail = the job's Niloos page: a closed vacancy ("Job information error" / IsJobFound:false) is marked
// unavailable, so no row is written; else the page URL (no fragment) is the apply link.
var put = function (host, cls, val) {
  var s = document.createElement('span'); s.className = cls + ' wp-exclude-emoji'; s.textContent = val; host.appendChild(s);
};
var NB = String.fromCharCode(160);
var WS = new RegExp('[ \\t' + NB + ']+', 'g');
var LANG_OK = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}]/u;
var LANG_BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var MATH = new RegExp('[' + String.fromCodePoint(0x1D400) + '-' + String.fromCodePoint(0x1D7FF) + ']', 'gu');
var get = async function (url) {
  var ac = new AbortController();
  var tm = setTimeout(function () { ac.abort(); }, 20000);
  try {
    var r = await fetch(url, { credentials: 'omit', cache: 'no-store', signal: ac.signal });
    if (!r.ok || r.redirected) return null;
    return await r.text();
  } catch (e) { return null; } finally { clearTimeout(tm); }
};
var dec = function (u) { try { return decodeURIComponent(new URL(u, location.href).pathname).replace(/\/+$/, '').toLowerCase(); } catch (e) { return ''; } };
var host = location.hostname.replace(/^www\./, '');

if (host === 'meptagon.com' && dec(location.href) === '/he/קריירה' && !document.getElementById('haide-meptagon')) {
  var T0 = Date.now();
  var GRID = '.uc_post_grid_style_one[querydata]';
  var prev = -1, stable = 0;
  for (var t = 0; t < 40; t++) {
    var n = document.querySelectorAll(GRID + ' .uc_post_grid_style_one_item').length;
    if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
    prev = n;
    await new Promise(function (r) { setTimeout(r, 250); });
  }
  var grid = document.querySelector(GRID);
  var qd = {};
  try { qd = JSON.parse(grid.getAttribute('querydata')); } catch (e) { }
  var cards = grid ? Array.prototype.map.call(grid.querySelectorAll('.uc_post_grid_style_one_item'), function (c) {
    var a = c.querySelector('.uc_post_title a[href]');
    return { tags: Array.prototype.map.call(c.querySelectorAll('.ue_tags_terms a'), function (x) { return x.textContent.replace(WS, ' ').trim(); }).filter(Boolean),
      title: ((c.querySelector('.ue_p_title') || {}).textContent || '').replace(WS, ' ').trim(),
      url: a ? new URL(a.getAttribute('href'), location.href).href : '' };
  }) : [];
  var fail = !cards.length || qd.num_pages !== 1 || qd.total_posts !== cards.length || cards.some(function (c) { return !c.url || !c.title; });
  if (fail) console.warn('[meptagon] listing failed: cards ' + cards.length + ', grid total ' + qd.total_posts + ', pages ' + qd.num_pages);
  // --- one job page -> its parts ---
  var LBL_D = /^תיאור (ה)?(תפקיד|משרה)\s*:?$/, LBL_R = /^דרישות (ה)?(משרה|תפקיד)\s*:?$/;
  var EEO = /^המשרה מיועדת ל(נשים וגברים|גברים ונשים) כאחד\.?$/;
  var lines = function (el) {
    var c = el.cloneNode(true);
    c.querySelectorAll('br').forEach(function (e) { e.replaceWith('\n'); });
    c.querySelectorAll('p, li, div, h1, h2, h3, h4, h5, h6, tr').forEach(function (e) { e.appendChild(document.createTextNode('\n')); });
    return (c.textContent || '').split('\n').map(function (l) { return l.replace(WS, ' ').trim(); }).filter(Boolean);
  };
  var parseJob = function (html, url) {
    var d = new DOMParser().parseFromString(html, 'text/html');
    var root = d.querySelector('[data-elementor-type="single-post"]');
    var pid = root && (/(?:^|\s)post-(\d+)(?:\s|$)/.exec(root.className) || [])[1];
    if (!root || !pid) return null;
    var o = { pid: pid, lead: [], D: [], R: [], niloos: '', date: '' };
    var sec = null;
    root.querySelectorAll('.elementor-widget').forEach(function (w) {
      var ty = (w.getAttribute('data-widget_type') || '').split('.')[0];
      var tx = lines(w);
      if (ty === 'theme-post-content') { o.lead = o.lead.concat(tx); return; }
      if (ty === 'icon-list' && tx.length === 1) { if (LBL_D.test(tx[0])) sec = 'D'; else if (LBL_R.test(tx[0])) sec = 'R'; return; }
      if (ty === 'text-editor' && sec) { o[sec] = o[sec].concat(tx); return; }
      if (ty === 'button') { var b = w.querySelector('a[href*="minisite."]'); if (b && !o.niloos) o.niloos = b.href; }
    });
    // date: the Yoast WebPage of THIS page; LRN-AGE-6 (a slug that does not name the title) leaves the job undated
    d.querySelectorAll('script[type="application/ld+json"]').forEach(function (s) {
      try {
        (JSON.parse(s.textContent)['@graph'] || []).forEach(function (g) {
          if (g['@type'] === 'WebPage' && dec(g.url) === dec(url) && /^\d{4}-\d\d-\d\d/.test(g.datePublished || '')) o.date = g.datePublished;
        });
      } catch (e) { }
    });
    return o;
  };
  var slugOf = function (s) { return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, ''); };
  var namesTitle = function (url, title) {
    var sl = dec(url).split('/').pop().replace(/-\d+$/, ''), ts = slugOf(title);
    return !!sl && !!ts && (sl.indexOf(ts) === 0 || ts.indexOf(sl) === 0);
  };
  // --- location: card tags, refined by a work-location line (four-case rule); labels go through locationMap ---
  var TAG = { 'קרית גת': ['c', 'דרום'], 'נתיבות': ['c', 'דרום'], 'מגדל העמק': ['c', 'צפון'], 'חיפה': ['c', 'צפון'], 'דרום': ['r', 'דרום'], 'מרכז': ['r', 'מרכז'] };
  var PL = [['קרית גת|קריית גת', 'קרית גת', 'דרום'], ['נתיבות', 'נתיבות', 'דרום'], ['מגדל העמק', 'מגדל העמק', 'צפון'], ['חיפה', 'חיפה', 'צפון']]
    .map(function (q) { return { re: new RegExp('(?:^|[^א-ת])(?:ב|ל)?(?:אזור\\s+)?(?:' + q[0] + ')(?![א-ת])'), label: q[1], reg: q[2] }; });
  var CUE = /(לעבודה|העבודה|עבודה|במפעל|למפעל|באתר|ממוקמ|מיקום)/, NOT = /(הגעה|הסעות|נסיעות|לקוח|מגורים)/;
  var place = function (tags, ls) {
    var hits = [];
    ls.forEach(function (l) { if (CUE.test(l) && !NOT.test(l)) PL.forEach(function (q) { if (q.re.test(l) && hits.indexOf(q) < 0) hits.push(q); }); });
    if (!tags.length) return hits.length ? hits.map(function (q) { return q.label; }) : [];
    var res = [], used = [];
    tags.forEach(function (tg) {
      var k = TAG[tg];
      if (k && k[0] === 'r') {
        var inside = hits.filter(function (q) { return q.reg === k[1]; });
        if (inside.length) inside.forEach(function (q) { used.push(q); if (res.indexOf(q.label) < 0) res.push(q.label); });
        else res.push(tg);
      } else { res.push(tg); hits.forEach(function (q) { if (q.label === tg) used.push(q); }); }
    });
    var extra = hits.filter(function (q) { return used.indexOf(q) < 0; });
    if (extra.length && used.some(function (q) { return tags.indexOf(q.label) >= 0; })) extra.forEach(function (q) { if (res.indexOf(q.label) < 0) res.push(q.label); });
    return res;
  };
  var jobs = [];
  for (var i = 0; !fail && i < cards.length; i += 4) {
    var part = await Promise.all(cards.slice(i, i + 4).map(async function (c) {
      var h = await get(c.url);
      return h === null ? null : parseJob(h, c.url);
    }));
    for (var k2 = 0; k2 < part.length; k2++) {
      var p = part[k2];
      if (!p || (!p.D.length && !p.R.length)) { fail = true; console.warn('[meptagon] job page failed: ' + cards[i + k2].url); break; }
      jobs.push([cards[i + k2], p]);
    }
  }
  if (fail) { console.warn('[meptagon] no jobs built (all-or-nothing)'); return; }
  var root = document.createElement('div');
  root.id = 'haide-meptagon';
  root.style.display = 'none';
  var dropped = [];
  jobs.forEach(function (jp) {
    var c = jp[0], p = jp[1];
    var title = c.title.replace(MATH, function (ch) { return ch.normalize('NFKC'); });
    if (!LANG_OK.test(title) || LANG_BAD.test(title)) { dropped.push(p.pid + ':lang'); return; }
    if (!p.niloos) { dropped.push(p.pid + ':noapply'); return; }
    var eeo = p.R.filter(function (l) { return EEO.test(l); });
    var req = p.R.filter(function (l) { return !EEO.test(l); });
    var desc = p.lead.concat(p.D, eeo);
    var it = document.createElement('div');
    it.className = 'haide-job';
    var a = document.createElement('a');
    a.className = 'haide-link'; a.href = c.url; a.textContent = title;
    it.appendChild(a);
    // the Niloos link carries the post id as a fragment so two cards sharing one vacancy stay two rows
    var nl = document.createElement('a');
    nl.className = '__ai-niloos'; nl.href = p.niloos.split('#')[0] + '#p' + p.pid;
    it.appendChild(nl);
    put(it, '__ai-location', place(c.tags, p.lead.concat(p.D)).join(' | '));
    if (desc.length) put(it, '__ai-description', desc.join('\n'));
    if (req.length) put(it, '__ai-requirements', req.join('\n'));
    if (p.date && namesTitle(c.url, title)) put(it, '__ai-publishDate', p.date);
    root.appendChild(it);
  });
  document.body.appendChild(root);
  console.log('[meptagon] cards ' + cards.length + ', jobs ' + root.children.length + ', dropped ' + dropped.join(' ') + ', ' + (Date.now() - T0) + ' ms');
} else if (/^minisite\./.test(location.hostname) && /^\/(vacancy|apply)\/[0-9a-f]+/i.test(location.pathname) && !document.getElementById('__ai-niloos')) {
  var txt = document.body.innerText || document.body.textContent || '';
  var dead = /Job information error|Failed to get vacancy information/i.test(txt);
  if (!dead) {
    var ac2 = new AbortController();
    var tm2 = setTimeout(function () { ac2.abort(); }, 20000);
    try {
      var cfg = window.__NUXT__ && window.__NUXT__.config && window.__NUXT__.config.public;
      var q = '?ShortlinkId=' + encodeURIComponent(location.pathname.split('/')[2]) + '&ShortlinkBaseUrl=' + encodeURIComponent((cfg && cfg.baseUrl) || 'https://minisite.hunter-edge.me');
      var vr = await fetch(((cfg && cfg.apiTransportRoute) || '/api/getVacancy') + q, { credentials: 'omit', signal: ac2.signal });
      var vj = vr.ok ? await vr.json() : null;
      if (vj && vj.data && vj.data.IsJobFound === false) dead = true;
    } catch (e) { } finally { clearTimeout(tm2); }
  }
  // the page must show the vacancy's apply button; a page with neither the button nor the error is not read as live
  if (!dead && !/Apply For this position|להגשת מועמדות/.test(txt)) dead = true;
  var nb = document.createElement('div'); nb.id = '__ai-niloos'; nb.style.display = 'none';
  if (dead) nb.setAttribute('data-haide-detail-unavailable', '1');
  else put(nb, '__ai-applyinfo', location.origin + location.pathname);
  document.body.appendChild(nb);
}
