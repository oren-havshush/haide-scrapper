// kedarcpa.com "קריירה בקידר" (WordPress page, Flatsome theme), listing-only, no detail pages.
// Both postings sit as flat siblings in ONE .col-inner under the page h1: an <h2> per posting
// ("דרוש/ה: <role>", "דרושים: <role>"), then <p><strong>heading</strong></p> + <ul>/<p> blocks,
// ended by the apply line 'דוא"ל לשליחת קורות חיים: <mailto>', an <hr> or the next h2.
// There is no per-job element, so this script builds one hidden div.__ai-job per h2.
//
// - title: the h2 text without its "דרוש/ה:" / "דרושים:" label.
// - externalJobId: NOT emitted. No printed number, no per-job URL, no id attribute; the worker
//   builds an h- id from title, department and url itself (addsite3 6.2).
// - requirements: the "דרישות התפקיד:" and "את מי אנחנו מחפשים?" sections, labels dropped; a
//   scope / work-place line inside them ("משרה מלאה ממשרדינו ב...") stays in the description.
// - description: every other block as printed, with its own sub-headings; the apply line removed.
// - applicationInfo: "mailto:<address>" from the posting's apply line (no instruction printed).
// - location: a work-location cue line ("...ממשרדינו ב<place>") through a closed city.csv table;
//   no cue line -> "Unknown" (the firm prints two offices, so the single-address rule is out).
var PLACES = [[/אשקלון/, 'אשקלון'], [/באר שבע/, 'באר שבע']];
var CUE = /ממשרדינו\s*ב|מיקום|מקום העבודה|העבודה ב|המשרה ב/;
var KEEP_IN_DESC = /^משרה\s+(מלאה|חלקית)|ממשרדינו/;
var REQ_HEAD = /^(דרישות|את מי אנחנו מחפשים|מה אנחנו מחפשים|כישורים)/;
var TITLE_LABEL = /^\s*דרוש(ים|ות|\/ה|\.ה|ה)?\s*:\s*/;
var MAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;

var h1 = null;
var hs = document.querySelectorAll('h1');
for (var i = 0; i < hs.length; i++) { if (/קריירה/.test(hs[i].textContent || '')) { h1 = hs[i]; break; } }
var col = h1 ? h1.parentElement : null;
if (col && !col.querySelector('.__ai-root')) {
  var clean = function (s) { return String(s || '').replace(/\s+/g, ' ').trim(); };
  var jobs = [], job = null, sec = 'desc';
  var kids = col.children;
  for (var k = 0; k < kids.length; k++) {
    var el = kids[k];
    var txt = clean(el.textContent);
    if (el.tagName === 'H2' && TITLE_LABEL.test(txt)) {
      job = { title: txt.replace(TITLE_LABEL, '').trim(), desc: [], req: [], mail: '', cue: [] };
      jobs.push(job); sec = 'desc';
      continue;
    }
    if (!job) continue;
    if (el.tagName === 'HR' || el.tagName === 'H1' || el.tagName === 'H2') { job = null; continue; }
    if (!txt) continue;
    var a = el.querySelector && el.querySelector('a[href^="mailto:"]');
    if (a || (MAIL.test(txt) && /קורות חיים/.test(txt))) {
      var m = a ? (a.getAttribute('href') || '').replace(/^mailto:/i, '').split('?')[0].trim() : (MAIL.exec(txt) || [''])[0];
      if (!job.mail) job.mail = m;
      sec = 'desc';
      continue; // apply line -> applicationInfo; it also closes a requirements section
    }
    var strong = el.querySelector && el.querySelector('strong, b');
    if (el.tagName === 'P' && strong && clean(strong.textContent) === txt) {
      if (REQ_HEAD.test(txt)) { sec = 'req'; continue; }
      sec = 'desc';
      job.desc.push('', txt);
      continue;
    }
    var items = el.tagName === 'UL' || el.tagName === 'OL'
      ? Array.prototype.slice.call(el.querySelectorAll('li')).map(function (li) { return clean(li.textContent); }).filter(Boolean)
      : [txt];
    for (var n = 0; n < items.length; n++) {
      if (CUE.test(items[n])) job.cue.push(items[n]);
      if (sec === 'req' && !KEEP_IN_DESC.test(items[n])) job.req.push(items[n]);
      else job.desc.push(items[n]);
    }
  }
  var root = document.createElement('div');
  root.className = '__ai-root';
  root.style.display = 'none';
  var mk = function (parent, cls, val) {
    var e = document.createElement('div');
    e.className = cls;
    e.textContent = val;
    parent.appendChild(e);
  };
  var tidy = function (arr) {
    var out = [];
    for (var q = 0; q < arr.length; q++) { if (arr[q] === '' && (!out.length || out[out.length - 1] === '')) continue; out.push(arr[q]); }
    while (out.length && out[out.length - 1] === '') out.pop();
    return out.join('\n');
  };
  for (var j = 0; j < jobs.length; j++) {
    var places = [];
    jobs[j].cue.forEach(function (c) { PLACES.forEach(function (p) { if (p[0].test(c) && places.indexOf(p[1]) < 0) places.push(p[1]); }); });
    var d = document.createElement('div');
    d.className = '__ai-job';
    mk(d, '__ai-title', jobs[j].title);
    var desc = tidy(jobs[j].desc), req = tidy(jobs[j].req);
    if (desc) mk(d, '__ai-description', desc);
    if (req) mk(d, '__ai-requirements', req);
    if (jobs[j].mail) mk(d, '__ai-apply', 'mailto:' + jobs[j].mail);
    mk(d, '__ai-location', places.length ? places.join(', ') : 'Unknown');
    root.appendChild(d);
  }
  col.appendChild(root);
}
