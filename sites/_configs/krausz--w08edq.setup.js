// krausz.com/he/join-us-2/ and its English twin /join-us/ (two listingUrls, one template): rows inline as
// h3 + button.job_offer_btn + div.job_desc siblings (no per-job wrapper, no detail page, no printed job number).
// Builds one hidden item per row. On /join-us/ only the rows that are NOT the same jobs as on the Hebrew page
// are kept (owner 2026-10-14; compared by title and body, see english-rows.md): an allow-list of modal
// targets, each with its title, so a row that later carries another job is dropped, never re-used.
// No native id: no externalJobId is emitted; the worker builds an h- id from title, department and url.
// Each row's link is the listing URL + the button's own modal target (#contactModal_N), so two rows
// with the same title and text (the page lists "עובד במעבדה מפעלית" twice) stay two jobs.
if (document.getElementById('haide-krausz')) return;
var SEL = '.jobs_apply_wrapper button.job_offer_btn';
var prev = -1, stable = 0;
for (var t = 0; t < 40; t++) {
  var n = document.querySelectorAll(SEL).length;
  if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n;
  await new Promise(function (r) { setTimeout(r, 500); });
}
var NBSP = String.fromCharCode(160);
var sq = function (s) { return String(s || '').split(NBSP).join(' ').replace(/[ \t]+/g, ' ').trim(); };
// block-aware text: <br> and block ends become line breaks; empty lines dropped
var lines = function (el) {
  var c = el.cloneNode(true);
  c.querySelectorAll('script,style').forEach(function (e) { e.remove(); });
  c.querySelectorAll('br').forEach(function (e) { e.replaceWith('\n'); });
  c.querySelectorAll('p,div,li,ul,ol,h1,h2,h3,h4,h5,h6,tr').forEach(function (e) { e.append('\n'); });
  var out = [];
  c.textContent.split('\n').forEach(function (l) {
    l = sq(l);
    if (!l) return;
    // a run-on paragraph: "... סגירת חודש. דרישות התפקיד • a • b **c"
    l = l.replace(/([.!])\s+(דרישות(?: התפקיד)?)\s+(?=•)/, '$1\n$2\n').replace(/\s+•\s*/g, '\n• ').replace(/\s+\*\*(?=\S)/g, '\n**');
    l.split('\n').forEach(function (x) { x = sq(x); if (x) out.push(x); });
  });
  return out;
};
// section labels (dropped); requirements headings switch to requirements
var DHEAD = /^(תיאור (המשרה|התפקיד|תפקיד)|התפקיד כולל)\s*:?$/;
var RHEAD = /^(דרישות( התפקיד| תפקיד| לתפקיד)?|נדרש|תכונות נדרשות|Competencies)\s*:?$/;
// inside a requirements section these stay in the description: reporting, place, scope, pay, how to apply
var STAY = /^\**\s*(התפקיד (בכפיפות|ממוקם)|מדווח|היקף משרה|אזור\s*:|שכר|נדרשת נוכחות|יש לשלוח|Reporting to)/;
var split = function (ls) {
  var d = [], r = [], sec = 'd';
  ls.forEach(function (l) {
    var h = l.replace(/^\*+\s*/, '').trim();
    if (DHEAD.test(h)) { sec = 'd'; return; }
    if (RHEAD.test(h)) { sec = 'r'; return; }
    if (sec === 'r' && !STAY.test(l)) r.push(l); else d.push(l);
  });
  return { d: d.join('\n'), r: r.join('\n') };
};
// work-location cue lines only (title, the role line, "התפקיד ממוקם", "אזור:", "למח'/למפעל/במפעל ... ב<place>");
// a reporting line ("התפקיד בכפיפות ...") is not a cue, unless it places the team in the head office
// ("... במשרדי מטה החברה ב<place>", owner 2026-10-14, LRN-LOC-18). Closed table, every value a city.csv row.
// "Krausz headquarters" in an English title is the same head office (owner 2026-10-14, job 20): ראש העין.
var CUE = /(התפקיד ממוקם|^אזור\s*:|למפעל|במפעל|למח'|למחלקת|למשרדי|במשרדי|למטה|דרוש)/;
var PLACES = [[/(^|[\s"])ב?(אריאל)(?=$|[\s,.:)])/, 'אריאל'], [/(^|\s)ב(ראש העין)(?=$|[\s,.:)])/, 'ראש העין'], [/לאזור המרכז/, 'אזור מרכז'], [/Krausz headquarters/i, 'ראש העין']];
var place = function (title, ls) {
  var out = [];
  var scan = function (l) { PLACES.forEach(function (p) { if (p[0].test(l) && out.indexOf(p[1]) < 0) out.push(p[1]); }); };
  scan(title);
  ls.forEach(function (l) { if (CUE.test(l) && (!/^\**\s*התפקיד בכפיפות/.test(l) || /משרדי (מטה החברה|המטה)/.test(l))) scan(l); });
  return out;
};
var OK1 = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u;
var BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var BASE = location.origin + location.pathname;
var EN = /^\/join-us\/?$/.test(location.pathname);
var EN_KEEP = {
  '#contactModal_36': 'מהנדס אחזקה וטכנולוגיה במחלקת צבע:',
  '#contactModal_35': 'פלנר/ית למחלקת הצבע : תכנון ופיקוח על היצור כדי לעמוד בזמני האספקה',
  '#contactModal_34': 'מנהל/ת מעבדת איכות',
  '#contactModal_31': 'פלנר/ית עם אוריינטציה טכנית'
};
var root = document.createElement('div');
root.id = 'haide-krausz';
root.style.display = 'none';
var dropped = [];
document.querySelectorAll(SEL).forEach(function (bt) {
  var h3 = bt.previousElementSibling, body = bt.nextElementSibling;
  var title = sq(h3 && h3.tagName === 'H3' ? h3.textContent : bt.getAttribute('data-title'));
  var tgt = bt.getAttribute('data-target') || '';
  if (!title || !/^#contactModal_\d+$/.test(tgt)) { dropped.push((tgt || '?') + ':shape'); return; }
  if (EN && EN_KEEP[tgt] !== title) { dropped.push(tgt + ':en-same-or-unknown'); return; }
  if (!OK1.test(title) || BAD.test(title)) { dropped.push(tgt + ':lang'); return; }
  var ls = body && body.classList.contains('job_desc') ? lines(body) : [];
  var s = split(ls);
  if (!s.d && !s.r) { dropped.push(tgt + ':empty'); return; }
  var it = document.createElement('div');
  it.className = 'haide-job';
  var add = function (cls, v) { var e = document.createElement('span'); e.className = cls; e.textContent = v; it.appendChild(e); };
  var a = document.createElement('a');
  a.className = 'haide-link'; a.href = BASE + tgt; a.textContent = title;
  it.appendChild(a);
  if (s.d) add('__ai-description', s.d);
  if (s.r) add('__ai-requirements', s.r);
  var loc = place(title, ls);
  add('__ai-location', loc.length ? loc.join(', ') : 'Unknown');
  root.appendChild(it);
});
document.body.appendChild(root);
console.log('[krausz] rows ' + document.querySelectorAll(SEL).length + ', jobs ' + root.children.length + ', dropped ' + dropped.join(' '));
