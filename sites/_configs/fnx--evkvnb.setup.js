/* fnx / הפניקס חברה לביטוח, www.fnx.co.il/career/open-positions - Nuxt 2 (Vue) front end over Umbraco.
   The server renders every open position into the page's own window.__NUXT__ payload
   (state.career.positions, already filtered to marketingSite = Y, the set the listing shows as
   "נמצאו N משרות"); the 10-per-page pager and the filters work on that array client-side. So this
   script reads the payload: NO fetch, no pagination, no detail-page visit.
   - Id = the position code (8 digits, the job page's own path /career/open-positions/<code>/; not
     printed on the page) as fnx-<code>.
   - Title = positionDesc with backslashes removed, as the page's own getter does.
   - Body: positionText lines ("התפקיד כולל") -> description; positionReqText lines ("דרישות התפקיד")
     -> requirements; the employer's own two sections, kept as sectioned. Empty lines dropped.
     displayOrgUnit ("תחום") -> department; manningTypeText (משרה קבועה / זמנית) -> employmentType.
   - Location: positionLocationText (the site's tag), read through the config's locationMap.
   - Date: lastModifiedOn is printed as "תאריך עדכון אחרון", a last-edit time: not stored (LRN-AGE-5).
   - Apply: the job page's form (first/last name, phone, email, 1-6 CV files, privacy box: required and
     NOT pre-checked). The page uploads each file to /middle/api/v1/info/bleach/upload and then POSTs
     JSON to /middle/api/v1/info/callback/mailSenderCallback with the subject
     "משרת <title> קוד משרה <code> " (the job is named there), with an x-api-key header from the page
     config and the AWS WAF cookie the browser earns. The blob is that request, per job.
   - Language: a title with Hebrew, Latin or Arabic letters and no other script.
   ALL-OR-NOTHING: no payload, an empty array, or a row with no code or title builds no row. */

var NL = String.fromCharCode(10);
/* fromCharCode: invisible chars written into a regex literal have disabled a guard before (CLAUDE.md). */
var ZW = new RegExp('[' + String.fromCharCode(0xFEFF, 0x200B, 0x200C, 0x200D, 0x2060, 0x200E, 0x200F) + ']', 'g');
var NBSP = new RegExp(String.fromCharCode(0x00A0), 'g');
var OK = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}]/u;
var BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var BASE = 'https://www.fnx.co.il/career/open-positions/';
var ACT = 'https://www.fnx.co.il/middle/api/v1/info/callback/mailSenderCallback';

function fnxLine(t) {
  return String(t == null ? '' : t).replace(ZW, '').replace(NBSP, ' ').replace(/[ \t]+/g, ' ').trim();
}
function fnxLines(arr) {
  var out = [];
  if (!(arr instanceof Array)) return '';
  for (var i = 0; i < arr.length; i++) {
    var s = fnxLine(arr[i] && arr[i].line);
    if (s) out.push(s);
  }
  return out.join(NL);
}
function fnxInject(host, cls, val, tag) {
  if (!val) return;
  var s = document.createElement(tag || 'span');
  s.className = cls;
  s.textContent = val;
  host.appendChild(s);
}

if (!document.getElementById('haide-fnx')) {
  var built = [];
  try {
    var N = window.__NUXT__;
    var P = N && N.state && N.state.career && N.state.career.positions;
    if (!(P instanceof Array) || P.length === 0) throw new Error('no positions in __NUXT__.state.career');
    for (var n = 0; n < P.length; n++) {
      var p = P[n] || {};
      var code = String(p.positionCode == null ? '' : p.positionCode).trim();
      var title = fnxLine(String(p.positionDesc == null ? '' : p.positionDesc).replace(/\\/g, ''));
      if (!/^\d{5,12}$/.test(code) || !title) throw new Error('row ' + n + ' has no code or title');
      if (!OK.test(title) || BAD.test(title)) { console.log('[fnx] language drop ' + code + ' ' + title); continue; }
      var subject = 'משרת ' + title + ' קוד משרה ' + code + ' ';
      var fields = [
        { name: 'firstName', label: 'שם פרטי', fieldType: 'text', required: true, tagName: 'INPUT' },
        { name: 'lastName', label: 'שם משפחה', fieldType: 'text', required: true, tagName: 'INPUT' },
        { name: 'phone', label: 'מספר טלפון', fieldType: 'tel', required: true, tagName: 'INPUT' },
        { name: 'email', label: 'כתובת מייל', fieldType: 'email', required: true, tagName: 'INPUT' },
        { name: 'file', label: 'צירוף קורות חיים', fieldType: 'file', required: true, tagName: 'INPUT', accept: '.pdf,.doc,.docx', multiple: true },
        { name: 'confirm-terms', label: 'בכפוף להנחיות מדיניות שמירת הפרטיות', fieldType: 'checkbox', required: true, tagName: 'INPUT' },
        { name: 'mailType', label: '', fieldType: 'hidden', required: false, tagName: 'INPUT', value: 'Career' },
        { name: 'subject', label: '', fieldType: 'hidden', required: false, tagName: 'INPUT', value: subject }
      ];
      built.push({
        code: code, title: title, href: BASE + code + '/',
        dept: fnxLine(p.displayOrgUnit), emp: fnxLine(p.manningTypeText), city: fnxLine(p.positionLocationText),
        desc: fnxLines(p.positionText), req: fnxLines(p.positionReqText),
        blob: JSON.stringify({ actionUrl: ACT, actionAttribute: ACT, method: 'POST', enctype: 'application/json',
          submitMechanism: 'ajax', submitEndpoint: ACT, fields: fields })
      });
    }
  } catch (err) {
    console.log('[fnx] no rows: ' + err);
    built = [];
  }

  var box = document.createElement('div');
  box.id = 'haide-fnx';
  box.style.display = 'none';
  for (var r = 0; r < built.length; r++) {
    var J = built[r], row = document.createElement('div');
    row.className = 'haide-job';
    var link = document.createElement('a');
    link.className = 'haide-link';
    link.href = J.href;
    link.textContent = J.title;
    row.appendChild(link);
    fnxInject(row, '__ai-externalJobId', 'fnx-' + J.code);
    fnxInject(row, '__ai-department', J.dept);
    fnxInject(row, '__ai-employmentType', J.emp);
    fnxInject(row, '__ai-location', J.city);
    fnxInject(row, '__ai-description', J.desc, 'div');
    fnxInject(row, '__ai-requirements', J.req, 'div');
    fnxInject(row, '__ai-applicationInfo', J.blob, 'div');
    fnxInject(row, '__ai-formData', J.blob, 'div');
    box.appendChild(row);
  }
  document.body.appendChild(box);
}
