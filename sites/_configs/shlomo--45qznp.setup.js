/* Shlomo Group (קבוצת שלמה), www.shlomo.co.il/careers - the group's own Next.js app (basePath /careers), jobs from
   AdamTotal through the group's own backend (careers-be-prod-il.shlomo.co.il). Listing-only, no job pages.
   The server renders every job into the page's own React payload (inline self.__next_f.push scripts, "filteredJobs"): one row per job
   and region, the same jobId on every region row (72 cards = 43 jobs on 2026-10-20). This script reads that payload,
   NO fetch at all, and builds one hidden row per jobId in #haide-shlomo; the worker reads those rows.
   - Id = the printed "מס משרה" (= jobId) as shlomo-<n>; never a number inside the title.
   - Title = jobName with its own trailing job number removed (rule 7); any other number stays as printed.
   - Link = the listing URL + #<jobId> (the job's content block carries id=<jobId>); one distinct link per job.
   - Department = professionName, the category heading the card is listed under.
   - Body: jobDescription lines. A requirements heading (דרישות..., למי מתאים התפקיד?) opens requirements, a
     description label (תיאור...) opens description; labels dropped, lead-ins (התפקיד כולל:, איך ייראה היום שלך?,
     מה מחכה לכם אצלנו?) kept. A headless requirement run moves as one block when half of it qualifies
     (LRN-SETUP-18/24); pay, hours, scope, the role line and the work-place line stay in description.
   - Location (owner, 2026-10-20): tags = the job's regions (livingAreas, printed "מיקום:" once per card).
     Text cue 1: a city named in the TITLE (closed list below), plus a branch-list line "סניף A/ B/ C" in the ad
     whose every part is a listed place. Text cue 2, only when cue 1 names nothing: orderPlace (the workplace the
     employer filled in). Four-case rule against the tags: every cue place inside a tag region -> the places;
     any place outside -> the tags. No cue -> the tags. The script emits the site's own labels; the config
     locationMap turns each into a city.csv row.
   - Apply: CV upload only. The page POSTs FormData {file, jobId} to the group's backend
     /api/adam-total/send-candidate-cv (no captcha, no other field). The blob is that request, per job.
   - Language: a title with Hebrew, Latin or Arabic letters and no other script.
   ALL-OR-NOTHING: no payload, no job array, a parse error, an empty array, or a row without a numeric id or a
   title builds no row. */

var NL = String.fromCharCode(10);
var BS = String.fromCharCode(92);
/* fromCharCode: invisible chars written into a regex literal have disabled a guard before (CLAUDE.md). */
var ZW = new RegExp('[' + String.fromCharCode(0xFEFF, 0x200B, 0x200C, 0x200D, 0x2060, 0x200E, 0x200F) + ']', 'g');
var NBSP = new RegExp(String.fromCharCode(0x00A0), 'g');
var MATH = new RegExp('[' + String.fromCodePoint(0x1D400) + '-' + String.fromCodePoint(0x1D7FF) + ']', 'gu');
var OK = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}]/u;
var BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var LIST = 'https://www.shlomo.co.il/careers?workCategories=&workLocations=';
var ACT = 'https://careers-be-prod-il.shlomo.co.il/api/adam-total/send-candidate-cv';

/* Region each tag lies in (the city.csv region of its locationMap row). */
var TAG_REGION = { 'מרכז': 'אזור מרכז', 'גוש דן': 'אזור מרכז', 'השפלה': 'אזור שפלה', 'השרון': 'אזור השרון',
  'צפון': 'אזור צפון', 'דרום': 'אזור דרום', 'חיפה והקריות': 'אזור צפון', 'חבל מודיעין': 'אזור מרכז' };
