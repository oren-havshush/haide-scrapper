// rs-cpa.co.il "קריירה" page (Umbraco, server-rendered), listing-only, no detail pages.
//
// Both postings sit as flat <p> siblings in ONE column (#left_col .row > .col-sm-6 that is not the
// image column): a <p> holding only a <strong> is a title; the <p> after it holds the invitation
// line, a <br>, and the apply line 'לדוא"ל office<a href="mailto:...">@rs-cpa.co.il</a>'.
// There is no per-job element, so this script builds one hidden div.__ai-job per title inside a
// hidden root appended to the column.
//
// - title: the <strong> text as printed.
// - externalJobId: NOT emitted. No printed number, no per-job URL, no id attribute; the worker
//   synthesises the h- id from title, department and url itself (addsite3 6.2).
// - description: the posting's own text lines, apply line removed (it is applicationInfo).
// - applicationInfo: "mailto:<address>" with the address AS PRINTED in the apply line's visible
//   text. Posting 2's link href says job@ while its visible text says office@; owner 2026-10-12:
//   office@ on both. Set ADDR_FROM = 'href' to publish the link target instead.
// - location: site rule (owner 2026-10-12, single-address rule): the firm prints one address
//   (footer, Menachem Begin 52, Tel Aviv), so a job whose text names no place and no field work
//   gets its city; a field-work or other-place cue leaves it "Unknown".
var ADDR_FROM = 'text';
var HQ = 'תל אביב-יפו';
var FIELD = /עבודת שטח|אצל (ה)?לקוח|באתרי (ה)?לקוח|במשרדי (ה)?לקוח|ברחבי הארץ|פריסה ארצית|נסיעות|ניידות|רכב צמוד/;
var OTHER = /ממוקמ|מיקום|באזור|באיזור|עבודה מהבית|היברידי|סניף/;
var col = document.querySelector('#left_col .row > .col-sm-6:not(.no-padding)');
if (col && !col.querySelector('.__ai-root')) {
  var lines = function (p) {
    var out = [], cur = '';
    for (var n = 0; n < p.childNodes.length; n++) {
      var c = p.childNodes[n];
      if (c.nodeName === 'BR') { out.push(cur); cur = ''; } else cur += c.textContent || '';
    }
    out.push(cur);
    return out.map(function (s) { return s.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
  };
  var jobs = [], job = null;
  var ps = col.querySelectorAll(':scope > p');
  for (var i = 0; i < ps.length; i++) {
    var p = ps[i];
    var txt = (p.textContent || '').replace(/\s+/g, ' ').trim();
    if (!txt) continue;
    var st = p.querySelector('strong');
    if (st && (st.textContent || '').replace(/\s+/g, ' ').trim() === txt) {
      job = { title: txt, desc: [], mail: '' };
      jobs.push(job);
      continue;
    }
    if (!job) continue;
    var ls = lines(p);
    for (var k = 0; k < ls.length; k++) {
      var m = /[\w.+-]+@[\w-]+(\.[\w-]+)+/.exec(ls[k]);
      if (m) {
        var a = p.querySelector('a[href^="mailto:"]');
        var href = a ? (a.getAttribute('href') || '').replace(/^mailto:/i, '').split('?')[0].trim() : '';
        if (!job.mail) job.mail = ADDR_FROM === 'href' && href ? href : m[0];
        continue; // apply line -> applicationInfo
      }
      job.desc.push(ls[k]);
    }
  }
  var root = document.createElement('div');
  root.className = '__ai-root';
  root.style.display = 'none';
  var mk = function (parent, cls, val) {
    var e = document.createElement('div');
    e.className = cls;
    if (typeof val === 'string') e.textContent = val;
    else for (var v = 0; v < val.length; v++) { var q = document.createElement('p'); q.textContent = val[v]; e.appendChild(q); }
    parent.appendChild(e);
  };
  for (var j = 0; j < jobs.length; j++) {
    var d = document.createElement('div');
    d.className = '__ai-job';
    mk(d, '__ai-title', jobs[j].title);
    if (jobs[j].desc.length) mk(d, '__ai-description', jobs[j].desc);
    if (jobs[j].mail) mk(d, '__ai-apply', 'mailto:' + jobs[j].mail);
    var all = jobs[j].title + '\n' + jobs[j].desc.join('\n');
    mk(d, '__ai-location', FIELD.test(all) || OTHER.test(all) ? 'Unknown' : HQ);
    root.appendChild(d);
  }
  col.appendChild(root);
}
