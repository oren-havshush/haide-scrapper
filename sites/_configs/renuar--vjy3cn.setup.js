// renuar.co.il /pages/stores-and-points-of-sale — 28 jobs as FAQ accordion rows
// on ONE server-rendered Shopify page. No detail pages. Apply is email
// (jobs@renuar.co.il) + WhatsApp -> applicationInfo.
// externalJobId: the printed req number is NOT unique here (3764 x3, 3802 x3,
// 3814/3771/3813/3819/3809/3812 x2) -> renuar-<req>-<djb2 of branch title>.
var ITEM = 'accordion-disclosure.accordion';

// Cities are resolved against the chain's OWN store directory — the Stockist
// feed behind /pages/store-locator (stockist.co/api/v1/map_83p8nnj3/locations/all),
// 88 branches each carrying an explicit city. That is what settles a branch named
// after a mall: kanyon Ayalon -> Ramat Gan, BIG Glilot -> Ramat HaSharon.
// Verbatim "CSV files/city.csv" entries, keyed by the title minus its leading
// req number. Every value was checked against that feed and against each ad's
// own body; nothing here is inferred from a branch label. See adminNote.
var CITY = {
  'צוותי ניהול ומכירה לסניפים ברחבי הארץ!': 'פריסה ארצית',
  'צוות ניהול לסניף איילון': 'רמת גן',
  'צוות ניהול לסניף גלילות': 'רמת השרון',
  'צוות ניהול לסניף כפר סבא': 'כפר סבא',
  'צוות ניהול לסניף הוד השרון': 'הוד השרון',
  'צוות ניהול לסניף רעננה': 'רעננה',
  'מנהל/ת משמרת לרשת אופנה מצליחה': 'הרצליה',
  'צוות ניהול לסניף הרצליה': 'הרצליה',
  'צוות ניהול לסניף נתניה': 'נתניה',
  'צוות ניהול לסניפי ירושלים': 'ירושלים',
  'צוות ניהול לסניף בית שמש': 'בית שמש',
  'צוות ניהול לסניף מודיעין': 'מודיעין',
  'צוות ניהול לסניף רחובות': 'רחובות',
  'צוות ניהול לסניף בת-ים': 'בת-ים',
  'צוות ניהול סניפי ת"א': 'תל אביב-יפו',
  'צוות ניהול סניף ביאליק': 'רמת גן',
  'צוות ניהול לסניפי ראשון לציון': 'ראשון לציון',
  'צוות ניהול לסניף פתח תקווה': 'פתח תקווה',
  'צוות ניהול לסניף קריית אונו': 'קריית אונו',
  'צוות ניהול סניף רמלה': 'רמלה לוד',
  'צוות ניהול לסניף יהוד': 'יהוד',
  'צוותי ניהול לחנות החדשה- איילון M': 'רמת גן',
  'צוות ניהול סניף אריאל': 'אריאל',
  'צוות ניהול לסניפי אשדוד': 'אשדוד',
  'צוות ניהול לסניפי אשקלון': 'אשקלון',
  'צוות ניהול לסניפי באר שבע': 'באר שבע',
  'צוות ניהול לסניף דימונה': 'דימונה',
  'לקבוצת רנואר בסניף ביג אשדוד דרוש /ה מנהל /ת משמרת שיכול /ה לעבוד בשבת': 'אשדוד'
};

// The page's own region headings -> verbatim city.csv area entries. Used only
// when a title is not in CITY (a new or reworded posting), so an unknown row
// degrades to its region and never to a wrong town.
var REGION = {
  'השרון': 'אזור השרון',
  'ירושלים': 'אזור ירושלים',
  'מרכז': 'אזור מרכז',
  'השומרון': 'אזור יהודה ושומרון',
  'דרום ואילת': 'אזור דרום'
};

var norm = function (s) { return (s || '').replace(/\s+/g, ' ').trim(); };
var hh = function (s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); };
var tidy = function (s) { return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(); };
// <br> -> newline before reading text, so block structure survives.
var textOf = function (el) {
  var d = document.createElement('div');
  d.innerHTML = el.innerHTML.replace(/<br\s*\/?>/gi, '\n');
  return d.textContent || '';
};
var put = function (item, cls, val) {
  if (!val || item.querySelector('.' + cls)) return;
  var s = document.createElement('span');
  s.className = cls; s.style.display = 'none'; s.textContent = val;
  item.appendChild(s);
};