/* orderPlace part as typed -> [place, city.csv region of its locationMap row]. A part not listed keeps the tags. */
var PLACE = {
  'הרצליה': ['הרצליה', 'אזור השרון'], 'נתניה': ['נתניה', 'אזור השרון'], 'חדרה': ['חדרה', 'אזור השרון'],
  'נהריה': ['נהריה', 'אזור צפון'], 'חיפה': ['חיפה', 'אזור צפון'], 'עפולה': ['עפולה', 'אזור צפון'],
  'נתב"ג': ['נתב"ג', 'אזור מרכז'],
  'ראשל"צ': ['ראשון לציון', 'אזור מרכז'], 'ראשון לציון': ['ראשון לציון', 'אזור מרכז'],
  'פ"ת': ['פתח תקווה', 'אזור מרכז'], 'פתח תקוה': ['פתח תקווה', 'אזור מרכז'], 'פתח תקווה': ['פתח תקווה', 'אזור מרכז'],
  'סגולה פ"ת': ['פתח תקווה', 'אזור מרכז'],
  'תל אביב': ['תל אביב-יפו', 'אזור מרכז'], 'ת"א': ['תל אביב-יפו', 'אזור מרכז'],
  'שילת': ['שילת', 'אזור מרכז'], 'צומת שילת': ['שילת', 'אזור מרכז'],
  'קרית עקרון': ['קרית עקרון', 'אזור שפלה'], 'באר יעקוב': ['באר יעקב', 'אזור שפלה']
};
/* Cities a title or a branch line can name besides the orderPlace labels (each a city.csv row). צריפין is not one. */
PLACE['חולון'] = ['חולון', 'אזור מרכז'];
PLACE['אור יהודה'] = ['אור יהודה', 'אזור מרכז'];
PLACE['אשדוד'] = ['אשדוד', 'אזור שפלה'];
/* Every listed label as a whole word, with an optional ב/ל/ו prefix; longest first. */
var TITLE_RE = Object.keys(PLACE).sort(function (a, b) { return b.length - a.length; }).map(function (w) {
  return [new RegExp('(?:^|[\\s\\-–(/,])[בלו]?' + w + '(?=$|[\\s\\-–),./0-9])'), w];
});
/* a region word in a title -> the tag label the locationMap knows */
var REGION_LABEL = { 'מרכז': 'מרכז', 'שפלה': 'השפלה', 'השרון': 'השרון', 'צפון': 'צפון', 'דרום': 'דרום' };
var BRANCH =/סניף\s+([^.\n]+\/[^.\n]+)/;

