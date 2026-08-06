(function () {
try {
if (document.querySelector('#haide-jobs-container')) return;
var xhr = new XMLHttpRequest();
xhr.open('POST', 'https://niloo-server.herokuapp.com/actions-elbit', false);
xhr.setRequestHeader('Content-Type', 'application/json');
xhr.send(JSON.stringify({ cmd: 'get-jobs' }));
if (xhr.status < 200 || xhr.status >= 300) return;
var jobs = JSON.parse(xhr.responseText);
if (!Array.isArray(jobs)) return;
var CITY_MAP = {
"416": "חיפה", "104": "קריית שמונה", "524": "כרמיאל", "106": "פארק הייטק בר לב",
"966": "רמת השרון", "975": "רמלה", "109": "איירפורט סיטי", "816": "נתניה",
"1137": "תל אביב-יפו", "1203": "יבנה", "134": "באר שבע", "443": "חצרים",
"812": "נס ציונה", "992": "רחובות", "1008": "ראש העין", "960": "רעננה",
"467": "חולון", "72": "ערד", "149": "בני ברק", "1050": "שדרות", "878": "אופקים",
"85": "אשדוד", "628": "לוד", "935": "קיסריה", "129": "תל חי", "964": "רמת גן",
"770": "מודיעין", "1227": "יוקנעם", "2966": "יוקנעם", "2191": "נצרת עילית",
"259": "שיזפון", "447": "חצור", "751": "לטרון", "799": "נוף הגליל",
"868": "נוף הגליל", "931": "קדמה", "952": "תל חי", "1228": "יוקנעם",
"Countrywide": "פריסה ארצית", "Jerusalem Area": "אזור ירושלים",
"Jerusalem": "ירושלים", "North": "אזור צפון", "South": "אזור דרום",
"Center": "אזור מרכז", "Sharon": "אזור השרון", "Shfela": "אזור שפלה"
};
var NOT_A_PLACE = { "0": 1, "7": 1, "131": 1, "DataMigration": 1, "": 1 };
var CANON = { "לוד": "רמלה לוד", "רמלה": "רמלה לוד", "חצור": "חצור הגלילית" };
var ADDR_ALIAS = {
"צפון": "אזור צפון", "דרום": "אזור דרום", "מרכז": "אזור מרכז",
"שרון": "אזור השרון", "השרון": "אזור השרון", "השפלה": "אזור שפלה",
"שפלה": "אזור שפלה", "גוש דן": "אזור מרכז", "חיפה והקריות": "חיפה",
"ירושלים והסביבה": "אזור ירושלים"
};
var ta = document.createElement('textarea');
function unesc(s) { ta.innerHTML = String(s == null ? '' : s); return ta.value; }
function flat(s) {
var d = document.createElement('div');
d.innerHTML = unesc(s);
return (d.textContent || '').replace(/\s+/g, ' ').trim();
}
function structured(s) {
var raw = unesc(s);
if (!raw) return '';
var d = document.createElement('div');
d.innerHTML = raw;
var blocks = d.querySelectorAll('div,p,br,li,tr,h1,h2,h3,h4,h5,h6');
for (var i = 0; i < blocks.length; i++) blocks[i].insertAdjacentText('afterend', '\n');
return (d.textContent || '')
.replace(/ /g, ' ')
.replace(/[ \t]{2,}/g, ' ')
.replace(/[ \t]+\n/g, '\n')
.replace(/\n{3,}/g, '\n\n')
.trim();
}
var REQ_HEAD = /^\s*[-•*]?\s*(דריש(ות|ה)(\s+(התפקיד|המשרה|חובה|סף|הכרחיות))?|תנאי\s+סף|כישורים(\s+נדרשים)?|מה\s+נדרש|Requirements|Qualifications)\s*[:\-–]?\s*$/i;
function splitBody(desc, apiReq) {
if (apiReq) return [desc, apiReq];
var lines = desc.split('\n');
for (var i = 0; i < lines.length; i++) {
if (lines[i].trim().length < 60 && REQ_HEAD.test(lines[i])) {
var d = lines.slice(0, i).join('\n').trim();
var r = lines.slice(i + 1).join('\n').trim();
if (d.length >= 40 && r.length >= 40) return [d, r];
break;
}
}
return [desc, ''];
}
var PROSE_ALIAS = { "יקנעם": "יוקנעם", "נצרת עלית": "נצרת עילית", "תל אביב": "תל אביב-יפו" };
var EN_CITY = {
"haifa": "חיפה", "modiin": "מודיעין", "modi'in": "מודיעין", "rosh haayin": "ראש העין",
"rosh ha'ayin": "ראש העין", "ramat gan": "רמת גן", "netanya": "נתניה", "karmiel": "כרמיאל",
"carmiel": "כרמיאל", "yokneam": "יוקנעם", "yoqneam": "יוקנעם", "tel aviv": "תל אביב-יפו",
"jerusalem": "ירושלים", "beer sheva": "באר שבע", "be'er sheva": "באר שבע", "rehovot": "רחובות",
"holon": "חולון", "ramat hasharon": "רמת השרון", "ramat ha'sharon": "רמת השרון",
"airport city": "איירפורט סיטי", "lod": "לוד", "ramla": "רמלה", "ramle": "רמלה",
"kiryat shmona": "קריית שמונה", "nes ziona": "נס ציונה", "yavne": "יבנה", "sderot": "שדרות",
"ofakim": "אופקים", "ashdod": "אשדוד", "arad": "ערד", "bnei brak": "בני ברק",
"caesarea": "קיסריה", "raanana": "רעננה", "ra'anana": "רעננה", "nof hagalil": "נוף הגליל",
"latrun": "לטרון", "tel hai": "תל חי", "modiin-maccabim": "מודיעין",
"modiin maccabim": "מודיעין", "modiin illit": "מודיעין", "yokneam illit": "יוקנעם",
"hazerim": "חצרים", "hatzor": "חצור", "eilat": "אילת"
};
var HASH_RE = /#\s*([A-Za-z֐-׿][A-Za-z֐-׿'’\- ]{2,25})/g;
function hashCity(desc) {
if (!desc) return '';
HASH_RE.lastIndex = 0;
var m;
while ((m = HASH_RE.exec(desc)) !== null) {
var raw = m[1].replace(/[\s]+$/, '');
var s = raw.toLowerCase().replace(/’/g, "'");
var best = '';
for (var n in EN_CITY) if (s.indexOf(n) === 0 && n.length > best.length) best = n;
if (best) return EN_CITY[best];
var hb = matchHebPlace(raw);
if (hb) return hb;
}
return '';
}
var EN_ANCHOR = /(?:sites?|located|based|offices?|facility|centre|center)\s+(?:in|at)\s+([A-Za-z'’\- ]{3,40})/i;
var HE_RE = null, HE_NAMES = null;
function hebNames() {
if (!HE_NAMES) {
HE_NAMES = [];
for (var key in CITY_MAP) if (CITY_MAP[key].indexOf('אזור') !== 0) HE_NAMES.push(CITY_MAP[key]);
for (var al in PROSE_ALIAS) HE_NAMES.push(al);
HE_NAMES.sort(function (a, b) { return b.length - a.length; });
}
return HE_NAMES;
}
function matchHebPlace(s) {
var names = hebNames();
for (var i = 0; i < names.length; i++) if (s.indexOf(names[i]) === 0) return PROSE_ALIAS[names[i]] || names[i];
return '';
}
function proseCity(desc) {
if (!desc) return '';
if (!HE_RE) HE_RE = new RegExp('(?:אתר|מפעל|ממוקמ[הת]|מרכז)[^\\n]{0,40}?\\sב(' + hebNames().join('|') + ')');
var m = HE_RE.exec(desc);
if (m) return PROSE_ALIAS[m[1]] || m[1];
m = EN_ANCHOR.exec(desc);
if (m) {
var seg = m[1].toLowerCase().replace(/’/g, "'").replace(/^\s+|\s+$/g, '');
var best = '';
for (var n in EN_CITY) if (seg.indexOf(n) === 0 && n.length > best.length) best = n;
if (best) return EN_CITY[best];
}
return '';
}
function pickLocation(job, descText) {
var trim = function (v) { return String(v == null ? '' : v).replace(/[\s‎‏]+/g, ' ').trim(); };
var cities = '', area = '';
var ep = job.extendedProperties;
if (Array.isArray(ep)) {
for (var k = 0; k < ep.length; k++) {
if (ep[k] && ep[k].PropertyName === 'Cities') cities = trim(ep[k].Value);
else if (ep[k] && ep[k].PropertyName === 'Area') area = trim(ep[k].Value);
}
}
if (cities && !NOT_A_PLACE[cities] && CITY_MAP[cities]) return CITY_MAP[cities];
var hc = hashCity(descText);
if (hc) return hc;
var pc = proseCity(descText);
if (pc) return pc;
var locAddr = trim(job.locationAddress);
if (locAddr && !NOT_A_PLACE[locAddr]) return ADDR_ALIAS[locAddr] || locAddr;
var a = area || trim(job.area);
if (a && !NOT_A_PLACE[a] && CITY_MAP[a]) return CITY_MAP[a];
return '';
}
function resolveLocation(job, descText) {
var v = pickLocation(job, descText);
return CANON[v] || v;
}
function makeField(name, value) {
var s = document.createElement('span');
s.setAttribute('data-haide-' + name, '1');
s.textContent = String(value == null ? '' : value);
return s;
}
var container = document.createElement('div');
container.id = 'haide-jobs-container';
container.style.display = 'none';
for (var i = 0; i < jobs.length; i++) {
var j = jobs[i] || {};
if (j.status === 0) continue;
var fullDesc = structured(j.description);
var parts = splitBody(fullDesc, structured(j.requirements));
var card = document.createElement('div');
card.className = 'haide-job-card';
card.appendChild(makeField('title', flat(j.jobTitle)));
card.appendChild(makeField('jobcode', j.jobCode || j.jobId || ''));
card.appendChild(makeField('description', parts[0]));
card.appendChild(makeField('requirements', parts[1]));
card.appendChild(makeField('location', resolveLocation(j, fullDesc)));
card.appendChild(makeField('department', flat(j.employerName)));
card.appendChild(makeField('publishdate', j.openDate || ''));
card.appendChild(makeField('applyurl', j.jobId ? ('https://elbitsystemscareer.com/job/?jid=' + j.jobId) : ''));
container.appendChild(card);
}
document.body.appendChild(container);
} catch (e) {}
})();
