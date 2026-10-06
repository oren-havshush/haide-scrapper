var ITEM = '.rscm-careers-loop__item';
// Job page: the apply form has no action; the theme JS POSTs FormData to this REST
// route (X-WP-Nonce from rscm_ajax). Record it on the form so the live capture says so.
var jf = document.querySelector('form.js-job-application-form');
if (jf && !jf.getAttribute('action') && window.riscoSiteUrl) {
  jf.setAttribute('action', window.riscoSiteUrl.wpml_site_url + '/wp-json/api/v1/in/careers/application');
  jf.setAttribute('enctype', 'multipart/form-data');
}
if (document.querySelector('.js-careers-loop')) {
  // "View All" shows 10; the page's own "Show More" button reveals the rest.
  for (var r = 0; r < 10; r++) {
    var btn = document.querySelector('.js-more-careers');
    if (!btn || btn.offsetParent === null || getComputedStyle(btn).display === 'none') break;
    var before = document.querySelectorAll(ITEM).length;
    btn.click();
    for (var w = 0; w < 30 && document.querySelectorAll(ITEM).length === before; w++) {
      await new Promise(function (res) { setTimeout(res, 300); });
    }
    if (document.querySelectorAll(ITEM).length === before) break;
  }
  // Global board: a job ships only when its own page tags it with an Israeli
  // location. Labels are the page's location tabs; a new tab adds nothing here.
  var ISRAEL = { 'Israel': 1, 'Israel HQ': 1, 'Kiryat Gat': 1 };
  var LOCTAB = {};
  document.querySelectorAll('.js-tabs-btn[data-category]').forEach(function (b) { if (b.getAttribute('data-category')) LOCTAB[b.textContent.replace(/\s+/g, ' ').trim()] = 1; });
  // "Israel HQ": the About page's offices list prints the head office (מטה החברה) at
  // החומה 14, ראשון לציון. Bare "Israel" names a country only and stays Unknown.
  var CITY = { 'rishon lezion': 'ראשון לציון', 'kiryat gat': 'קרית גת', 'israel hq': 'ראשון לציון' };
  var HE = /^\/he\//.test(location.pathname);
  var REQ = /requirement|qualification|what you bring|skills|דרישות|כישורים/i;
  var INVIS = new RegExp('[' + String.fromCharCode(0x200B, 0x200E, 0x200F, 0xA0, 0xFEFF) + ']', 'g');
  var haideHash = function (s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); };
  var lines = function (el) {
    var c = el.cloneNode(true);
    var tw = document.createTreeWalker(c, NodeFilter.SHOW_TEXT), tn;
    while ((tn = tw.nextNode())) tn.nodeValue = tn.nodeValue.replace(/\s+/g, ' ');
    c.querySelectorAll('br').forEach(function (b) { b.replaceWith('\n'); });
    c.querySelectorAll('p,div,ul,ol,li,h1,h2,h3,h4,h5,h6,tr').forEach(function (e) { e.insertAdjacentText('afterend', '\n'); });
    return c.textContent.split('\n').map(function (s) { return s.replace(INVIS, ' ').trim(); }).filter(Boolean);
  };
  var put = function (item, cls, text, href) {
    if (item.querySelector('.' + cls)) return;
    var s = document.createElement(href ? 'a' : 'span');
    s.className = cls; s.style.display = 'none';
    if (href) s.setAttribute('href', href);
    s.textContent = text;
    item.appendChild(s);
  };
  var items = [].slice.call(document.querySelectorAll(ITEM)).filter(function (i) { return !i.querySelector('.__ai-id'); });
  await Promise.all(items.map(async function (item) {
    var a = item.querySelector('a.rscm-careers-loop__link');
    if (!a) return;
    var url = new URL(a.getAttribute('href'), location.href).href;
    // Hebrew listing: a job that also lives under /en/ is the same post the English
    // listing already ships; this page contributes only Hebrew-only jobs.
    if (HE) {
      if (/\/en\/rscm_career\//.test(url)) { item.remove(); return; }
      try {
        var tw = await fetch(url.replace('/he/rscm_career/', '/en/rscm_career/'), { credentials: 'same-origin' });
        if (tw.ok && /\/en\/rscm_career\//.test(tw.url)) { item.remove(); return; }
      } catch (e) { /* keep the card */ }
    }
    var html;
    try { html = await (await fetch(url, { credentials: 'same-origin' })).text(); } catch (e) { return; }
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var badges = [].map.call(doc.querySelectorAll('.rscm-career-single__titlebar .rscm-career-single__badge'), function (b) { return b.textContent.replace(/\s+/g, ' ').trim(); });
    var places = badges.filter(function (b) { return ISRAEL[b]; });
    var printed = (item.querySelector('.rscm-careers-loop__location') || {}).textContent || '';
    // Some job pages carry no badges at all; the card's printed location then decides.
    if (!places.length && !/\bisrael\b/i.test(printed)) { item.remove(); return; }
    var desc = [], req = [];
    doc.querySelectorAll('.rscm-career-single__career-detail').forEach(function (sec) {
      var h = sec.querySelector('h2');
      var body = sec.querySelector('.rscm-career-rich-content');
      if (!body) return;
      var target = REQ.test(h ? h.textContent : '') ? req : desc;
      lines(body).forEach(function (l) { target.push(l); });
    });
    var locs = [];
    printed.split(/[\/,]/).concat(places).forEach(function (p) {
      var v = CITY[p.trim().toLowerCase()];
      if (v && locs.indexOf(v) < 0) locs.push(v);
    });
    var slug = decodeURIComponent(url.split('/rscm_career/')[1] || '').replace(/\/+$/, '');
    var dept = badges.filter(function (b) { return !ISRAEL[b] && !LOCTAB[b]; })[0] || '';
    put(item, '__ai-id', 'riscogroup-' + (/^[a-z0-9-]+$/i.test(slug) ? slug.toLowerCase() : haideHash(slug)));
    put(item, '__ai-title', (item.querySelector('.rscm-careers-loop__title') || {}).textContent.replace(/\s+/g, ' ').trim());
    put(item, '__ai-description', desc.join('\n'));
    put(item, '__ai-requirements', req.join('\n'));
    put(item, '__ai-location', locs.length ? locs.join(', ') : 'Unknown');
    put(item, '__ai-department', dept);
    put(item, '__ai-detailurl', url, url);
  }));
}
