var ITEM = '.widget-outer';
if (/^\/jobs-lobby\/?$/.test(location.pathname)) {
  // Card location -> verbatim city.csv entry, checked 2026-10-06. A value not listed here
  // ships as Unknown until it is added: a wrong city is worse than a missing one.
  var LOC = { 'נשר': 'נשר', 'באר שבע': 'באר שבע', 'מודיעין': 'מודיעין', 'כפר סבא': 'כפר סבא', 'אזור המרכז': 'אזור מרכז', 'אזור מרכז': 'אזור מרכז' };
  var LABEL = /^(דרישות|דרישות התפקיד|תיאור התפקיד|תיאור משרה)\s*:?$/;
  var REQW = /^(ניסיון|נסיון|ידע|רישיון|רשיון|תעודה|תעודת|בעל\/ת|יכולת|נכונות|זמינות|שליטה|הכרה|הכרת|מגורים|דובר|עדיפות|נדרש|יוצא|רצוי)/;
  var INVIS =new RegExp('[' + String.fromCharCode(0x200B, 0x200E, 0x200F, 0xA0, 0xFEFF) + ']', 'g');
  var lines = function (el, skip) {
    if (!el) return [];
    var c = el.cloneNode(true);
    c.querySelectorAll(skip).forEach(function (e) { e.remove(); });
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
  var meta = function (item, label) {
    var img = item.querySelector('.widget__head img[title="' + label + '"]');
    var sp = img && img.parentElement.querySelector('span');
    return sp ? sp.textContent.replace(/\s+/g, ' ').trim() : '';
  };
  var cards = [].slice.call(document.querySelectorAll(ITEM));
  var printedCount = {};
  cards.forEach(function (c) { var n = meta(c, 'מספר משרה'); printedCount[n] = (printedCount[n] || 0) + 1; });
  cards.forEach(function (item) {
    var a = item.querySelector('a.btn--blue');
    var h3 = item.querySelector('h3.job-title');
    if (!a || !h3) return;
    var url = new URL(a.getAttribute('href'), location.href).href;
    var slug = url.split('/jobs-lobby/')[1].replace(/\/+$/, '');
    // The printed job number is the id; a number that is not plain digits or that two
    // cards print (50049330 / 50049330*) falls back to the job's own URL slug.
    var num = meta(item, 'מספר משרה');
    var id = (/^\d+$/.test(num) && printedCount[num] === 1) ? num : slug;
    var groups = item.querySelectorAll('.widget__content .widget__group');
    var desc = [], req = [];
    groups.forEach(function (g) {
      if (g.classList.contains('hidden')) lines(g, 'h5').forEach(function (l) { if (!LABEL.test(l)) req.push(l); });
      else lines(g, 'h3.job-title').forEach(function (l) {
        if (LABEL.test(l)) return;
        // A requirement line with no heading is still a requirement (LRN-SETUP-18).
        var t = l.replace(/^[*•▪\-–\s]+/, '');
        if (t.length < 150 && !/דרוש/.test(t) && !/\d:\d\d/.test(t) && (REQW.test(t) || /חובה|יתרון/.test(t))) req.push(l); else desc.push(l);
      });
    });
    put(item, '__ai-id', 'yes-' + id);
    put(item, '__ai-title', h3.textContent.replace(/\s+/g, ' ').trim());
    put(item, '__ai-description', desc.join('\n'));
    put(item, '__ai-requirements', req.join('\n'));
    // The card's location, plus the other places on the ad's own "מקום העבודה" line when
    // that line includes the card's place (owner, 2026-10-06: 50049330* is כפר סבא and נשר).
    // A line that does not include the card's place changes nothing: the card wins.
    var card = LOC[meta(item, 'מיקום')];
    var locs = card ? [card] : [];
    desc.forEach(function (l) {
      var m = /^מקום העבודה\s*[:\-–]\s*(.+)$/.exec(l);
      if (!m || !card) return;
      var listed = m[1].split(/\s*[\/,]\s*|\s+ו(?=\S)/).map(function (s) { return LOC[s.trim()]; });
      if (listed.indexOf(card) < 0) return;
      listed.forEach(function (v) { if (v && locs.indexOf(v) < 0) locs.push(v); });
    });
    put(item, '__ai-location', locs.length ? locs.join(', ') : 'Unknown');
    put(item, '__ai-department', meta(item, 'תחום'));
    put(item, '__ai-detailurl', url, url);
  });
}
