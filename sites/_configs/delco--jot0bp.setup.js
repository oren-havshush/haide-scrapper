// delco.co.il /Wanted (Skatrix CMS), listing-only, no detail pages, no fetches.
// All jobs sit as prose in ONE CKEditor block (.simple_page .ckeditor), each opened by an
// underlined "משרה #NNNN" heading. This script splits the block on those headings and builds one
// hidden div.__ai-job per job inside #haide-delco.
// - externalJobId: the printed number, namespaced "delco-<n>" (LRN-ID-11).
// - title: the heading is only the number, so the first line with a role cue (דרוש/מחפש/מגייס,
//   "לתפקיד ", an optional ו prefix allowed: "ומחפשת"), else the first line (LRN-SETUP-26).
// - description: the ad's own lines minus requirement lines and the how-to-apply lines.
// - requirements: lines classified per LRN-SETUP-18 (a line with דרוש stays in the description).
// - applicationInfo: "mailto:<address>" from the job's own mailto link; the page gives no
//   instruction for the email, so the address is bare; the fax line is dropped.
// - location: יבנה when the ad places the job there ("ביבנה"); a field-work cue (שטח, סוכן, רכב,
//   נסיעות, ברחבי הארץ) or another-place cue -> Unknown; no place and no cue -> יבנה, the company's
//   one printed city (LRN-LOC-20; P.O. boxes in Yavne on /about and /contacts).
var NBSP = String.fromCharCode(160);
var CITY = 'יבנה';
var HEAD = /^משרה\s*#\s*(\d+)\s*$/;
var CUE = /(^|\s)ו?(דרוש|מחפש|מגייס)|(^|\s)לתפקיד\s/;
var REQ_START = /^(ניסיון|נסיון|ידע|רישיון|רשיון|תעודה|תעודת|בעל|יכולת|נכונות|זמינות|שליטה|הכרה|הכרת|מגורים|דובר|עדיפות|נדרש|יוצא|רצוי|גישה|עם ידע|עם ניסיון|ראש גדול)/;
var REQ_ANY = /חובה|יתרון/;
var APPLY = /קורות\s*חיים|(^|\s)לפקס|(^|\s)פקס|@/;
var FIELD = /(^|\s)(שטח|סוכן|סוכני|רכב|נסיעות|ניידות)|ברחבי הארץ|פריסה ארצית|כל הארץ/;
var HERE = /(^|\s)ביבנה([\s.,!]|$)/;
var OTHER = /ממוקמ|מיקום|באזור|באיזור|סניף|עבודה מהבית|היברידי/;
var LANG_OK = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}]/u;
var LANG_BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var box = document.querySelector('.simple_page .ckeditor');
if (box && !document.getElementById('haide-delco')) {
  var SEP = '@@JOB@@';
  var clone = box.cloneNode(true);
  var us = clone.querySelectorAll('u');
  for (var i = 0; i < us.length; i++) {
    if (HEAD.test((us[i].textContent || '').split(NBSP).join(' ').trim())) us[i].insertAdjacentText('beforebegin', '\n' + SEP + '\n');
  }
  var brs = clone.querySelectorAll('br,p,div,li');
  for (var b = 0; b < brs.length; b++) brs[b].insertAdjacentText('afterend', '\n');
  var text = (clone.textContent || '').split(NBSP).join(' ');
  var jobs = [];
  var blocks = text.split(SEP);
  for (var k = 0; k < blocks.length; k++) {
    var ls = blocks[k].split('\n').map(function (s) { return s.replace(/[ \t]+/g, ' ').trim(); }).filter(Boolean);
    if (!ls.length) continue;
    var m = HEAD.exec(ls[0]);
    if (!m) continue;
    var body = ls.slice(1), desc = [], req = [], mail = '';
    for (var j = 0; j < body.length; j++) {
      var l = body[j];
      var em = /[\w.+-]+@[\w-]+(\.[\w-]+)+/.exec(l);
      if (em && !mail) mail = em[0];
      if (APPLY.test(l)) continue;
      if (!/דרוש/.test(l) && l.length <= 150 && (REQ_ANY.test(l) || REQ_START.test(l))) req.push(l);
      else desc.push(l);
    }
    var title = '';
    for (var t = 0; t < body.length && !title; t++) if (!APPLY.test(body[t]) && CUE.test(body[t])) title = body[t];
    if (!title) title = desc[0] || req[0] || '';
    if (!title || !LANG_OK.test(title) || LANG_BAD.test(title)) continue;
    var all = body.filter(function (x) { return !APPLY.test(x); }).join('\n');
    var loc = FIELD.test(all) ? 'Unknown' : HERE.test(all) ? CITY : OTHER.test(all) ? 'Unknown' : CITY;
    jobs.push({ id: 'delco-' + m[1], title: title, desc: desc, req: req, mail: mail, loc: loc });
  }
  var root = document.createElement('div');
  root.id = 'haide-delco';
  root.style.display = 'none';
  var mk = function (parent, cls, val) {
    var e = document.createElement('div');
    e.className = cls;
    if (typeof val === 'string') e.textContent = val;
    else for (var v = 0; v < val.length; v++) { var q = document.createElement('p'); q.textContent = val[v]; e.appendChild(q); }
    parent.appendChild(e);
  };
  for (var n = 0; n < jobs.length; n++) {
    var d = document.createElement('div');
    d.className = '__ai-job';
    mk(d, '__ai-id', jobs[n].id);
    mk(d, '__ai-title', jobs[n].title);
    if (jobs[n].desc.length) mk(d, '__ai-description', jobs[n].desc);
    if (jobs[n].req.length) mk(d, '__ai-requirements', jobs[n].req);
    if (jobs[n].mail) mk(d, '__ai-apply', 'mailto:' + jobs[n].mail);
    mk(d, '__ai-location', jobs[n].loc);
    root.appendChild(d);
  }
  document.body.appendChild(root);
}
