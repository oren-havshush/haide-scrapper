var ITEM = '.career .recent-post';
var items = Array.prototype.slice.call(document.querySelectorAll(ITEM)).filter(function (i) { return !i.hasAttribute('data-haide'); });
if (!items.length) return;
// nextcomgroup.com/career_heb: a WP "recent posts" widget (category 16), every job on one page.
// The body is only on the post page, so each is fetched. The apply address is Cloudflare-obfuscated
// (data-cfemail / email-protection#) and decoded here. A post with no address has no apply path: dropped.
function haideHash(s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); }
var NBSP = String.fromCharCode(160), CHECK = String.fromCodePoint(0x2705);
function sq(s) { return (s || '').split(NBSP).join(' ').replace(/\s+/g, ' ').trim(); }
function mk(item, cls, v) { if (!v) return; var s = document.createElement('span'); s.className = cls; s.style.display = 'none'; s.textContent = v; item.appendChild(s); }
function cf(hex) { var k = parseInt(hex.slice(0, 2), 16), s = ''; for (var i = 2; i < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ k); return s; }
var HE_EN = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u;
var OTHER = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;
var LABEL = /^(התפקיד כולל|תיאור המשרה|תיאור התפקיד)\s*:?\s*$/;
var REQ_HEAD = /^(דרישות(\s+ה?תפקיד)?|אז מה נדרש\??)\s*:?\s*$/;
// Under a requirements heading, terms/scope/area lines are not requirements (addsite2 Job body rules).
var KEEP = /^(המשרה מיועדת|הכשרה|תנאים|אזורי? העבודה|איזור|כל הארץ|משרה מלאה|שכר)/;
// "קו"ח למייל:" / "ניתן לשלוח קורות חיים למייל: X" is how to apply: it leaves the description.
var APPLY = /(קו.ח|קורות חיים).*(מייל|דוא.ל)/;
var CITY = { 'ראש העין': 'ראש העין' };
function lines(el) {
  var c = el.cloneNode(true);
  Array.prototype.forEach.call(c.querySelectorAll('script,style,h1'), function (e) { e.remove(); });
  Array.prototype.forEach.call(c.querySelectorAll('br'), function (e) { e.replaceWith('\n'); });
  Array.prototype.forEach.call(c.querySelectorAll('p,div,li,h2,h3,h4,h5,h6'), function (e) { e.insertAdjacentText('afterend', '\n'); });
  return (c.textContent || '').split('\n').map(function (l) { return sq(l.split(CHECK).join(' ')); }).filter(Boolean);
}
async function one(item) {
  item.setAttribute('data-haide', '1');
  var a = item.querySelector('.entry-title a');
  if (!a) { item.remove(); return; }
  var title = sq(a.textContent), href = a.href;
  if (!HE_EN.test(title) || OTHER.test(title)) { item.remove(); return; }
  var doc;
  try { doc = new DOMParser().parseFromString(await (await fetch(href, { credentials: 'same-origin' })).text(), 'text/html'); } catch (e) { return; }
  var body = doc.querySelector('article .entry-content');
  if (!body) return;
  // The link's target is the address the page sends mail to; the printed text can differ in case.
  var email = '';
  var link = body.querySelector('a[href*="email-protection#"]');
  if (link) email = cf(link.getAttribute('href').split('#')[1]);
  Array.prototype.forEach.call(body.querySelectorAll('[data-cfemail]'), function (e) { var v = cf(e.getAttribute('data-cfemail')); e.textContent = v; if (!email) email = v; });
  if (!EMAIL.test(email)) { item.remove(); return; }
  var desc = [], req = [], inReq = false, all = lines(body);
  all.forEach(function (l) {
    if (LABEL.test(l)) return;
    if (REQ_HEAD.test(l)) { inReq = true; return; }
    if (APPLY.test(l) || EMAIL.test(l)) return;
    // "מיקום: ראש העין, ישראל" only repeats the location field; a location line saying more stays.
    var lm = /^מיקום\s*:\s*(.+)$/.exec(l);
    if (lm && CITY[sq(lm[1].replace(/,\s*ישראל\.?$/, ''))]) return;
    if (inReq && !KEEP.test(l)) req.push(l); else desc.push(l);
  });
  var text = all.join('\n'), loc = 'Unknown', m = /מיקום\s*:\s*([^,\n]+)/.exec(text);
  if (m && CITY[sq(m[1])]) loc = CITY[sq(m[1])];
  else if (/(באזור|אזור הפעילות|איזור הפעילות)\s*:?\s*ה?צפון/.test(text)) loc = 'אזור צפון';
  else if (/אזורי? העבודה\s*:?\s*\n?\s*כל הארץ/.test(text)) loc = 'פריסה ארצית';
  var date = '', pm = doc.querySelector('meta[property="article:published_time"]');
  if (pm) date = (pm.getAttribute('content') || '').slice(0, 10);
  var slug = decodeURIComponent(new URL(href).pathname.replace(/^\/+|\/+$/g, ''));
  var id = /^[A-Za-z0-9_-]+$/.test(slug) ? 'nextcom-' + slug : 'nextcom-' + haideHash(slug);
  mk(item, '__ai-title', title);
  mk(item, '__ai-url', href);
  mk(item, '__ai-eid', id);
  mk(item, '__ai-location', loc);
  mk(item, '__ai-date', date);
  mk(item, '__ai-description', desc.join('\n'));
  mk(item, '__ai-requirements', req.join('\n'));
  mk(item, '__ai-applicationInfo', 'mailto:' + email);
}
await Promise.all(items.map(one));
