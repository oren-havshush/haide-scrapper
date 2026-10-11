// mizrahi-tefahot.co.il open-jobs (Umbraco): one listing page of .job.filterItem cards, body on each
// card's detail page. Runs on both pages; each branch checks its own markup.
// id: the ASCII slug of the card's detail link as mizrahi-tefahot-<slug>; a non-ASCII slug emits no id.
// The hidden HiddenJobsIds value is a shared template code (JB-107 on 14 cards), not a job id.
// location (detail page, owner 2026-10-11): the job's region tag vs the places its title, its lede's
// "דרוש/מגייס/מחפש" line and its "העבודה ב..." lines name, through a closed city.csv list (לוד and
// רמלה -> "רמלה לוד"). All places inside the tag's region -> the places; none inside -> the tag row;
// no place -> the tag row; no tag -> the places, else Unknown.
// detail: the lede block beside .jobDetails + the .jobDetails body; a line that is only a description label is dropped,
// a requirements label switches to requirements, a benefits/hours heading switches back.
var NBSP = String.fromCharCode(160), ZW = String.fromCharCode(8203), Q = '["' + String.fromCharCode(1524) + ']';
var norm = function (s) { return (s || '').split(NBSP).join(' ').split(ZW).join('').replace(/\s+/g, ' ').trim(); };
var KEEP = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, OTHER = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var REG = { 'שפלה': 'אזור שפלה', 'מרכז': 'אזור מרכז', 'שרון': 'אזור השרון', 'ירושלים': 'אזור ירושלים', 'צפון': 'אזור צפון', 'דרום': 'אזור דרום' };
var cards = document.querySelectorAll('.job.filterItem');
if (cards.length && !document.querySelector('.job.filterItem .__ai-id')) {
  Array.prototype.forEach.call(cards, function (c) {
    try {
      var title = norm((c.querySelector('h3') || {}).textContent);
      if (!title || !KEEP.test(title) || OTHER.test(title)) { c.remove(); return; }
      var a = c.querySelector('a.toggler');
      var href = a ? a.getAttribute('href') : '';
      var segs = href ? new URL(href, location.href).pathname.split('/').filter(Boolean) : [];
      var slug = segs.length ? segs[segs.length - 1] : '';
      if (/^[A-Za-z0-9_-]+$/.test(slug)) {
        var i = document.createElement('span');
        i.className = '__ai-id';
        i.style.display = 'none';
        i.textContent = 'mizrahi-tefahot-' + slug;
        c.appendChild(i);
      }
    } catch (e) { }
  });
}
var body = document.querySelector('.jobDetails .mizRteditor');
if (body && !document.querySelector('.__ai-description')) {
  var DESC_H = /^(תיא?[ון]ר\s+(ה)?(משרה|תפקיד)|מה עושים בתפקיד)$/;
  var REQ_H = /^(דרישות(\s+(ה)?(משרה|תפקיד))?|כישורים|מה אנחנו מחפשים)$/;
  var BACK_H = /^(למה להצטרף אלינו|מה אנחנו מציעים|שעות פעילות|היקף משרה)$/;
  var toLines = function (root) {
    var out = [];
    Array.prototype.forEach.call(root.children, function (blk) {
      if (/^(UL|OL)$/.test(blk.tagName)) {
        Array.prototype.forEach.call(blk.querySelectorAll('li'), function (li) {
          var t = norm(li.textContent);
          if (t) out.push({ li: true, t: t });
        });
        return;
      }
      var buf = '';
      var w = document.createTreeWalker(blk, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT), n;
      while ((n = w.nextNode())) {
        if (n.nodeType === 3) buf += n.nodeValue;
        else if (n.tagName === 'BR') { if (norm(buf)) out.push({ li: false, t: norm(buf) }); buf = ''; }
      }
      if (norm(buf)) out.push({ li: false, t: norm(buf) });
    });
    return out;
  };
  var desc = [], req = [], sec = desc;
  var host = document.querySelector('.jobDetails').parentNode;
  var lede = Array.prototype.filter.call(host.children, function (e) { return e.matches('.mizRteditor'); })[0];
  if (lede) desc = desc.concat(toLines(lede));
  sec = desc;
  toLines(body).forEach(function (ln) {
    var h = ln.li ? '' : ln.t.replace(/[\s:?]+$/, '');
    if (h && DESC_H.test(h)) { sec = desc; return; }
    if (h && REQ_H.test(h)) { sec = req; return; }
    if (h && BACK_H.test(h)) sec = desc;
    sec.push(ln);
  });
  var build = function (cls, lines) {
    var d = document.createElement('div'), ul = null;
    d.className = cls;
    lines.forEach(function (ln) {
      if (ln.li) {
        if (!ul) { ul = document.createElement('ul'); d.appendChild(ul); }
        var li = document.createElement('li');
        li.textContent = ln.t;
        ul.appendChild(li);
      } else {
        ul = null;
        var p = document.createElement('p');
        p.textContent = ln.t;
        d.appendChild(p);
      }
    });
    return d;
  };
  host.appendChild(build('__ai-description', desc));
  if (req.length) host.appendChild(build('__ai-requirements', req));
  try {
    var PL = [
      ['הוד השרון', 'הוד השרון', 'שרון'], ['הרצליה', 'הרצליה', 'שרון'],
      ['רמלה', 'רמלה לוד', 'שפלה'], ['לוד', 'רמלה לוד', 'שפלה'],
      ['תל אביב|ת' + Q + 'א', 'תל אביב-יפו', 'מרכז'], ['רמת גן|ר' + Q + 'ג', 'רמת גן', 'מרכז'],
      ['בת[ -]ים', 'בת-ים', 'מרכז'], ['ירושלים', 'ירושלים', 'ירושלים'], ['נס ציונה', 'נס ציונה', 'שפלה'],
      ['פתח תקו?וה', 'פתח תקווה', 'מרכז'], ['בני ברק', 'בני ברק', 'מרכז'],
      ['איי?רפורט סיטי', 'איירפורט סיטי', 'שפלה'], ['רחובות', 'רחובות', 'שפלה'], ['חולון', 'חולון', 'מרכז'],
      ['ראשון לציון|ראשל' + Q + 'צ', 'ראשון לציון', 'שפלה'], ['גבעתיים', 'גבעתיים', 'מרכז'],
      ['פ' + Q + 'ת', 'פתח תקווה', 'מרכז'], ['קרי?ית אונו', 'קריית אונו', 'מרכז'], ['גבעת שמואל', 'גבעת שמואל', 'מרכז'],
      ['יבנה', 'יבנה', 'שפלה']
    ];
    var tagEl = document.querySelector('.job-buttons .location');
    var tag = norm(tagEl && tagEl.textContent);
    var cues = [norm((document.querySelector('h1') || {}).textContent)];
    desc.concat(req).forEach(function (ln) {
      if (/(^|\s)(דרוש|דרושה|דרוש\/ה|מגייס|מגייסת|מחפש|מחפשת)(\s|$)/.test(ln.t) || /^העבודה\s+ב/.test(ln.t)) cues.push(ln.t);
    });
    var found = [], src = [];
    cues.forEach(function (t) {
      PL.forEach(function (p) {
        var re = new RegExp('(^|[^א-ת])[ובלמה]{0,2}(' + p[0] + ')(?![א-ת])');
        if (re.test(t) && found.indexOf(p) < 0) { found.push(p); if (src.indexOf(t) < 0) src.push(t); }
      });
    });
    var inside = found.filter(function (p) { return p[2] === tag; });
    var vals = [], kase;
    if (REG[tag]) {
      if (!found.length) { vals = [REG[tag]]; kase = 'tag only'; }
      else if (inside.length === found.length) { inside.forEach(function (p) { if (vals.indexOf(p[1]) < 0) vals.push(p[1]); }); kase = '1'; }
      else if (!inside.length) { vals = [REG[tag]]; kase = '3'; }
      else { inside.forEach(function (p) { if (vals.indexOf(p[1]) < 0) vals.push(p[1]); }); kase = 'mixed'; }
    } else if (found.length) { found.forEach(function (p) { if (vals.indexOf(p[1]) < 0) vals.push(p[1]); }); kase = '4'; }
    else { vals = ['Unknown']; kase = 'none'; }
    var l = document.createElement('span');
    l.className = '__ai-location';
    l.style.display = 'none';
    l.setAttribute('data-case', kase);
    l.setAttribute('data-tag', tag);
    l.setAttribute('data-cue', src.join(' || '));
    l.setAttribute('data-cues', cues.join(' || '));
    l.textContent = vals.join(', ');
    host.appendChild(l);
  } catch (e) { }
}
