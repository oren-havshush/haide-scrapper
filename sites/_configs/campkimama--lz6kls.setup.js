// campkimama.org — Wix repeater careers board (LRN-SPA-6).
// Row root: comp-m9sbzwut__item-<suffix>. Siblings inside it:
//   title  comp-m9sbzwuu5__item-<s>   description comp-m9sbzwuv__item-<s>
//   reqs   comp-m9zsa5ow__item-<s>    apply btn   comp-m9sbzwuv6__item-<s>
// description/requirements are LEFT AS NATIVE DOM on purpose: domFieldExtract
// turns <p>/<li> into newlines and bullets, so the old textContent+\s+ collapse
// (which produced 6/9 blob descriptions) must never come back here.
// Only scalar fields are injected, and only onto the row ROOT (LRN-SETUP-1).
var ROOT_SEL = 'div[id^="comp-m9sbzwut__item-"]';
var MAIL = 'mailto:jobs@campkimama.org';
var DEFAULT_LOC = 'פריסה ארצית'; // camp roles: no fixed city in the ad
// Every value below must be VERBATIM in "CSV files/city.csv".
var CITIES = ['הרצליה', 'תל אביב-יפו', 'ירושלים', 'חיפה', 'רעננה', 'כפר סבא',
  'נתניה', 'ראשון לציון', 'פתח תקווה', 'רמת גן', 'באר שבע', 'אשדוד', 'מודיעין'];
// sub-locality / spelling -> the city.csv value it resolves to
var ALIAS = { 'גליל ים': 'הרצליה', 'הרצלייה': 'הרצליה', 'תל אביב': 'תל אביב-יפו', 'ת"א': 'תל אביב-יפו' };

function mk(cls, val) {
  var s = document.createElement('span');
  s.className = cls;
  s.textContent = val;
  return s;
}

var roots = [].slice.call(document.querySelectorAll(ROOT_SEL));
if (!roots.length) return;

for (var i = 0; i < roots.length; i++) {
  var root = roots[i];
  if (root.querySelector('.__ai-externalJobId')) continue; // re-run guard

  var suffix = root.id.replace('comp-m9sbzwut__item-', '');
  if (!suffix) continue;

  // --- requirements: drop the "דרישות התפקיד:" label paragraph, keep the <ul>
  var req = document.getElementById('comp-m9zsa5ow__item-' + suffix);
  if (req) {
    var ps = [].slice.call(req.querySelectorAll('p'));
    for (var j = 0; j < ps.length; j++) {
      var t = (ps[j].textContent || '').replace(/[\u00a0\u200b\u200c\u200d\u200e\u200f\ufeff]/g, ' ').trim();
      if (/^דרישות\s+התפקיד\s*:?$/.test(t)) { ps[j].remove(); break; }
    }
  }

  // --- location: mine the row text, else nationwide
  var txt = (root.textContent || '').replace(/[\u00a0\u200b\u200c\u200d\u200e\u200f\ufeff]/g, ' ').replace(/[״]/g, '"').replace(/[׳]/g, "'");
  var found = [];
  var probe = Object.keys(ALIAS).concat(CITIES);
  for (var k = 0; k < probe.length; k++) {
    if (txt.indexOf(probe[k]) === -1) continue;
    var canon = ALIAS[probe[k]] || probe[k];
    if (found.indexOf(canon) === -1) found.push(canon);
  }
  var loc = found.length ? found.join(', ') : DEFAULT_LOC;

  root.appendChild(mk('__ai-externalJobId', 'kimama-' + suffix));
  root.appendChild(mk('__ai-location', loc));
  root.appendChild(mk('__ai-applicationInfo', MAIL));
}
