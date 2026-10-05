// naya-tech.co.il/career (Wix): one rich-text block per job, boxed with its "Apply Now" mailto button.
// No job number, no per-job URL -> h-haideHash(title). Owner 2026-10-05: apply = the page's
// "Send your CVs" address (jobs@) for every job, no subject (the buttons' hr@ subjects name old roles);
// location Unknown (the Herzliya address is only the office); jobs that print only Must have/Advantage
// lists ship with an empty description (lists are requirements, job body rule 1).
if (document.querySelector('#haide-jobs-root')) return;
var prev = -1, stable = 0;
function applyLinks() { return Array.prototype.filter.call(document.querySelectorAll('a[href^="mailto:"]'), function (a) { return /Apply Now/i.test(a.textContent); }); }
for (var t = 0; t < 40; t++) {
  var n = applyLinks().length;
  if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n;
  await new Promise(function (r) { setTimeout(r, 500); });
}
function haideHash(s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); }
var NBSP = String.fromCharCode(160);
var ZW = new RegExp('[' + String.fromCharCode(0x200B, 0x200C, 0x200D, 0xFEFF) + ']', 'g');
var KEEP = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, OTHER = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var MUST = /^Must have\s*:?$/i, ADV = /^Advantages?\s*:?$/i;
var INTRO = /^(We are|We're|You will|Join |The role|As a |Our )/i;
var cv = Array.prototype.find.call(document.querySelectorAll('a[href^="mailto:"]'), function (a) { return !/Apply Now/i.test(a.textContent) && /@naya-tech\.co\.il/i.test(a.href); });
var mail = cv ? cv.getAttribute('href').replace(/^mailto:/i, '').split('?')[0].trim() : 'jobs@naya-tech.co.il';
var root = document.createElement('div');
root.id = 'haide-jobs-root';
root.style.display = 'none';
function mk(cls, val) { var e = document.createElement('div'); e.className = cls; e.textContent = val; return e; }
var seen = {};
applyLinks().forEach(function (a) {
  var box = a.parentElement;
  while (box && !box.querySelector('[data-testid="richTextElement"]')) box = box.parentElement;
  if (!box) return;
  var ls = [];
  Array.prototype.forEach.call(box.querySelectorAll('[data-testid="richTextElement"]'), function (rt) {
    rt.innerText.split('\n').forEach(function (l) { l = l.replace(ZW, '').split(NBSP).join(' ').replace(/\s{2,}/g, ' ').trim(); if (/[\p{L}\d]/u.test(l)) ls.push(l); });
  });
  var title = ls.shift() || '';
  if (!title || !KEEP.test(title) || OTHER.test(title)) return;
  var id = 'h-' + haideHash(title);
  if (seen[id]) return;
  seen[id] = 1;
  var desc = [], req = [], sec = null;
  ls.forEach(function (l) {
    if (MUST.test(l)) { sec = 'req'; return; }
    if (ADV.test(l)) { sec = 'req'; req.push(l); return; }
    if (sec === 'req') { req.push(l); return; }
    // No heading: an intro sentence is description; the rest are headless requirement lines.
    (INTRO.test(l) ? desc : req).push(l);
  });
  var job = document.createElement('div');
  job.setAttribute('data-haide-job', '1');
  job.appendChild(mk('__ai-title', title));
  var idEl = mk('', id);
  idEl.setAttribute('data-haide-job-id', '1');
  job.appendChild(idEl);
  if (desc.length) job.appendChild(mk('__ai-description', desc.join('\n')));
  if (req.length) job.appendChild(mk('__ai-requirements', req.join('\n')));
  job.appendChild(mk('__ai-location', 'Unknown'));
  job.appendChild(mk('__ai-apply', 'mailto:' + mail));
  root.appendChild(job);
});
document.body.appendChild(root);
