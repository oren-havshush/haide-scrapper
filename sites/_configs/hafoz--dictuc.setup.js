// hafoz.co.il /דרושים/: one WordPress page, no job pages. The jobs sit in one Elementor text block,
// one <p> per job: <p><strong>title</strong> the job's line</p>. A line in that block that is not a job
// (the age line, the "משכורות גבוהות!" heading) is printed once for all jobs and goes with every job
// (body rule 4): the age line to requirements (rule 1), the pay heading to the description.
// Text as printed; only the dash that joins the title to its line is dropped.
// - id: the page prints no job number and has no job links, so no id is emitted; the worker builds an
//   h- id from title, department and url.
// - location: only a "לסניף <place>" line places a job (closed table, city.csv rows); every other job is
//   Unknown. The site prints two addresses (Kiryat Ata and a Modiin branch) and says it has branches
//   across the country, so a single-address rule does not apply; the driver's job is field work.
// - apply: the page's one CV form, stored as the site's form (formCapture); no blob is built here.
if (document.getElementById('haide-hafoz')) return;
var NB = String.fromCharCode(160);
var WS = new RegExp('[ \\t' + NB + ']+', 'g');
var clean = function (s) { return String(s || '').replace(WS, ' ').trim(); };
var OK1 = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var MATH = new RegExp('[' + String.fromCodePoint(0x1D400) + '-' + String.fromCodePoint(0x1D7FF) + ']', 'gu');
var JOB = /^דרוש/;
var PLACES = [[/^קרי{1,2}ת[ -]אתא(?=$|[\s.,;:()])/, 'קרית אתא'], [/^מודיעין(?=$|[\s.,;:()])(?!\s+עילית|\s+עלית)/, 'מודיעין']];
var block = null;
document.querySelectorAll('.elementor-widget-text-editor').forEach(function (w) {
  if (block) return;
  var ps = w.querySelectorAll('p');
  for (var i = 0; i < ps.length; i++) {
    var s = ps[i].querySelector('strong');
    if (s && ps[i].firstElementChild === s && JOB.test(clean(s.textContent))) { block = w.querySelector('.elementor-widget-container') || w; return; }
  }
});
if (!block) return;
var jobs = [], shared = [];
Array.prototype.forEach.call(block.children, function (el) {
  var text = clean(el.textContent);
  if (!text) return;
  var s = el.tagName === 'P' ? el.querySelector('strong') : null;
  var head = s && el.firstElementChild === s ? clean(s.textContent) : '';
  if (head && JOB.test(head)) {
    var rest = clean(text.slice(text.indexOf(head) + head.length)).replace(/^[-–—]\s*/, '');
    jobs.push({ title: head, line: rest });
  } else {
    shared.push(text);
  }
});
// a shared line that states a condition on the candidate (the age line) is a requirement (body rule 1);
// the rest (the pay heading) stays in the description
var REQ = /(?:^|\s)[ובלמהשכ]{0,2}(?:גילאי|גיל|ניסיון|רישיון|חובה|יתרון)(?=$|[\s.,;:()])/;
var sharedReq = shared.filter(function (t) { return REQ.test(t); });
var sharedDesc = shared.filter(function (t) { return !REQ.test(t); });
var root = document.createElement('div');
root.id = 'haide-hafoz';
root.className = 'wp-exclude-emoji';
root.style.display = 'none';
var mk = function (cls, v) { var e = document.createElement('span'); e.className = cls + ' wp-exclude-emoji'; e.textContent = v; return e; };
jobs.forEach(function (j) {
  var title = j.title.replace(MATH, function (c) { return c.normalize('NFKC'); });
  if (!OK1.test(title) || BAD.test(title)) return;
  var loc = 'Unknown';
  var m = /(?:^|\s)לסניף\s+(.*)$/.exec(j.line);
  if (m) {
    for (var k = 0; k < PLACES.length; k++) if (PLACES[k][0].test(m[1])) { loc = PLACES[k][1]; break; }
  }
  var item = document.createElement('div');
  item.className = 'haide-job wp-exclude-emoji';
  item.appendChild(mk('__ai-title', title));
  item.appendChild(mk('__ai-description', [j.line].concat(sharedDesc).filter(Boolean).join('\n')));
  if (sharedReq.length) item.appendChild(mk('__ai-requirements', sharedReq.join('\n')));
  item.appendChild(mk('__ai-location', loc));
  root.appendChild(item);
});
document.body.appendChild(root);
