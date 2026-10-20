/* midrag / מידרג, careers.topmatch.co.il/midrag/index.html - Top Match "redmatch" candidate portal (the vendor;
   the employer is Midrag). The listing is filled by the portal's own read-only search, a POST to
   /CandidateAPI/api/position/Search/<affiliate GUID> with the body the page itself sends
   ({"KeyWords":"","CategoryId":[],"countryId":2,"cityId":[]}); it returns every listed position with its full HTML
   description. This script makes that ONE request (same origin, credentials 'omit', 20 s limit) and builds one
   hidden row per position in #haide-midrag. No detail-page visit, no other request; never the apply POST.
   - Id = compPositionID, printed on the job page after the title ("... (199288)"), as midrag-<n>.
   - Link = the job's own page redmatch-apply/redmatch.apply.html?compPositionID=<n> (the card's own link).
   - Title = jobTitleText as the listing shows it. Department = fieldDesc (the page's "תחום").
   - Body: the HTML description as lines (li -> bullet, images dropped). Requirement sections (דרישות, מה חשוב
     לנו, מה צריך, כישורים, מה אנחנו מחפשים, יתרון, Must Have) -> requirements, the generic label that opens them dropped;
     a later תנאים / קצת עלינו / מה עושים heading returns to description. Shared closing lines: the apply prompt
     ("תפור עליכם? הגישו מועמדות בטופס"), the "more jobs here" and Instagram teasers are dropped;
     "המשרה מיועדת לנשים ולגברים כאחד", the work-place lines and the privacy line stay in description.
   - Location: the position's location tag, read through the config's locationMap.
   - Date: activationDate (the portal's activation time, hidden on the card) as an Israel YYYY-MM-DD.
   - Never read: friendReferralRewardValue (internal referral reward), affiliate internals.
   - Apply: the job page's own form, which the page sends as JSON to Apply/ApplyToPosition/<GUID> with the job's
     compPositionId; no captcha (the affiliate's GetReCaptchaDetails says reCaptchaEnabled false); no consent box.
     Per-job screening questions (education checkboxes, one select) come only from GetPositionDetails: not read.
   - Language: a title with Hebrew, Latin or Arabic letters and no other script.
   ALL-OR-NOTHING: a failed, slow (>20 s), non-2xx, unparsable or empty answer, or a row without id or title,
   builds no row at all. */

