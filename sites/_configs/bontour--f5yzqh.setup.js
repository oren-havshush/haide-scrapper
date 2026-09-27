// bontour.co.il — single-page accordion board, email apply, no detail pages.
// Injects: description / requirements / location / jobid / applicationInfo per <li>.
var items = document.querySelectorAll('li.drushimhead');
if (items.length) {

  function haideHash(s){var h=5381,i=s.length;while(i){h=(h*33)^s.charCodeAt(--i);}return (h>>>0).toString(36);}

  function structuredText(el){
    if (!el) return '';
    var c = el.cloneNode(true);
    c.querySelectorAll('p,div,ul,ol,li,br,h1,h2,h3,h4,h5,h6,tr')
      .forEach(function(e){ e.insertAdjacentText('afterend', '\n'); });
    return c.textContent.replace(/\u00a0/g,' ').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  }

  // ---- shared apply block, read from the page (header above the list) ----
  var head = document.querySelector('.content.drushim') || document.body;
  var mail = head.querySelector('a[href^="mailto:"]');
  var email = mail ? mail.getAttribute('href').replace(/^mailto:/i,'').split('?')[0].trim() : '';
  // The page prints the apply sentence with the address at its colon; the
  // address is lifted to the mailto: prefix below, so the sentence is trimmed.
  var instr = '';
  if (mail) {
    var box = mail.closest('div,p');
    if (box) instr = (box.textContent || '').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
    // Fleet convention leads with "mailto:<addr> - ", so the address must NOT
    // repeat inside the sentence. Strip it, then close the colon it was there
    // to introduce -- otherwise the instruction ends mid-pointer.
    if (email) instr = instr.split(email).join(' ').replace(/\s+/g,' ').trim();
    instr = instr.replace(/[\s:,\-]+$/, '').trim();
  }
  var phones = '';
  var hp = (head.textContent || '').replace(/\u00a0/g,' ');
  var pm = hp.match(/0\d{1,2}-\d{7}(?:\s*\|\s*0\d{1,2}-\d{7})*/);
  if (pm) phones = "\u05d8\u05dc' " + pm[0].replace(/\s*\|\s*/g, ', ').trim();

  // ---- location: explicit city.csv values only, anchored ----
  var CITIES = [
    { name: 'מודיעין',   re: /(?:סניפנו|סניף|ממוקמ\S*|נמצא\S*|מיקום\S*)\s+ב?מודיעין(?!\s*(?:עלית|עילית))|(?:^|[\s(,])במודיעין(?!\s*(?:עלית|עילית))/ },
    { name: 'נוף הגליל', re: /נוף\s+הגליל/ },
    { name: 'נתב"ג',     re: /נתב["\u05f4]ג/ }
  ];

  // ---- nationwide, LRN-LOC-10 step 3: only from an explicit phrase in the
  // job's OWN lines. This employer also uses "פריסה ארצית" for its branch
  // network ("לחברה חמישה סניפים בפריסה ארצית... מענה נרחב בכל אזור בארץ"), so a
  // line reading as company coverage rather than a workplace is excluded.
  // Note סניף ends in ף and סניפים in פ — different letters, both needed.
  var NATIONWIDE = /בכל רחבי הארץ|ברחבי הארץ|בכל הארץ|פריסה ארצית/;
  var COMPANY_COVERAGE = /סניפ|סניף|מענה נרחב|בכל אזור בארץ/;

  // ---- requirement-line classifier (LRN-SETUP-18) ----
  var REQ_START = /^(?:ניסיון|נסיון|ידע|רישיון|רשיון|תעודה|תעודת|בעל|בעלת|יכולת|נכונות|זמינות|שליטה|הכרה|הכרת|מגורים|דובר|דוברת|עדיפות|נדרש|רצוי|גישה|יוצא)/;
  var REQ_ANY   = /חובה|יתרון/;
  var ROLE_LINE = /דרוש/;
  var HOURS     = /\d{1,2}[:.]\d{2}\s*-\s*\d{1,2}[:.]\d{2}|\d:\d\d/;
  var PAY       = /^(?:שכר|תנאים)/;
  var CERT      = /(?:^|[\s-])סוג\s*\d/;     // "הנהלת חשבונות - סוג 1,2" (no \b: Hebrew is not \w)
  var APPLY_LN  = /לפרטים\s+נוספים|לחצו\s+כאן|קורות\s*חיים|לשלוח\s+קו|להגיש\s+מועמדות|קו["\u05f4]ח/;

  for (var k = 0; k < items.length; k++) {
    var item = items[k];
    if (item.querySelector('.__ai-jobid')) continue;

    var h4 = item.querySelector('h4');
    var title = h4 ? (h4.textContent || '').replace(/\s+/g,' ').trim() : '';
    var bodyEl = item.querySelector('.drushimin');

    var lines = structuredText(bodyEl).split('\n')
      .map(function(s){ return s.replace(/[ \t]+/g,' ').trim(); })
      .filter(function(s){ return s.length > 0; });

    var desc = [], reqs = [], applyExtra = [];
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (APPLY_LN.test(ln)) { applyExtra.push(ln.replace(/[<>\s]+$/,'')); continue; }
      var isReq = false;
      if (ln.length <= 150 && !ROLE_LINE.test(ln) && !HOURS.test(ln) && !PAY.test(ln)) {
        if (REQ_ANY.test(ln) || REQ_START.test(ln) || (ln.length <= 60 && CERT.test(ln))) isReq = true;
      }
      (isReq ? reqs : desc).push(ln);
    }

    // external apply landing page linked inside the job block
    var applyUrl = '';
    var as = bodyEl ? bodyEl.querySelectorAll('a[href]') : [];
    for (var a = 0; a < as.length; a++) {
      var hr = as[a].getAttribute('href') || '';
      // Drop the campaign tail: utm_* and fbclid are one ad-click's tracking
      // params, meaningless to an applicant and 150+ chars of the field.
      if (/^https?:\/\//i.test(hr)) { applyUrl = hr.split('?')[0].split('#')[0]; break; }
    }

    var loc = 'Unknown';
    var hay = title + '\n' + lines.join('\n');
    for (var c = 0; c < CITIES.length; c++) {
      if (CITIES[c].re.test(hay)) { loc = CITIES[c].name; break; }
    }
    // A named place outranks the nationwide phrase, so this runs last.
    if (loc === 'Unknown') {
      for (var n = 0; n < lines.length; n++) {
        if (NATIONWIDE.test(lines[n]) && !COMPANY_COVERAGE.test(lines[n])) {
          loc = 'פריסה ארצית';
          break;
        }
      }
    }

    var info = [];
    if (email) info.push('mailto:' + email + (instr ? ' - ' + instr : ''));
    else if (instr) info.push(instr);
    if (title) info.push('משרה: ' + title);
    if (phones) info.push(phones);
    // A "click here" with no link left carries nothing; keep only apply lines
    // that hold a real contact detail (a number or an address).
    var keep = applyExtra.filter(function (s) { return /\d|@/.test(s); });
    if (keep.length) info.push(keep.join(' '));
    if (applyUrl) info.push(applyUrl);

    var mk = function (cls, txt) {
      if (!txt) return;
      var s = document.createElement('span');
      s.className = cls; s.style.display = 'none'; s.textContent = txt;
      item.appendChild(s);
    };
    mk('__ai-description', desc.join('\n'));
    mk('__ai-requirements', reqs.join('\n'));
    mk('__ai-location', loc);
    mk('__ai-applicationInfo', info.join(' | '));
    mk('__ai-jobid', 'h-' + haideHash(title.toLowerCase().replace(/\s+/g,' ').trim()));
  }
}
