/* analyst / אנליסט, careers.topmatch.co.il/Analyst/ - Top Match "redmatch" candidate portal (the vendor;
   the employer is Analyst). The listing is filled by the portal's own read-only search, a POST to
   /CandidateAPI/api/position/Search/<affiliate GUID> with the body the page itself sends
   ({"KeyWords":"","CategoryId":[],"countryId":2,"cityId":[]}); it returns every listed position with its full HTML
   description. This script makes that ONE request (same origin, credentials 'omit', 20 s limit) and builds one
   hidden row per position in #haide-analyst. No detail-page visit, no other request; never the apply POST.
   - Id = compPositionID, printed on the job page after the title ("... (199451)"), as analyst-<n>.
   - Link = the job's own page redmatch-apply/redmatch.apply.html?compPositionID=<n> (the card's own link).
   - Title = jobTitleText as the listing shows it (never GetPositionDetails' internal title, which carries a
     person's name). Department = fieldDesc (the page's search field).
   - Body: the HTML description as lines (li -> bullet). The opening description label (תיאור התפקיד: / תיאור: /
     הגדרות תפקיד: / התפקיד כולל:) and the opening generic requirements label (דרישות התפקיד: / דרישות: and the
     misspelt דישות התפקיד:) are dropped; requirement sections (דרישות, תכונות נדרשות, כישורים) -> requirements.
     The closing terms lines every ad prints after its requirements (משרה מלאה/חלקית, המשרה ממוקמת, היברידית,
     יום מהבית, שכר, תנאים, אופציה להתמחות) return to description, with everything after them.
   - Location: the position's location tag (תל אביב / גוש דן), read through the config's locationMap. A work-location
     cue line in the ad ("המשרה ממוקמת ב... תל אביב / ת"א") that names Tel Aviv gives "תל אביב" (a city inside the
     גוש דן tag: the specific place wins).
   - Date: activationDate (the portal's activation time, hidden on the card) as an Israel YYYY-MM-DD.
   - Never read: friendReferralRewardValue, affiliate internals.
   - Apply: the job page's own form, which the page sends as JSON to Apply/ApplyToPosition/<GUID> with the job's
     compPositionId; no captcha (GetReCaptchaDetails: reCaptchaEnabled false); no consent box; no per-job questions.
   - Language: a title with Hebrew, Latin or Arabic letters and no other script.
   ALL-OR-NOTHING: a failed, slow (>20 s), non-2xx, unparsable or empty answer, or a row without id or title,
   builds no row at all. */

var NL = String.fromCharCode(10);
/* fromCharCode: invisible chars written into a regex literal have disabled a guard before (CLAUDE.md). */
var ZW = new RegExp('[' + String.fromCharCode(0xFEFF, 0x200B, 0x200C, 0x200D, 0x2060, 0x200E, 0x200F) + ']', 'g');
var NBSP = new RegExp(String.fromCharCode(0x00A0), 'g');
var BULLET = String.fromCharCode(0x2022);
var GERSH = String.fromCharCode(0x05F4);
var OK = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}]/u;
var BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var GUID = '48D0F6AE-9E14-4A81-B0DE-4C4A1A185109';
var API = 'https://careers.topmatch.co.il/CandidateAPI/api/';
var JOB = 'https://careers.topmatch.co.il/analyst/redmatch-apply/redmatch.apply.html?compPositionID=';
var BLOCK = /^(P|DIV|H1|H2|H3|H4|H5|H6|UL|OL|TABLE|TR|BLOCKQUOTE|SECTION|ARTICLE)$/;
var DESC_LABEL = /^(תיאור( ה?תפקיד| ה?משרה)?|הגדרות? ה?תפקיד|התפקיד כולל)\s*:\s*$/;
var REQ_HEAD = /^(דרישות|דישות|תכונות נדרשות|כישורים)/;
var REQ_LABEL = /^(דרישות|דישות)( ה?תפקיד)?\s*:?\s*$/;
var TERMS = /^(ה?משרה (מלאה|חלקית|היברידית|חצי היברידית|ממוקמת)|שכר|תנאים|אופציה להתמחות|יום (1 |עבודה )?מהבית|יש אפשרות למשרת הורה)/;
var CUE = /^(ה)?משרה ממוקמת/;
var TLV = new RegExp('תל\\s*אביב|ת["' + GERSH + ']א');

function anText(html) {
  var doc = new DOMParser().parseFromString('<div>' + String(html || '') + '</div>', 'text/html');
  var out = [];
  var walk = function (n) {
    if (n.nodeType === 3) { out.push(n.nodeValue.replace(/[\r\n\t ]+/g, ' ')); return; }
    if (n.nodeType !== 1) return;
    var t = n.tagName;
    if (t === 'IMG' || t === 'SCRIPT' || t === 'STYLE') return;
    if (t === 'BR') { out.push(NL); return; }
    if (t === 'LI') out.push(NL + BULLET + ' ');
    else if (BLOCK.test(t)) out.push(NL);
    for (var c = n.firstChild; c; c = c.nextSibling) walk(c);
    if (t === 'LI' || BLOCK.test(t)) out.push(NL);
  };
  walk(doc.body);
  var lines = out.join('').replace(ZW, '').replace(NBSP, ' ').split(NL), keep = [], pendingBullet = false;
  for (var i = 0; i < lines.length; i++) {
    var s = lines[i].replace(/\s+/g, ' ').trim();
    if (s === BULLET) { pendingBullet = true; continue; }
    if (!s || !/[\p{L}\p{N}]/u.test(s)) continue;
    if (pendingBullet && s.indexOf(BULLET) !== 0) s = BULLET + ' ' + s;
    pendingBullet = false;
    keep.push(s);
  }
  return keep;
}

