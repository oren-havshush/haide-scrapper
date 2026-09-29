var ITEM = '.uc_post_list_box';
var prev = -1, stable = 0;
for (var t = 0; t < 60; t++) {
  var n = document.querySelectorAll(ITEM).length;
  if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n;
  await new Promise(function (r) { setTimeout(r, 500); });
}
if (!document.querySelector(ITEM)) return;

function haideHash(s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); }
function cfDecode(x) { var k = parseInt(x.substr(0, 2), 16), o = ''; for (var i = 2; i < x.length; i += 2) o += String.fromCharCode(parseInt(x.substr(i, 2), 16) ^ k); return o; }
function mk(item, cls, v) { if (!v) return; var s = document.createElement('span'); s.className = cls; s.style.display = 'none'; s.textContent = v; item.appendChild(s); }

// Single-city employer: the Ness Ziona municipal culture & leisure company (השריון 1, נס ציונה).
// Verbatim from "CSV files/city.csv".
var CITY = 'נס ציונה';
var HE_EN = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u;
var OTHER = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;

var REQ_HEAD = /^(דרישות( ה?(משרה|תפקיד)| הסף( לתפקיד)?)?|כישורים( נדרשים)?)\s*:?$/;
var DESC_HEAD = /^תיאור( ו?דרישות)?( ה?(תפקיד|משרה))?\s*:?$/;
var STOP = /^(המשרה מיועד|המרכז פונה|היקף|משרה (מלאה|חלקית)|עבודה במשמרות|כפיפות|מעמד|שכר)/;
var APPLY_BLOCK = /^(חובה|יש) לצרף/;
var CV_LINE = /^(שליחת )?קורות חיים/;
var PHONE = /(טלפון|ווצאפ|וואטסאפ|וואצאפ|whatsapp)/i;
var BULLET = /^[*•▪–-]\s*/;
var REQ_START = /^(ניסיון|נסיון|ידע|רישיון|רשיון|תעודה|תעודת|בעל|בעלת|בעלי|יכולת|נכונות|זמינות|שליטה|הכרה|הכרת|היכרות|מגורים|דובר|עדיפות|נדרש|יוצא|יוצאי|רצוי|גישה|עם ידע|עם ניסיון)/;

function isReq(l) {
  var s = l.replace(BULLET, '');
  if (/דרוש/.test(s) || /\d:\d\d/.test(s) || s.length > 150) return false;
  if (/^(שכר|תנאים)/.test(s) || /\+\s*תנאים/.test(s)) return false;
  if (/[–-]\s*חובה(\s+\S+){3,}/.test(s)) return false;
  return /חובה|יתרון/.test(s) || REQ_START.test(s) || /ראש גדול/.test(s);
}

function bodyLines(el) {
  var c = el.cloneNode(true);
  Array.prototype.forEach.call(c.querySelectorAll('[data-cfemail]'), function (e) { e.textContent = cfDecode(e.getAttribute('data-cfemail')); });
  Array.prototype.forEach.call(c.querySelectorAll('script,style'), function (e) { e.remove(); });
  Array.prototype.forEach.call(c.querySelectorAll('br'), function (e) { e.replaceWith('\n'); });
  Array.prototype.forEach.call(c.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,tr'), function (e) { e.insertAdjacentText('afterend', '\n'); });
  return (c.textContent || '').split('\n').map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
}

function split(lines) {
  var desc = [], req = [], notes = [], email = '', inReq = false, inApply = false, opened = false;
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i];
    var m = l.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/);
    if (m && !email) email = m[0];
    if (inApply) {
      if (m || /@|\[email/.test(l) || CV_LINE.test(l) && /שלוח|מייל/.test(l)) { inApply = false; continue; }
      notes.push(l); continue;
    }
    if (APPLY_BLOCK.test(l)) { inApply = true; inReq = false; notes.push(l); continue; }
    if (m || /@|\[email/.test(l) || CV_LINE.test(l) && /שלוח|מייל|[-:]/.test(l) || /^קורות חיים$/.test(l)) { inReq = false; continue; }
    if (PHONE.test(l) && /\d[\d-]{6,}/.test(l)) { notes.push(l); inReq = false; continue; }
    if (DESC_HEAD.test(l)) { inReq = false; continue; }
    if (REQ_HEAD.test(l)) {
      if (inReq && opened) { req.push(l); continue; }
      inReq = true; opened = true; continue;
    }
    if (inReq && (STOP.test(l) || /דרוש/.test(l))) inReq = false;
    if (inReq) { req.push(l); continue; }
    desc.push(l);
  }
  // Headless requirement lines (LRN-SETUP-18): a bullet run where >= half qualify moves as a block.
  var out = [], i2 = 0;
  while (i2 < desc.length) {
    if (BULLET.test(desc[i2])) {
      var j = i2; while (j < desc.length && BULLET.test(desc[j])) j++;
      var run = desc.slice(i2, j), q = run.filter(isReq).length;
      run.forEach(function (l) { if (run.length > 1 && q * 2 >= run.length || isReq(l)) req.push(l); else out.push(l); });
      i2 = j; continue;
    }
    if (isReq(desc[i2])) req.push(desc[i2]); else out.push(desc[i2]);
    i2++;
  }
  // A "חובה לצרף:" block is a list of documents; phone lines read as one sentence.
  var note = notes.length ? notes[0] + (notes.length > 1 ? ' ' + notes.slice(1).join(APPLY_BLOCK.test(notes[0]) ? ', ' : ' ') : '') : '';
  return { desc: out.join('\n'), req: req.join('\n'), apply: email ? 'mailto:' + email + (note ? ' - ' + note : '') : note };
}

var items = Array.prototype.slice.call(document.querySelectorAll(ITEM));
for (var k = 0; k < items.length; k++) {
  var item = items[k];
  if (item.querySelector('.__ai-eid')) continue;
  var a = item.querySelector('.uc_post_list_title a');
  if (!a) continue;
  var title = (a.textContent || '').replace(/\s+/g, ' ').trim();
  // Procurement calls (קול קורא / מכרז) share this page with the jobs; they are not vacancies.
  if (item.getAttribute('data-category') === 'מכרזים' || /^(קול קורא|מכרז)/.test(title)) { item.remove(); continue; }
  if (!HE_EN.test(title) || OTHER.test(title)) { item.remove(); continue; }
  var href = a.href;
  var slug = decodeURIComponent(new URL(href).pathname.replace(/\/+$/, '').split('/').pop());
  mk(item, '__ai-eid', 'tarbut-nz-' + haideHash(slug));
  mk(item, '__ai-url', href);
  mk(item, '__ai-location', CITY);
  try {
    var html = await (await fetch(href, { credentials: 'same-origin' })).text();
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var body = doc.querySelector('.elementor-widget-theme-post-content');
    if (body) {
      var r = split(bodyLines(body));
      mk(item, '__ai-description', r.desc);
      mk(item, '__ai-requirements', r.req);
      mk(item, '__ai-apply', r.apply);
    }
    var pt = doc.querySelector('meta[property="article:published_time"]');
    if (pt) mk(item, '__ai-date', (pt.getAttribute('content') || '').slice(0, 10));
  } catch (e) { }
}
