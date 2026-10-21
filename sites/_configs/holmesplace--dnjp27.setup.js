// holmesplace.co.il/jobs/ (WordPress theme "homesplace"), listing-only: every job is a server-rendered
// card .dursim_div on the one page; no detail pages, no fetch, no pagination.
// - title: .inner_h3 as printed (config selector).
// - requirements: the card's "דרישות התפקיד" <ul> (config selector; the heading itself is dropped).
// - description (.__ai-description): every <p> of the card body, line by line, empty lines dropped.
//   SHARED = true appends the page's banner paragraph (benefits printed once for all jobs, rule 4).
// - applicationInfo: the card's mailto as printed (config selector, extractAttr href). No form.
// - externalJobId: NOT emitted. No printed number, no id attribute, no per-job URL; the worker
//   synthesises h-<hash(title)> (addsite3 6.2).
// - location (.__ai-location): only from a work-location cue line of the card's own text (a line that
//   starts with העבודה / עבודה / מקום העבודה / מיקום) naming a club, read through CLUB (the club's city
//   as the site's own club picker prints it, mapped to a verbatim city.csv row). No cue line -> Unknown.
//   The site-wide clubs map/picker is never read: Holmes Place runs ~34 clubs in many cities, so
//   LRN-LOC-20 (single printed company city) does not apply.
var SHARED = true;
var ITEM = '.dursim_div';
var CLUB = {
  'אשדוד': 'אשדוד', 'באר יעקב': 'באר יעקב', 'באר שבע': 'באר שבע', 'גבעת שמואל': 'גבעת שמואל',
  'גבעתיים': 'גבעתיים', 'הוד השרון': 'הוד השרון', 'הרצליה': 'הרצליה', 'חדרה': 'חדרה', 'חיפה': 'חיפה',
  'כפר סבא': 'כפר סבא', 'לוד': 'רמלה לוד', 'מבשרת ציון': 'מבשרת ציון', 'מודיעין': 'מודיעין',
  'נס ציונה': 'נס ציונה', 'נתניה': 'נתניה', 'פתח תקווה': 'פתח תקווה', 'קיסריה': 'קיסריה',
  'קריית אונו': 'קריית אונו', 'קרית אונו': 'קריית אונו', 'קרית ביאליק': 'קרית ביאליק',
  'ראש העין': 'ראש העין', 'ראשון לציון': 'ראשון לציון', 'רחובות': 'רחובות', 'רמת גן': 'רמת גן',
  'רעננה': 'רעננה', 'תל אביב': 'תל אביב-יפו'
};
var CUE = /^(?:ה?עבודה|מקום ה?עבודה|מיקום(?: ה?משרה)?)[\s:]/;
var CLUBREF = /(?:מועדון|סניף)\s+(?:הולמס פלייס\s+|גו אקטיב\s+|אייקון\s+|ICON FITNESS\s+)?(.+)$/i;
var OK = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}]/u;
var BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var prev = -1, stable = 0;
for (var t = 0; t < 40; t++) {
  var n = document.querySelectorAll(ITEM).length;
  if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n;
  await new Promise(function (r) { setTimeout(r, 500); });
}
var clean = function (s) { return (s || '').replace(/\s+/g, ' ').trim(); };
var linesOf = function (el) {
  var out = [], cur = '';
  for (var i = 0; i < el.childNodes.length; i++) {
    var c = el.childNodes[i];
    if (c.nodeName === 'BR') { out.push(cur); cur = ''; } else cur += c.textContent || '';
  }
  out.push(cur);
  return out.map(clean).filter(Boolean);
};
var shared = [];
var banner = document.querySelector('section.banner-small .banner-small-caption');
if (SHARED && banner) {
  var bp = banner.querySelectorAll('p');
  for (var b = 0; b < bp.length; b++) shared = shared.concat(linesOf(bp[b]));
}
var items = document.querySelectorAll(ITEM);
for (var k = 0; k < items.length; k++) {
  var it = items[k];
  if (it.querySelector('.__ai-description')) continue;
  var title = clean((it.querySelector('.inner_h3') || {}).textContent);
  if (!OK.test(title) || BAD.test(title)) { it.remove(); continue; }
  var body = it.querySelector('.yellow-solid-box-content');
  var desc = [];
  if (body) {
    var ps = body.querySelectorAll(':scope > p');
    for (var p = 0; p < ps.length; p++) desc = desc.concat(linesOf(ps[p]));
  }
  var all = desc.slice();
  var lis = body ? body.querySelectorAll('li') : [];
  for (var l = 0; l < lis.length; l++) all.push(clean(lis[l].textContent));
  var cities = [];
  for (var a = 0; a < all.length; a++) {
    if (!CUE.test(all[a])) continue;
    var m = CLUBREF.exec(all[a]);
    if (!m) continue;
    var rest = m[1], best = '';
    for (var key in CLUB) {
      if (key.length > best.length && rest.indexOf(key) === 0 && (rest.length === key.length || /[\s,.()\-]/.test(rest.charAt(key.length)))) best = key;
    }
    if (best && cities.indexOf(CLUB[best]) < 0) cities.push(CLUB[best]);
    if (!best) console.log('[holmesplace] cue line with an unmapped club: ' + all[a]);
  }
  var mk = function (cls, lines) {
    var e = document.createElement('div');
    e.className = cls + ' wp-exclude-emoji';
    e.style.display = 'none';
    for (var q = 0; q < lines.length; q++) {
      var s = document.createElement('p');
      s.className = 'wp-exclude-emoji';
      s.textContent = lines[q];
      e.appendChild(s);
    }
    it.appendChild(e);
  };
  var d = desc.concat(shared.length && desc.length ? [''].concat(shared) : shared).filter(function (x, i, arr) { return x || (i > 0 && arr[i - 1]); });
  mk('__ai-description', d);
  mk('__ai-location', [cities.length ? cities.join(', ') : 'Unknown']);
}
