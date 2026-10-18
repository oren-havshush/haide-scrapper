// albar.co.il/מודעות-דרושים (Umbraco). One page, li.job_container rows, bodies inline:
// label "תיאור התפקיד" + div.desc, label "דרישות התפקיד" + div.desc. Labels dropped.
// The requirements block of every row ends with the same group privacy/consent text (it starts at
// "הפרטים שתמסור"): it is a closing section shared by every job, so it moves to the end of the
// description (job body rule 4). Nothing else moves.
// Id: none emitted (no number, no per-job URL); the worker builds an h- id from title, department and url.
// Location: none emitted (no place in any ad; the company has many branches, so no site rule).
// Apply: the static formCapture (the page's own AJAX upload request); no per-job value exists.
if (document.getElementById('haide-albar')) return;
var rows = document.querySelectorAll('li.job_container');
if (!rows.length) return;
var mark = document.createElement('i');
mark.id = 'haide-albar';
mark.style.display = 'none';
document.body.appendChild(mark);
var NB = String.fromCharCode(160);
var PRIV = 'הפרטים שתמסור';
var clean = function (s) {
  return String(s || '').split(NB).join(' ').replace(/[ \t\r\f\v]+/g, ' ').trim();
};
var HE_LAT = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u;
var OTHER = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var linesOf = function (el) {
  var c = el.cloneNode(true);
  [].slice.call(c.querySelectorAll('br')).forEach(function (x) { x.replaceWith('\n'); });
  [].slice.call(c.querySelectorAll('p,li,div,h1,h2,h3,h4,h5,h6')).forEach(function (x) { x.appendChild(document.createTextNode('\n')); });
  [].slice.call(c.querySelectorAll('input')).forEach(function (x) { x.replaceWith(' ' + (x.getAttribute('value') || '')); });
  return (c.textContent || '').split('\n').map(clean).filter(Boolean);
};
[].slice.call(rows).forEach(function (it) {
  if (it.querySelector('.__ai-holder')) return;
  var tEl = it.querySelector('.titles > .title');
  var title = clean(tEl ? tEl.textContent : '');
  if (!title || !HE_LAT.test(title) || OTHER.test(title)) { console.log('[albar] dropped (language): ' + title); return; }
  var desc = [], req = [], closing = [];
  [].slice.call(it.querySelectorAll('.Details > label.title_lable')).forEach(function (lab) {
    var box = lab.nextElementSibling;
    if (!box || !box.classList.contains('desc')) return;
    var isReq = /דרישות/.test(lab.textContent || '');
    var inPriv = false;
    linesOf(box).forEach(function (l) {
      if (l.indexOf(PRIV) === 0) inPriv = true;
      if (inPriv) closing.push(l);
      else (isReq ? req : desc).push(l);
    });
  });
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
  add('__ai-description', desc.concat(closing).join('\n'));
  add('__ai-requirements', req.join('\n'));
  it.classList.add('__ai-job');
  it.appendChild(holder);
});