function anSplit(lines) {
  var desc = [], req = [], inReq = false, inTerms = false, seenDesc = false, seenReq = false, place = '';
  for (var i = 0; i < lines.length; i++) {
    var s = lines[i];
    var bare = s.replace(new RegExp('^' + BULLET + '\\s*'), '').replace(/^[*\-\s]+/, '');
    var isHead = s.indexOf(BULLET) !== 0 && bare.length <= 45;
    if (CUE.test(bare) && TLV.test(bare)) place = 'תל אביב';
    if (inTerms) { desc.push(s); continue; }
    if (isHead && !seenDesc && !inReq && DESC_LABEL.test(bare)) { seenDesc = true; continue; }
    if (isHead && REQ_HEAD.test(bare)) {
      var opening = !seenReq; inReq = true; seenReq = true;
      if (opening && REQ_LABEL.test(bare)) continue;
      req.push(s); continue;
    }
    if (inReq && TERMS.test(bare)) { inReq = false; inTerms = true; desc.push(s); continue; }
    (inReq ? req : desc).push(s);
  }
  return { desc: desc.join(NL), req: req.join(NL), place: place };
}

function anInject(host, cls, val, tag) {
  if (!val) return;
  var e = document.createElement(tag || 'span');
  e.className = cls;
  e.textContent = val;
  host.appendChild(e);
}

if (!document.getElementById('haide-analyst')) {
  var built = [];
  try {
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, 20000);
    var res;
    try {
      res = await fetch(API + 'position/Search/' + GUID, {
        method: 'POST', credentials: 'omit', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ KeyWords: '', CategoryId: [], countryId: 2, cityId: [] })
      });
      if (!res.ok) throw new Error('search HTTP ' + res.status);
      var data = await res.json();
    } finally { clearTimeout(timer); }
    if (!data || data.responseStatus !== 0 || !(data.positions instanceof Array) || data.positions.length === 0) throw new Error('search answered no positions');
    var P = data.positions;
    for (var n = 0; n < P.length; n++) {
      var p = P[n] || {};
      var id = String(p.compPositionID == null ? '' : p.compPositionID).trim();
      var title = String(p.jobTitleText || '').replace(ZW, '').replace(NBSP, ' ').replace(/\s+/g, ' ').trim();
      if (!/^\d{3,9}$/.test(id) || !title) throw new Error('row ' + n + ' has no id or title');
      if (!OK.test(title) || BAD.test(title)) { console.log('[analyst] language drop ' + id + ' ' + title); continue; }
      var parts = anSplit(anText(p.description || p.shortDescription || ''));
      var tag = String(p.location || p.displayLocation || '').replace(/\s+/g, ' ').trim();
      var d = /^(\d{4})-(\d{2})-(\d{2})T/.exec(String(p.activationDate || ''));
      var act = API + 'Apply/ApplyToPosition/' + GUID;
      var fields = [
        { name: 'firstName', label: 'שם פרטי', fieldType: 'text', required: true, tagName: 'INPUT' },
        { name: 'lastName', label: 'שם משפחה', fieldType: 'text', required: true, tagName: 'INPUT' },
        { name: 'email', label: 'אימייל', fieldType: 'email', required: true, tagName: 'INPUT' },
        { name: 'id', label: "מס' תעודת זהות", fieldType: 'text', required: true, tagName: 'INPUT' },
        { name: 'cellPhone', label: 'טלפון נייד', fieldType: 'tel', required: true, tagName: 'INPUT' },
        { name: 'cityBaseId', label: 'עיר מגורים', fieldType: 'select', required: false, tagName: 'SELECT', options: [{ value: '-1', label: 'בחר עיר' }] },
        { name: 'fileBase64', label: 'קורות חיים', fieldType: 'file', required: p.isResumeMandatory === true, tagName: 'INPUT' },
        { name: 'compPositionId', label: '', fieldType: 'hidden', required: false, tagName: 'INPUT', value: id }
      ];
      built.push({
        id: id, title: title, href: JOB + id,
        dept: String(p.fieldDesc || '').replace(/\s+/g, ' ').trim(),
        city: parts.place || tag,
        date: d && d[1] !== '0001' ? d[1] + '-' + d[2] + '-' + d[3] : '',
        desc: parts.desc, req: parts.req,
        blob: JSON.stringify({ actionUrl: act, actionAttribute: act, method: 'POST', enctype: 'application/json',
          submitMechanism: 'ajax', submitEndpoint: act, fields: fields })
      });
    }
  } catch (err) {
    console.log('[analyst] no rows: ' + err);
    built = [];
  }

  var box = document.createElement('div');
  box.id = 'haide-analyst';
  box.style.display = 'none';
  for (var r = 0; r < built.length; r++) {
    var J = built[r], row = document.createElement('div');
    row.className = 'haide-job';
    var link = document.createElement('a');
    link.className = 'haide-link';
    link.href = J.href;
    link.textContent = J.title;
    row.appendChild(link);
    anInject(row, '__ai-externalJobId', 'analyst-' + J.id);
    anInject(row, '__ai-department', J.dept);
    anInject(row, '__ai-location', J.city);
    anInject(row, '__ai-publishDate', J.date);
    anInject(row, '__ai-description', J.desc, 'div');
    anInject(row, '__ai-requirements', J.req, 'div');
    anInject(row, '__ai-applicationInfo', J.blob, 'div');
    anInject(row, '__ai-formData', J.blob, 'div');
    box.appendChild(row);
  }
  document.body.appendChild(box);
}
