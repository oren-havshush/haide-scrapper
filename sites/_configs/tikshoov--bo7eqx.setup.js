// tikshoov.co.il careers-list: native jobID -> id; each job's body is fetched from its detail page.
var ITEM = 'div.jobBox';
var prev = -1, stable = 0;
for (var t = 0; t < 40; t++) {
  var n = document.querySelectorAll(ITEM).length;
  if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n;
  await new Promise(function (r) { setTimeout(r, 500); });
}
// Every value below is a verbatim "CSV files/city.csv" entry.
var ALLOW = ['אשדוד','אשקלון','באר שבע','בית שמש','בני ברק','גבעת שמואל','דימונה','חדרה','חולון','חיפה','טבריה','יקום','ירושלים','כרמיאל','נשר','נתיבות','נתניה','עפולה','צפת','קרית אתא','קרית ביאליק','קרית גת','קרית מוצקין','ראשון לציון','רחובות','תל אביב-יפו','פתח תקווה','רמת גן','עכו','נצרת','אילת','אזור שפלה'];
var ALIAS = {'תל אביב':'תל אביב-יפו','תל-אביב':'תל אביב-יפו','קריית גת':'קרית גת','קריית מוצקין':'קרית מוצקין','קריית אתא':'קרית אתא','קריית ביאליק':'קרית ביאליק'};
var city = function (s) { s = (s || '').replace(/[.\s]+$/, '').trim(); s = ALIAS[s] || s; return ALLOW.indexOf(s) >= 0 ? s : null; };
var list = function (s) {
  var out = [];
  var parts = s.split('/').map(function (x) { return x.trim(); }).filter(function (x) { return x && !/^היברידי$/.test(x); });
  for (var i = 0; i < parts.length; i++) { var c = city(parts[i]); if (!c) return null; if (out.indexOf(c) < 0) out.push(c); }
  return out.length ? out.join(', ') : null;
};
var NAMES = ALLOW.concat(Object.keys(ALIAS)).sort(function (a, b) { return b.length - a.length; });
var esc = function (s) { return s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&'); };
// First allowed city appearing as a whole word (Hebrew has no \b); pre allows a leading ב ("בנתניה").
var scan = function (s, pre) {
  var best = null, at = 1e9;
  for (var i = 0; i < NAMES.length; i++) {
    var re = new RegExp('(^|[\\s("\'\\-])' + (pre ? 'ב?' : '') + esc(NAMES[i]) + '(?=$|[\\s.,;:)"\'/\\-])');
    var mm = re.exec(s);
    if (mm && mm.index < at) { at = mm.index; best = ALIAS[NAMES[i]] || NAMES[i]; }
  }
  return best;
};
// Owner rules (2026-09-22). Precedence: the employer's own area when it is a
// CITY on the list; else the body's "מיקום המשרה:" city; else a city mined from
// the title's last segment, then from the location line (work-from-home -> its
// training city); צ'ק פוסט is Haifa; else the area when it is a REGION; else
// Unknown. A region never outranks a city the ad states, and work-from-home no
// longer short-circuits before the area is consulted. Never a guess.
var isRegion = function (s) { return !!s && (/^אזור\s/.test(s) || s === 'פריסה ארצית'); };
var loc = function (title, area, body) {
  var m = /^\s*מיקום המשרה\s*:\s*(.+)$/m.exec(body);
  var line = m ? m[1] : '';
  var a0 = area && city(area);
  if (a0 && !isRegion(a0)) return a0;
  if (m) { var r = list(line.split(/[(.,]/)[0]); if (r) return r; }
  var segs = title.split('|');
  var tc = segs.length >= 3 ? segs[segs.length - 1] : (/\s*-\s*([^-]+)$/.exec(title) || [])[1];
  var r2 = tc && scan(tc.trim(), false); if (r2) return r2;
  var r3 = line && scan(line, true); if (r3) return r3;
  if (/צ['׳]?ק\s*פוסט/.test(title + ' ' + line)) return 'חיפה';
  if (a0) return a0;
  return 'Unknown';
};
var DROP = /^(איך יראה היום שלי\?|את מי אנחנו מחפשים\?|פרטי המשרה:?|תיאור התפקיד:?|תיאור המשרה:?)$/;
var KEEP = /^(מה יהיו המשמרות שלי\?|מה עוד כדאי לי לדעת\?|מסלולי הטבות ותנאים:)$/;
var NBSP = new RegExp(String.fromCharCode(160), 'g');
// "את מי אנחנו מחפשים?" -> requirements; everything else -> description, field labels dropped.
var split = function (body) {
  var lines = body.replace(NBSP, ' ').split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
  var desc = [], req = [], inReq = false, gap = false;
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i];
    if (l === 'את מי אנחנו מחפשים?') { inReq = true; if (req.length) req.push(''); continue; }
    if (DROP.test(l)) { inReq = false; gap = true; continue; }
    var brk = KEEP.test(l) || /^דרוש/.test(l) || /^מיקום המשרה\s*:/.test(l);
    if (brk) inReq = false;
    if (inReq) { req.push(l); continue; }
    if ((KEEP.test(l) || /^דרוש/.test(l) || gap) && desc.length && desc[desc.length - 1] !== '') desc.push('');
    gap = false; desc.push(l);
  }
  return { d: desc.join('\n').trim(), r: req.join('\n').trim() };
};
var mk = function (item, cls, val) {
  if (!val) return;
  var s = document.createElement('span'); s.className = cls; s.style.display = 'none'; s.textContent = val; item.appendChild(s);
};
var boxes = Array.prototype.slice.call(document.querySelectorAll(ITEM));
var enrich = async function (box) {
  if (box.querySelector('.__ai-externalJobId')) return;
  var idEl = box.querySelector('#jobID');
  var id = idEl && idEl.textContent.trim();
  if (id && /^\d+$/.test(id)) mk(box, '__ai-externalJobId', 'tikshoov-' + id);
  var a = box.querySelector('a[href*="jobID="]');
  if (!a) return;
  try {
    var html = await fetch(a.href, { credentials: 'include' }).then(function (r) { return r.text(); });
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var v = doc.querySelector('.vacancy-text');
    if (!v) return;
    var body = Array.prototype.map.call(v.querySelectorAll('p'), function (p) { return p.textContent; }).join('\n');
    var areaEl = v.querySelector('.vacancy-location .field-value');
    var titleEl = box.querySelector('.job-title');
    var x = split(body);
    mk(box, '__ai-description', x.d);
    mk(box, '__ai-requirements', x.r);
    mk(box, '__ai-location', loc(titleEl ? titleEl.textContent.trim() : '', areaEl ? areaEl.textContent.trim() : '', body));
  } catch (e) { /* leave this job without detail fields */ }
};
var next = 0;
var worker = async function () { while (next < boxes.length) { await enrich(boxes[next++]); } };
await Promise.all([worker(), worker(), worker(), worker()]);
