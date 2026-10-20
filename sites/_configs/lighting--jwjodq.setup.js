// lighting.co.il /jobs (Magento, idus jobs module). Runs on the listing and on each /jobs/jobs/<n>/ page.
// LISTING: per li.job -> .__ai-location (card tag, closed map). No id is emitted: the worker synthesises one (owner, 2026-10-07).
// DETAIL: .__ai-description / .__ai-requirements from the job body, split on the employer's own "דרישות" heading.
var HE_LAT = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u;
var OTHER = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
// Card tag (li class city_<code> -> select.citis option title) -> verbatim city.csv value.
// A tag not in this map ships as Unknown, never as a guess (the body names shuttle towns, not work places).
var LOC = { 'מודיעין': 'מודיעין', 'כל הארץ': 'פריסה ארצית' };
var add = function (root, cls, text) {
  if (root.querySelector('.' + cls)) return;
  var s = document.createElement('span');
  s.className = cls; s.style.display = 'none'; s.textContent = text;
  root.appendChild(s);
};
var items = document.querySelectorAll('ul.jobs > li.job');
for (var i = 0; i < items.length; i++) {
  var it = items[i];
  var t = ((it.querySelector('.title span') || {}).textContent || '').trim();
  if (!HE_LAT.test(t) || OTHER.test(t)) { it.remove(); continue; }
  var cm = /(?:^|\s)city_([0-9a-z]+)(?:\s|$)/.exec(it.className);
  var opt = cm ? document.querySelector('select.citis option[value="' + cm[1] + '"]') : null;
  var tag = opt ? (opt.getAttribute('title') || opt.textContent || '').trim() : '';
  add(it, '__ai-location', LOC[tag] || 'Unknown');
}
var body = document.querySelector('.job_view .job_content .job_content');
if (body && !document.querySelector('.__ai-description')) {
  var c = body.cloneNode(true);
  c.querySelectorAll('p,div,ul,ol,li,br,h1,h2,h3,h4,h5,h6,tr').forEach(function (e) { e.insertAdjacentText('afterend', '\n'); });
  var lines = c.textContent.split('\n').map(function (l) { return l.trim(); });
  var d = [], r = [], inReq = false;
  for (var k = 0; k < lines.length; k++) {
    var l = lines[k];
    if (/^דרישות\s*:?$/.test(l)) { inReq = true; continue; }
    if (inReq && /^[^:\d]{2,30}:$/.test(l)) inReq = false;
    if (!inReq && /^(תיאור התפקיד|מהות התפקיד)\s*:?$/.test(l)) continue;
    (inReq ? r : d).push(l);
  }
  var fmt = function (a) { return a.join('\n').replace(/\n{3,}/g, '\n\n').trim(); };
  var host = document.querySelector('.job_view') || document.body;
  add(host, '__ai-description', fmt(d));
  add(host, '__ai-requirements', fmt(r));
}