var NL = String.fromCharCode(10);
/* fromCharCode: invisible chars written into a regex literal have disabled a guard before (CLAUDE.md). */
var ZW = new RegExp('[' + String.fromCharCode(0xFEFF, 0x200B, 0x200C, 0x200D, 0x2060, 0x200E, 0x200F) + ']', 'g');
var NBSP = new RegExp(String.fromCharCode(0x00A0), 'g');
var BULLET = String.fromCharCode(0x2022);
var OK = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}]/u;
var BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var GUID = 'B48E2596-0936-45B7-8F47-EB58E80B57AF';
var API = 'https://careers.topmatch.co.il/CandidateAPI/api/';
var JOB = 'https://careers.topmatch.co.il/midrag/redmatch-apply/redmatch.apply.html?compPositionID=';
var BLOCK = /^(P|DIV|H1|H2|H3|H4|H5|H6|UL|OL|TABLE|TR|BLOCKQUOTE|SECTION|ARTICLE)$/;
var REQ_HEAD = /^(דרישות|כישורים|מה חשוב לנו|מה צריך|מה אנחנו מחפשים|אז את מי אנחנו מחפשים|יתרון|requirements|must have|nice to have|qualifications)/i;
var REQ_LABEL = /^(דרישות( ה?תפקיד| ה?משרה)?|כישורים( וניסיון נדרש)?|מה חשוב לנו|מה צריך( בתכל'?ס)?|מה אנחנו מחפשים|אז את מי אנחנו מחפשים|requirements)\s*[:?]?$/i;
var DESC_HEAD = /^(תנאים|תנאי ה?משרה|תנאי עבודה|קצת עלינו|מה אנחנו מציעים|מה מחכה|מה עושים|מה לא עושים|תחומי אחריות|המסלול|על החברה|על התפקיד|התפקיד כולל)/;
var PLACE_LINE = /^\**\s*(המשרה|העבודה)\s+(מהמשרד|ממשרדי|במשרד|במשרה)/;
var EQUAL = /המשרה מיועדת לנשים ולגברים כאחד/;
var APPLY_PROMPT = /\s*תפור עליכם\?\s*הגישו מועמדות בטופס\S*\s*$/;
var DROP_LINE = /^(המשרה לא תפורה עליכם בול\?|לא נורא! עוד משרות באתר מידרג|רוצים לראות איך זה לעבוד איתנו\?)/;

function mdText(html) {
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
    /* an <li> whose text sits in a nested <p> yields a bare bullet line, then the text: carry the bullet over */
    if (s === BULLET) { pendingBullet = true; continue; }
    if (!s || !/[\p{L}\p{N}]/u.test(s)) continue;
    if (pendingBullet && s.indexOf(BULLET) !== 0) s = BULLET + ' ' + s;
    pendingBullet = false;
    keep.push(s);
  }
  return keep;
}

function mdSplit(lines) {
  var desc = [], req = [], inReq = false, inFoot = false;
  for (var i = 0; i < lines.length; i++) {
    var s = lines[i];
    var bare = s.replace(new RegExp('^' + BULLET + '\\s*'), '').replace(/^[*\s]+/, '');
    var isHead = s.indexOf(BULLET) !== 0 && bare.length <= 45;
    if (EQUAL.test(s) || DROP_LINE.test(bare) || APPLY_PROMPT.test(s)) inFoot = true;
    if (inFoot) {
      if (DROP_LINE.test(bare)) continue;
      s = s.replace(APPLY_PROMPT, '').trim();
      if (!/[\p{L}\p{N}]/u.test(s)) continue;
      desc.push(s);
      continue;
    }
    /* the generic label that opens the requirements is dropped (rule 2); a later one stays as a sub-heading */
    if (isHead && REQ_HEAD.test(bare)) { var opening = !inReq; inReq = true; if (opening && REQ_LABEL.test(bare)) continue; req.push(s); continue; }
    if (isHead && DESC_HEAD.test(bare)) { inReq = false; desc.push(s); continue; }
    if (PLACE_LINE.test(bare)) { desc.push(s); continue; }
    (inReq ? req : desc).push(s);
  }
  return { desc: desc.join(NL), req: req.join(NL) };
}

function mdInject(host, cls, val, tag) {
  if (!val) return;
  var e = document.createElement(tag || 'span');
  e.className = cls;
  e.textContent = val;
  host.appendChild(e);
}

if (!document.getElementById('haide-midrag')) {
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
      if (!OK.test(title) || BAD.test(title)) { console.log('[midrag] language drop ' + id + ' ' + title); continue; }
      var parts = mdSplit(mdText(p.description || p.shortDescription || ''));
      var d = /^(\d{4})-(\d{2})-(\d{2})T/.exec(String(p.activationDate || ''));
      var act = API + 'Apply/ApplyToPosition/' + GUID;
      var fields = [
        { name: 'firstName', label: 'שם פרטי', fieldType: 'text', required: true, tagName: 'INPUT' },
        { name: 'lastName', label: 'שם משפחה', fieldType: 'text', required: true, tagName: 'INPUT' },
        { name: 'email', label: 'אימייל', fieldType: 'email', required: true, tagName: 'INPUT' },
        { name: 'id', label: "מס' תעודת זהות", fieldType: 'text', required: false, tagName: 'INPUT' },
        { name: 'cellPhone', label: 'טלפון נייד', fieldType: 'tel', required: true, tagName: 'INPUT' },
        { name: 'cityBaseId', label: 'עיר מגורים', fieldType: 'select', required: false, tagName: 'SELECT', options: [{ value: '-1', label: 'בחר עיר' }] },
        { name: 'fileBase64', label: 'קורות חיים', fieldType: 'file', required: p.isResumeMandatory !== false, tagName: 'INPUT' },
        { name: 'compPositionId', label: '', fieldType: 'hidden', required: false, tagName: 'INPUT', value: id }
      ];
      built.push({
        id: id, title: title, href: JOB + id,
        dept: String(p.fieldDesc || '').replace(/\s+/g, ' ').trim(),
        city: String(p.location || p.displayLocation || '').replace(/\s+/g, ' ').trim(),
        date: d && d[1] !== '0001' ? d[1] + '-' + d[2] + '-' + d[3] : '',
        desc: parts.desc, req: parts.req,
        blob: JSON.stringify({ actionUrl: act, actionAttribute: act, method: 'POST', enctype: 'application/json',
          submitMechanism: 'ajax', submitEndpoint: act, fields: fields })
      });
    }
  } catch (err) {
    console.log('[midrag] no rows: ' + err);
    built = [];
  }

  var box = document.createElement('div');
  box.id = 'haide-midrag';
  box.style.display = 'none';
  for (var r = 0; r < built.length; r++) {
    var J = built[r], row = document.createElement('div');
    row.className = 'haide-job';
    var link = document.createElement('a');
    link.className = 'haide-link';
    link.href = J.href;
    link.textContent = J.title;
    row.appendChild(link);
    mdInject(row, '__ai-externalJobId', 'midrag-' + J.id);
    mdInject(row, '__ai-department', J.dept);
    mdInject(row, '__ai-location', J.city);
    mdInject(row, '__ai-publishDate', J.date);
    mdInject(row, '__ai-description', J.desc, 'div');
    mdInject(row, '__ai-requirements', J.req, 'div');
    mdInject(row, '__ai-applicationInfo', J.blob, 'div');
    mdInject(row, '__ai-formData', J.blob, 'div');
    box.appendChild(row);
  }
  document.body.appendChild(box);
}
