// afeka.ac.il/about-afeka/general-information/jobs/ (Umbraco). Two accordion sections ("סגל מנהלי",
// "סגל אקדמי"), every body inline. One item per accordion row that has its own header button; the
// academic bodies nest a second .accordion-item without a header, which is not a job.
// Body: labelled sections split (description / requirements), labels dropped, apply lines removed.
// Requirements-section lines that are hours or employment terms go back to the description.
// Apply: the row's AdamTotal link (admin rows) or its mailto with the ad's own CV instruction (academic).
// Id: none emitted (no number on this page); the worker builds an h- id from title, department and url.
// Url: this page + the row's own collapse anchor, so every row has a distinct link.
// Location: site rule, both printed campus addresses are in Tel Aviv (footer) and no ad names a place.
if (document.getElementById('haide-afeka')) return;
var NB = String.fromCharCode(160);
// Left out by owner decision 2026-10-18: its AdamTotal apply page says "המשרה אינה פעילה" (no form).
var SKIP_TITLES = ['נציג.ת שירות ומידע'];
var rows = [].slice.call(document.querySelectorAll('.faq-section .accordion-item')).filter(function (it) {
  return it.querySelector(':scope > .accordion-header button') && it.querySelector(':scope > .accordion-collapse .accordion-body');
});
if (!rows.length) return;
var mark = document.createElement('i');
mark.id = 'haide-afeka';
mark.style.display = 'none';
document.body.appendChild(mark);
var clean = function (s) {
  return String(s || '').split(NB).join(' ').replace(/[ \t\r\f\v]+/g, ' ').trim();
};
var HE_LAT = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u;
var OTHER = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var DESC_H = /^(תיאור\s*(ה)?(תפקיד|משרה)|תחומי\s*אחריות|Description|Responsibilities)\s*:?$/i;
var REQ_H = /^(דרישות(\s*(ה)?(תפקיד|משרה))?|Requirements)\s*:?$/i;
var APPLY_LINE = /^(להגשת\s*(קורות|קרות)\s*חיים|Send\s+CV\s+to\s+Email\s*:?)/i;
var CV_HOWTO = /^Submit\s+updated\s+CVs?\b/i;
var TERMS = /(שעות\s*עבודה|%\s*משרה|היקף\s*משרה|שכר|salar|employment\s+terms|academic\s+rank|subject\s+to\s+.*approval)/i;
var CUE = /(מקום\s*העבודה|מיקום\s*המשרה|מיקום\s*:|Location\s*:)/i;
var LISTS = { UL: 1, OL: 1 };
var BLOCKS = { P: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, LI: 1 };
var linesOf = function (root) {
  var out = [];
  var ownText = function (el) {
    var c = el.cloneNode(true);
    [].slice.call(c.querySelectorAll('ul,ol')).forEach(function (x) { x.remove(); });
    [].slice.call(c.querySelectorAll('br')).forEach(function (x) { x.replaceWith('\n'); });
    [].slice.call(c.querySelectorAll('input')).forEach(function (x) { x.replaceWith(' ' + (x.getAttribute('value') || '')); });
    return (c.textContent || '').split('\n').map(clean).filter(Boolean);
  };
  var walk = function (el) {
    [].slice.call(el.children).forEach(function (ch) {
      if (BLOCKS[ch.tagName]) {
        ownText(ch).forEach(function (l) { out.push({ t: l, el: ch }); });
        [].slice.call(ch.children).forEach(function (g) { if (LISTS[g.tagName]) walk(g); });
      } else {
        walk(ch);
      }
    });
  };
  walk(root);
  return out;
};
var base = location.origin + location.pathname;
rows.forEach(function (it) {
  if (it.querySelector('.__ai-holder')) return;
  var btn = it.querySelector(':scope > .accordion-header button');
  var body = it.querySelector(':scope > .accordion-collapse .accordion-body');
  var title = clean(btn.textContent);
  if (!title || !HE_LAT.test(title) || OTHER.test(title)) { console.log('[afeka] dropped (language): ' + title); return; }
  if (SKIP_TITLES.indexOf(title) !== -1) { console.log('[afeka] left out (dead apply link): ' + title); return; }
  var desc = [], req = [], terms = [], howto = '', link = '', mail = '', cue = false;
  var sec = 'd';
  linesOf(body).forEach(function (o) {
    var l = o.t;
    if (CUE.test(l)) cue = true;
    var a = o.el.querySelector ? o.el.querySelector('a[href]') : null;
    if (APPLY_LINE.test(l) || (a && /adamtotal\.co\.il/i.test(a.getAttribute('href') || '') && l.length < 40) || /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(l)) {
      if (a) {
        var h = a.getAttribute('href') || '';
        if (/^mailto:/i.test(h)) mail = mail || h.replace(/^mailto:/i, '').split('?')[0].trim();
        else if (/^https?:/i.test(h)) link = link || h;
      }
      return;
    }
    if (DESC_H.test(l)) { sec = 'd'; return; }
    if (REQ_H.test(l)) { sec = 'r'; return; }
    if (CV_HOWTO.test(l)) { howto = l; return; }
    if (sec === 'r' && TERMS.test(l)) { terms.push(l); return; }
    (sec === 'r' ? req : desc).push(l);
  });
  if (!mail) {
    var ma = body.querySelector('a[href^="mailto:"]');
    if (ma) mail = (ma.getAttribute('href') || '').replace(/^mailto:/i, '').split('?')[0].trim();
  }
  var apply = link || (mail ? 'mailto:' + mail + (howto ? ' - ' + howto : '') : '');
  var holder = document.createElement('div');
  holder.className = '__ai-holder';
  holder.style.display = 'none';
  var add = function (cls, text) {
    var s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    holder.appendChild(s);
  };
  add('__ai-title', title);
  add('__ai-description', desc.concat(terms).join('\n'));
  add('__ai-requirements', req.join('\n'));
  if (!cue) add('__ai-location', 'תל אביב-יפו');
  if (apply) add('__ai-applicationInfo', apply);
  var collapse = it.querySelector(':scope > .accordion-collapse');
  var u = document.createElement('a');
  u.className = '__ai-detailurl';
  u.href = base + '#' + (collapse && collapse.id ? collapse.id : '');
  u.textContent = title;
  holder.appendChild(u);
  it.classList.add('__ai-job');
  it.appendChild(holder);
});
