// handasi.co.il "דרושים" (InterDeal CMS, HTTP only, windows-1255), listing-only: the worker visits no job page.
// Each listing card (article.index<ID>) shows the title and the short text; the rest of the ad is on its
// job page arcLookup.taf?_function=details&_ID=<n>. This script GETs each job page (credentials omit, no
// session cookie; 20 s limit per fetch; bytes decoded with the charset the server names, windows-1255) and
// builds one hidden div.__ai-job per card in #haide-handasi.
// ALL-OR-NOTHING: if any job page fails (network error, timeout, non-2xx, redirect, no title or no
// ad text), no row is built at all, so a partial set is never published.
// - no externalJobId: no job number is printed anywhere, so the script emits no id and the worker builds
//   h-<hash of title|url> (owner 2026-10-20, X1); the 3 job-page URLs differ, so no two jobs collide.
// - description: every text line of the job page's td.H3 cells (short text + ad body), as printed, minus
//   requirement lines and the how-to-apply lines; requirements: lines classified per LRN-SETUP-18.
// - applicationInfo: "mailto:<address>" from the ad's own mailto link; the ad gives no instruction for the
//   email, so the address is bare.
// - location: the places of the "מקום העבודה" line, split on " או " and commas, joined with " | " and read
//   through the config's locationMap; no such line -> empty (the map makes it Unknown; two offices, so no
//   single-city default, LRN-LOC-20).
var DASH = String.fromCharCode(8211);
var NBSP = String.fromCharCode(160);
var REQ_START = /^(ניסיון|נסיון|ידע|רישיון|רשיון|תעודה|תעודת|בעל|יכולת|נכונות|זמינות|שליטה|הכרה|הכרת|מגורים|דובר|עדיפות|נדרש|יוצא|רצוי|גישה|עם ידע|עם ניסיון|ראש גדול)/;
var REQ_ANY = /חובה|יתרון/;
var APPLY = /קורות\s*חיים|@/;
var PLACE = new RegExp('^מקום העבודה\\s*[:' + DASH + '-]\\s*(.+?)\\s*\\.?$');
var LANG_OK = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}]/u;
var LANG_BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var cards = Array.prototype.slice.call(document.querySelectorAll('article[class^="index"]'));
if (cards.length && !document.getElementById('haide-handasi')) {
  var get = async function (url) {
    var ac = new AbortController();
    var timer = setTimeout(function () { ac.abort(); }, 20000);
    try {
      var r = await fetch(url, { credentials: 'omit', redirect: 'follow', signal: ac.signal, cache: 'no-store' });
      if (!r.ok || r.redirected) throw new Error('status ' + r.status + (r.redirected ? ' redirected' : ''));
      var cs = /charset=([\w-]+)/i.exec(r.headers.get('content-type') || '');
      var buf = await r.arrayBuffer();
      return new TextDecoder(cs ? cs[1] : 'windows-1255').decode(buf);
    } finally { clearTimeout(timer); }
  };
  var lines = function (el) {
    var c = el.cloneNode(true);
    var bs = c.querySelectorAll('br,p,div,li,tr');
    for (var i = 0; i < bs.length; i++) bs[i].insertAdjacentText('afterend', '\n');
    return (c.textContent || '').split(NBSP).join(' ').split('\n').map(function (s) { return s.replace(/[ \t]+/g, ' ').trim(); }).filter(Boolean);
  };
  var jobs = [];
  try {
    jobs = await Promise.all(cards.map(async function (card) {
      var a = card.querySelector('a.productName');
      var href = a ? new URL(a.getAttribute('href'), location.href).href : '';
      var m = /[?&]_ID=(\d+)/i.exec(href);
      var title = a ? (a.textContent || '').replace(/\s+/g, ' ').trim() : '';
      if (!m || !title) throw new Error('card without link or title');
      var html = await get(href);
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var h1 = doc.querySelector('td.tdPageTitle h1');
      var body = doc.querySelector('table.desc-table td.H3');
      if (!h1 || !body || lines(body).length < 2) throw new Error('job page ' + m[1] + ' has no title or text');
      var all = [];
      var cells = doc.querySelectorAll('td.H3');
      for (var k = 0; k < cells.length; k++) all = all.concat(lines(cells[k]));
      var desc = [], req = [], places = [], mail = '';
      var ma = body.querySelector('a[href^="mailto:"]');
      if (ma) mail = (ma.getAttribute('href') || '').replace(/^mailto:/i, '').split('?')[0].trim();
      for (var j = 0; j < all.length; j++) {
        var l = all[j];
        var em = /[\w.+-]+@[\w-]+(\.[\w-]+)+/.exec(l);
        if (em && !mail) mail = em[0];
        if (APPLY.test(l)) continue;
        var pm = PLACE.exec(l);
        if (pm && !places.length) places = pm[1].split(/\s+או\s+|\s*,\s*/).map(function (s) { return s.trim(); }).filter(Boolean);
        if (!pm && !/דרוש/.test(l) && l.length <= 150 && (REQ_ANY.test(l) || REQ_START.test(l))) req.push(l);
        else desc.push(l);
      }
      return { href: href, title: title, desc: desc, req: req, mail: mail, loc: places.join(' | ') };
    }));
  } catch (e) {
    console.log('[handasi] no rows built: ' + e);
    jobs = [];
  }
  if (jobs.length) {
    var root = document.createElement('div');
    root.id = 'haide-handasi';
    root.style.display = 'none';
    var mk = function (parent, cls, val) {
      var e = document.createElement('div');
      e.className = cls;
      if (typeof val === 'string') e.textContent = val;
      else for (var v = 0; v < val.length; v++) { var q = document.createElement('p'); q.textContent = val[v]; e.appendChild(q); }
      parent.appendChild(e);
    };
    for (var n = 0; n < jobs.length; n++) {
      var t = jobs[n].title;
      if (!LANG_OK.test(t) || LANG_BAD.test(t)) continue;
      var d = document.createElement('div');
      d.className = '__ai-job';
      var link = document.createElement('a');
      link.className = '__ai-link';
      link.setAttribute('href', jobs[n].href);
      link.textContent = t;
      d.appendChild(link);
      mk(d, '__ai-title', t);
      if (jobs[n].desc.length) mk(d, '__ai-description', jobs[n].desc);
      if (jobs[n].req.length) mk(d, '__ai-requirements', jobs[n].req);
      if (jobs[n].mail) mk(d, '__ai-apply', 'mailto:' + jobs[n].mail);
      mk(d, '__ai-location', jobs[n].loc);
      root.appendChild(d);
    }
    document.body.appendChild(root);
  }
}