var items = document.querySelectorAll(ITEM);
for (var i = 0; i < items.length; i++) {
  var item = items[i];
  if (item.querySelector('.__ai-eid')) continue;
  var sumEl = item.querySelector('summary .text-with-icon');
  if (!sumEl) continue;
  var raw = norm(sumEl.textContent);
  var numM = raw.match(/^\s*(\d{3,5})\s*-/);
  var num = numM ? numM[1] : '';
  var title = norm(raw.replace(/^\s*\d{3,5}\s*-\s*/, ''));
  if (!title) continue;

  // ---- location ----------------------------------------------------------
  var loc = CITY[title] || '';
  if (!loc) {
    var p = item.previousElementSibling;
    while (p && !(p.classList && p.classList.contains('faq__category'))) p = p.previousElementSibling;
    if (p) loc = REGION[norm(p.textContent)] || '';
  }
  if (!loc) loc = 'Unknown';

  // ---- body: description / requirements / shared closing / apply ----------
  var prose = item.querySelector('.accordion__content .prose');
  var desc = [], req = [], closing = [], mode = 'desc';
  var info = '';
  if (prose) {
    var blocks = prose.querySelectorAll(':scope > p');
    if (!blocks.length) blocks = [prose];
    var lines = [];
    for (var b = 0; b < blocks.length; b++) {
      var seg = textOf(blocks[b]).split('\n');
      for (var k = 0; k < seg.length; k++) lines.push(seg[k]);
      lines.push('');
    }
    for (var L = 0; L < lines.length; L++) {
      var t = norm(lines[L]);
      if (!t) { (mode === 'req' ? req : desc).push(''); continue; }
      // how-to-apply lines leave the body -> applicationInfo
      if (/להגשת קורות חיים|בוואטספ/.test(t)) continue;
      // bare link labels carry no content without their href
      if (t === 'למידע נוסף' || /תקנת חוק אבטחת מידע/.test(t)) continue;
      // printed on every posting -> shared closing, appended to description
      if (/מאגרי המידע/.test(t)) { closing.push(t); continue; }
      if (/מיועדת לנשים|פונה לנשים/.test(t)) { closing.push(t); continue; }
      var bare = t.replace(/^[*\s]+/, '').replace(/\s*:\s*$/, '');
      if (bare === 'תיאור משרה' || bare === 'תיאור התפקיד') continue;  // drop the label
      if (/^דרישות(\s+(התפקיד|תפקיד|המשרה))?$/.test(bare)) { mode = 'req'; continue; }
      (mode === 'req' ? req : desc).push(t);
    }
    // apply path: the jobs@ address (NOT the info@ "more info" link) + WhatsApp
    var aApply = null, aWa = null;
    var as = prose.querySelectorAll('a');
    for (var x = 0; x < as.length; x++) {
      var hx = as[x].getAttribute('href') || '';
      if (!aApply && /^mailto:/i.test(hx) && /קורות חיים/.test(norm(as[x].textContent))) aApply = as[x];
      if (!aWa && /wa\.me/i.test(hx)) aWa = as[x];
    }
    if (aApply) {
      info = aApply.getAttribute('href').replace(/\?.*$/, '') + ' - ' + norm(aApply.textContent) + '.';
      if (aWa) info += ' ' + norm(aWa.textContent) + ': ' + aWa.getAttribute('href');
    }
  }

  var body = desc.join('\n');
  if (closing.length) body += '\n\n' + closing.join('\n');

  put(item, '__ai-title', title);
  put(item, '__ai-eid', 'renuar-' + (num ? num + '-' : '') + hh(title));
  put(item, '__ai-loc', loc);
  put(item, '__ai-desc', tidy(body));
  put(item, '__ai-req', tidy(req.join('\n')));
  put(item, '__ai-apply', info);
}