var REQ_H = /^(דרישות(\s+(המשרה|התפקיד|סף|חובה))?|למי מתאים התפקיד\s*\?)\s*:?\s*$/;
var REQ_INLINE = /^דרישות(\s+(המשרה|התפקיד|סף|חובה))?\s*:\s*(\S.*)$/;
var DESC_H = /^(תיאור(\s+ה?(משרה|תפקיד))?)\s*:?\s*$/;
var LEAD_H = /^(התפקיד כולל|המשרה כוללת|מהות (התפקיד|העבודה)|איך יי?ראה היום שלך|מה מחכה לכם אצלנו)\s*[:?]?\s*$/;
var REQ_W = /^(ניסיון|נסיון|ידע|רישיון|רשיון|תעודה|תעודת|בעל|בעלת|בעל\/ת|יכולת|יכולות|נכונות|זמינות|שליטה|הכרה|הכרת|הכרות|היכרות|מגורים|דובר|דוברת|דובר\/ת|עדיפות|נדרש|נדרשת|נדרש\/ת|יוצא|יוצאי|רצוי|גישה|עם ידע|עם ניסיון|ראש גדול|תואר|בוגר|בוגרת|בוגר\/ת|אנגלית|הסמכ\S*|רו"ח מוסמך)(?=[\s,:\-–]|$)/;
function isPay(l) {
  var s = l.replace(/חשב\S*\s+שכר/g, '');
  return /שכר/.test(s) || /^תנאים|\+\s*תנאים|תנאים\s*\+|תנאים\s+(טובים|מעולים|מצוינים)/.test(s) || /\d:\d\d|\d-\d\d?:\d\d|\d+-\d+:\d\d/.test(s);
}
function keep(l) {
  return /דרוש/.test(l) || isPay(l) || /^(משרה\s+מלאה|היקף\s+משרה|שעות\s+עבודה)/.test(l) || /^(העבודה|המשרה)\s+(ממוקמת\s+)?ב/.test(l);
}
function isReq(l) {
  var s = l.replace(/^[^\p{L}\p{N}]+/u, '');
  if (s.length > 150 || /דרוש/.test(s) || isPay(s)) return false;
  if (/[–-]\s*חובה(\s+\S+){3,}/.test(s)) return false;
  return /חובה|יתרון/.test(s) || REQ_W.test(s);
}
function clean(t) {
  return String(t == null ? '' : t).replace(ZW, '').replace(NBSP, ' ').replace(/[ \t]+/g, ' ').trim();
}
function inject(host, cls, val, tag) {
  if (!val) return;
  var e = document.createElement(tag || 'span');
  e.className = cls;
  e.textContent = val;
  host.appendChild(e);
}
/* The payload is read from the page's own inline scripts, self.__next_f.push([1,"..."]): the self.__next_f array
   itself is emptied once the page hydrates (seen 2026-10-20), the script elements stay. Each argument is JSON.
   Then the JSON array that follows "filteredJobs": in the payload text, by bracket depth (strings skipped). */
function payloadJobs() {
  var PUSH = 'self.__next_f.push(', txt = '', got = 0;
  var S = document.querySelectorAll('script:not([src])');
  for (var n = 0; n < S.length; n++) {
    var t = (S[n].textContent || '').trim();
    if (t.indexOf(PUSH) !== 0 || t.charAt(t.length - 1) !== ')') continue;
    var a = JSON.parse(t.slice(PUSH.length, -1));
    if (a instanceof Array && a[0] === 1 && typeof a[1] === 'string') { txt += a[1]; got++; }
  }
  if (!got) throw new Error('no page payload script');
  var key = '"filteredJobs":[', i = txt.indexOf(key);
  if (i < 0) throw new Error('no filteredJobs in the payload');
  if (txt.indexOf(key, i + 1) >= 0) throw new Error('two filteredJobs arrays in the payload');
  var s = i + key.length - 1, d = 0, inS = false, esc = false, e = -1;
  for (var k = s; k < txt.length; k++) {
    var c = txt.charAt(k);
    if (inS) { if (esc) esc = false; else if (c === BS) esc = true; else if (c === '"') inS = false; continue; }
    if (c === '"') inS = true;
    else if (c === '[' || c === '{') d++;
    else if (c === ']' || c === '}') { d--; if (d === 0) { e = k + 1; break; } }
  }
  if (e < 0) throw new Error('filteredJobs array not closed');
  var arr = JSON.parse(txt.slice(s, e));
  if (!(arr instanceof Array) || arr.length === 0) throw new Error('filteredJobs is empty');
  return arr;
}
function split(body) {
  var L = String(body || '').split(/\r?\n/).map(clean).filter(function (l) { return /[\p{L}\p{N}]/u.test(l); });
  var segs = [{ req: false, l: [] }], desc = [], req = [];
  L.forEach(function (l) {
    var m;
    if (REQ_H.test(l)) { segs.push({ req: true, l: [] }); return; }
    if ((m = REQ_INLINE.exec(l))) { segs.push({ req: true, l: [m[3].trim()] }); return; }
    if (DESC_H.test(l)) { segs.push({ req: false, l: [] }); return; }
    if (LEAD_H.test(l)) { segs.push({ req: false, l: [l] }); return; }
    segs[segs.length - 1].l.push(l);
  });
  segs.forEach(function (sg) {
    var from = sg.req ? 0 : sg.l.findIndex(function (l) { return isReq(l) || (!/דרוש/.test(l) && REQ_W.test(l.replace(/^[^\p{L}\p{N}]+/u, ''))); });
    if (!sg.req && from >= 0 && sg.l.slice(from).filter(isReq).length * 2 < sg.l.length - from) from = -1;
    sg.l.forEach(function (l, n) { if (from >= 0 && n >= from && !keep(l)) req.push(l); else desc.push(l); });
  });
  return { d: desc.join(NL), r: req.join(NL) };
}
/* Labels for distinct places, in order: a second label for a place already held is dropped. */
function addPlaces(out, labels) {
  labels.forEach(function (l) {
    var have = out.some(function (o) { return PLACE[o][0] === PLACE[l][0]; });
    if (!have) out.push(l);
  });
  return out;
}
function locate(title, body, orderPlace, tags) {
  var regions = tags.map(function (t) { return TAG_REGION[t] || ''; });
  var cue = [];
  /* a branch-list line in the ad: "סניף A/ B/ C", every part a listed place */
  String(body || '').split(/\r?\n/).forEach(function (l) {
    var m = BRANCH.exec(clean(l));
    if (!m) return;
    var parts = m[1].split('/').map(function (p) {
      p = clean(p);
      return !PLACE[p] && /^[בל]/.test(p) && PLACE[p.slice(1)] ? p.slice(1) : p;
    });
    if (parts.every(function (p) { return PLACE[p]; })) addPlaces(cue, parts);
  });
  /* cities named in the title, in title order */
  var hits = [];
  TITLE_RE.forEach(function (r) { var m = r[0].exec(title); if (m) hits.push([m.index, r[1]]); });
  hits.sort(function (a, b) { return a[0] - b[0]; });
  addPlaces(cue, hits.map(function (h) { return h[1]; }));
  if (!cue.length) cue = clean(orderPlace).split('/').map(clean).filter(Boolean);
  var inside = cue.length > 0 && cue.every(function (p) { return PLACE[p] && regions.indexOf(PLACE[p][1]) >= 0; });
  if (!inside) return tags;
  /* owner (shlomo-1538): a title "אזור <region>/<city>" names both: keep the region (as its tag label) before the city */
  var rm = /אזור\s+(מרכז|שפלה|השרון|צפון|דרום)\s*\/\s*(\S+)/.exec(title);
  if (rm && hits.some(function (h) { return rm[2].indexOf(h[1]) >= 0; })) {
    var lab = REGION_LABEL[rm[1]];
    if (cue.indexOf(lab) < 0) cue = [lab].concat(cue);
  }
  return cue;
}

if (!document.getElementById('haide-shlomo')) {
  var built = [];
  try {
    var rows = payloadJobs(), byId = {}, order = [];
    rows.forEach(function (o, n) {
      var id = String(o && o.jobId != null ? o.jobId : '').trim();
      if (!/^\d{1,7}$/.test(id) || !clean(o.jobName)) throw new Error('row ' + n + ' has no id or title');
      if (!byId[id]) { byId[id] = { o: o, tags: [] }; order.push(id); }
      var t = clean(o.workLocation);
      if (t && byId[id].tags.indexOf(t) < 0) byId[id].tags.push(t);
      (o.livingAreas instanceof Array ? o.livingAreas : []).forEach(function (a) {
        a = clean(a);
        if (a && byId[id].tags.indexOf(a) < 0) byId[id].tags.push(a);
      });
    });
    order.forEach(function (id) {
      var J = byId[id], o = J.o;
      var raw = clean(String(o.jobName).replace(MATH, function (c) { return c.normalize('NFKC'); }));
      var title = raw.replace(new RegExp('\\s*[-–]?\\s*' + id + '\\s*$'), '').trim() || raw;
      if (!OK.test(title) || BAD.test(title)) { console.log('[shlomo] language drop ' + id + ' ' + title); return; }
      var body = split(o.jobDescription);
      var fields = [
        { name: 'file', label: 'העלאת קו"ח', fieldType: 'file', required: true, tagName: 'INPUT', accept: '.doc,.docx,.pdf' },
        { name: 'jobId', label: '', fieldType: 'hidden', required: false, tagName: 'INPUT', value: id }
      ];
      built.push({
        id: id, title: title, dept: clean(o.professionName),
        loc: locate(raw, o.jobDescription, o.orderPlace, J.tags).join(' | '),
        desc: body.d, req: body.r,
        blob: JSON.stringify({ actionUrl: ACT, actionAttribute: ACT, method: 'POST', enctype: 'multipart/form-data',
          submitMechanism: 'ajax', submitEndpoint: ACT, fields: fields })
      });
    });
    if (built.length === 0) throw new Error('no job kept');
  } catch (err) {
    console.log('[shlomo] no rows: ' + err);
    built = [];
  }

  var box = document.createElement('div');
  box.id = 'haide-shlomo';
  box.style.display = 'none';
  for (var r = 0; r < built.length; r++) {
    var B = built[r], row = document.createElement('div');
    row.className = 'haide-job';
    var link = document.createElement('a');
    link.className = 'haide-link';
    link.href = LIST + '#' + B.id;
    link.textContent = B.title;
    row.appendChild(link);
    inject(row, '__ai-externalJobId', 'shlomo-' + B.id);
    inject(row, '__ai-department', B.dept);
    inject(row, '__ai-location', B.loc);
    inject(row, '__ai-description', B.desc, 'div');
    inject(row, '__ai-requirements', B.req, 'div');
    inject(row, '__ai-applicationInfo', B.blob, 'div');
    inject(row, '__ai-formData', B.blob, 'div');
    box.appendChild(row);
  }
  document.body.appendChild(box);
  console.log('[shlomo] rows ' + built.length);
}
