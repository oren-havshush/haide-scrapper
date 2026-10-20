/* Gal HR (gal-hr.co.il), a staffing agency: its one job board ?pg=positions&CategoryID=162 (Daronet DBS, classic ASP).
   The board is a table, 20 rows a page; the pager's fnSetPage(n) submits the GET form frmPage, i.e.
   ?Area=&Occupation=&SearchJob=&JobType=&pg=positions&page=<n>&SelectedJobs=&CategoryID=162. Each row is followed by
   a hidden row "Body<id>" holding the job's full text, the same text as its job page, so no job page is visited.
   Listing-only: the script reads every page and builds one hidden row per job in #haide-galhr.
   - Fetches: credentials 'omit' (classic ASP serves one request per ASPSESSIONID at a time: 7 pages with one shared
     cookie answered at 1.2, 2.2 ... 7.4 s, without it 1.1-1.2 s each, LRN-SETUP-27), 4 in flight, 20 s limit per
     attempt (AbortController), 2 attempts, no new attempt after 40 s.
   - The number of pages is read from page 1's pager, never fixed; each page must say it IS page n (an out-of-range
     page answers with the last page), carry rows, and every page but the last must be as full as page 1.
   - Coverage: every job in the side bar "משרות חמות" (#PostionScrollerControl, all jobs of the board on every page)
     must be among the rows read; else the whole walk is read once more, then nothing is built.
   - Id = the printed "מספר משרה" as gal-hr-<n> (LRN-ID-11); the link id (?id=) is the CMS id, used only for the link
     and the apply form. Title: the row's <b>. Language gate on the title (Hebrew, Latin, Arabic).
   - Body: lines before the first "דרישות..." heading -> description, the lines after -> requirements, the heading
     itself dropped. Text as printed.
   - Location: the row's area tag (the config locationMap turns it into a city.csv row or nothing). A work-location
     cue line in the ad ("משרדי החברה ב<city>", "מיקום המשרה: <city>", ...) naming a listed city in the tag's own
     region gives that city instead; a city in another region keeps the tag. Prose is never scanned.
   - Date: none stored. The printed "תאריך עדכון" is re-stamped (18199 showed 26/5/2026 in June, 19/8/2026 now).
   - Apply: per-job blob of the site's SendCV form (POST /Positions/SubmitCV.asp, multipart), the job's CMS id in the
     hidden SelectedJobs. Required: CV file and the privacy box (not pre-checked; its label includes job offers by
     mail/WhatsApp/SMS). No captcha: recaptcha/api.js is loaded site-wide, nothing calls it.
   ALL-OR-NOTHING: any failed, timed-out, non-2xx, redirected, wrong or short page builds no row. */

var NL = String.fromCharCode(10);
var NBSP = new RegExp(String.fromCharCode(0x00A0), 'g');
var ZW = new RegExp('[' + String.fromCharCode(0xFEFF, 0x200B, 0x200C, 0x200D, 0x2060, 0x200E, 0x200F) + ']', 'g');
var OK = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}]/u;
var BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var REQ_HEAD = /^דרישות(\s\S+)?\s*[:-]$|^דרישות( התפקיד)?$/;
/* tag -> the city.csv region it stands for (the map in the config does the same; here only to compare regions) */
var TAG_REGION = { 'מרכז': 'M', 'שרון': 'S', 'שפלה': 'P', 'צפון': 'Z', 'דרום': 'D', 'ירושלים והסביבה': 'J' };
/* cities the cue reader may name, each with its city.csv region; an alias maps to the city.csv row */
var CITY_LIST = 'M:תל אביב-יפו,תל אביב=תל אביב-יפו,רמת גן,גבעתיים,בני ברק,פתח תקווה,פתח תקוה=פתח תקווה,גבעת שמואל,ראש העין,' +
  'חולון,אור יהודה,יהוד,אזור,איירפורט סיטי,ראשון לציון,רמלה לוד,לוד=רמלה לוד,רמלה=רמלה לוד,שוהם,אלעד,נס ציונה,גני תקווה,סביון;' +
  'S:הרצליה,רעננה,כפר סבא,הוד השרון,נתניה,רמת השרון,כפר יונה,אבן יהודה,קדימה צורן,קיסריה,חדרה,עמק חפר,אור עקיבא,בנימינה;' +
  'P:רחובות,יבנה,גדרה,אשדוד,אשקלון;' +
  'Z:חיפה,נצרת,עפולה,כרמיאל,טבריה,נשר,קרית אתא,קרית ביאליק,קרית מוצקין,קרית ים,עכו,נהריה,מגדל העמק,זכרון יעקב,צפת;' +
  'J:ירושלים,מבשרת ציון,מעלה אדומים,בית שמש,מודיעין;' +
  'D:באר שבע,דימונה,נתיבות,אופקים,שדרות,ערד,קרית גת';
var CITIES = [];
CITY_LIST.split(';').forEach(function (grp) {
  var reg = grp.slice(0, 1);
  grp.slice(2).split(',').forEach(function (c) {
    var p = c.split('=');
    CITIES.push([p[0], p[1] || p[0], reg]);
  });
});
CITIES.sort(function (a, b) { return b[0].length - a[0].length; });
var CUE = /(משרדי החברה|משרדי המשרד|משרדינו|המשרד ממוקם|המשרדים ממוקמים|המשרה ממוקמת|מיקום המשרה|מקום העבודה)\s*:?\s*/;

function aiClean(t) {
  var lines = String(t || '').replace(ZW, '').replace(NBSP, ' ').split(NL), out = [];
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i].replace(/[ \t\r]+/g, ' ').trim();
    if (!l) { if (out.length && out[out.length - 1] !== '') out.push(''); continue; }
    out.push(l);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  while (out.length && out[0] === '') out.shift();
  return out.join(NL);
}

/* a cue line naming a listed city right after the cue (optionally after "ב"); [cityRow, region] or null */
function cueCity(text) {
  var lines = text.split(NL);
  for (var i = 0; i < lines.length; i++) {
    var m = CUE.exec(lines[i]);
    if (!m) continue;
    var rest = lines[i].slice(m.index + m[0].length).replace(/^ב-?/, '');
    for (var k = 0; k < CITIES.length; k++) {
      var c = CITIES[k];
      if (rest.indexOf(c[0]) === 0 && !/[א-תA-Za-z]/.test(rest.charAt(c[0].length))) return [c[1], c[2]];
    }
  }
  return null;
}

function aiInject(host, cls, val, tag) {
  if (!val) return;
  var s = document.createElement(tag || 'span');
  s.className = cls;
  s.textContent = val;
  host.appendChild(s);
}

if (!document.getElementById('haide-galhr') && document.querySelector('table.jobSearchTable')) {
  var built = [];
  try {
    var T0 = Date.now(), ATTEMPT_MS = 20000, ATTEMPTS = 2, LAST_START_MS = 40000, IN_FLIGHT = 4, MAX_PAGES = 40;
    var PAGE_URL = function (n) {
      return location.origin + '/?Area=&Occupation=&SearchJob=&JobType=&pg=positions&page=' + n + '&SelectedJobs=&CategoryID=162';
    };
    var readPage = async function (n) {
      var url = PAGE_URL(n), why = '';
      for (var t = 0; t < ATTEMPTS; t++) {
        if (Date.now() - T0 > LAST_START_MS) { why = 'out of time'; break; }
        var ctl = new AbortController(), timer = setTimeout(function () { ctl.abort(); }, ATTEMPT_MS);
        try {
          var r = await fetch(url, { credentials: 'omit', cache: 'no-store', signal: ctl.signal });
          if (!r.ok || r.redirected) { why = 'HTTP ' + r.status + (r.redirected ? ' redirected' : ''); continue; }
          var d = new DOMParser().parseFromString(await r.text(), 'text/html');
          var cur = d.querySelector('ol.dbsPages .dbsCurrentPage');
          var curN = cur ? parseInt(cur.textContent, 10) : (d.querySelector('ol.dbsPages') ? 0 : 1);
          if (curN !== n) { why = 'page says ' + curN; continue; }
          var last = curN, pl = d.querySelectorAll('ol.dbsPages a[href*="fnSetPage("]');
          for (var q = 0; q < pl.length; q++) {
            var pm = /fnSetPage\((\d+)\)/.exec(pl[q].getAttribute('href') || '');
            if (pm && +pm[1] > last) last = +pm[1];
          }
          var rows = [], trs = d.querySelectorAll('table.jobSearchTable tr');
          for (var x = 0; x < trs.length; x++) {
            var box = trs[x].querySelector('input[onclick*="AddRemoveSelectedJobs"]');
            if (!box) continue;
            var im = /AddRemoveSelectedJobs\(this,\s*(\d+)\)/.exec(box.getAttribute('onclick') || '');
            var tEl = trs[x].querySelector('td[headers~="JobTitle"] a');
            var nEl = trs[x].querySelector('td[headers~="JobNumber"]');
            var aEl = trs[x].querySelector('td[headers~="JobArea"]');
            var body = im ? d.getElementById('Body' + im[1]) : null;
            if (!im || !tEl || !nEl || !body || !body.cells || body.cells.length < 2) throw new Error('row ' + x + ' of page ' + n + ' is not a job row');
            rows.push({ cms: im[1], title: tEl.textContent, href: tEl.getAttribute('href') || '', num: (nEl.textContent || '').trim(),
              area: aEl ? aEl.textContent : '', cell: body.cells[1] });
          }
          if (!rows.length) { why = 'no job row'; continue; }
          var tick = [], ta = d.querySelectorAll('#PostionScrollerControl a[href*="pg=position"]');
          for (var y = 0; y < ta.length; y++) {
            var tm = /[?&]id=(\d+)/.exec(ta[y].getAttribute('href') || '');
            if (tm) tick.push(tm[1]);
          }
          return { n: n, last: last, rows: rows, tick: tick };
        } catch (e) {
          if (e && /not a job row/.test(String(e.message))) throw e;
          why = e && e.name === 'AbortError' ? 'no answer within ' + ATTEMPT_MS / 1000 + ' s' : 'network error ' + e;
        } finally {
          clearTimeout(timer);
        }
      }
      throw new Error('page ' + n + ' failed (' + why + ')');
    };
    var walk = async function () {
      var first = await readPage(1);
      if (first.last > MAX_PAGES) throw new Error('pager says ' + first.last + ' pages');
      var pages = [first], todo = [];
      for (var n = 2; n <= first.last; n++) todo.push(n);
      var next = 0;
      var worker = async function () {
        while (next < todo.length) { var p = await readPage(todo[next++]); pages.push(p); }
      };
      var ws = [];
      for (var w = 0; w < IN_FLIGHT; w++) ws.push(worker());
      await Promise.all(ws);
      pages.sort(function (a, b) { return a.n - b.n; });
      for (var i = 0; i < pages.length; i++) {
        if (pages[i].last !== first.last && !(i === pages.length - 1 && pages[i].last === pages[i].n)) throw new Error('page ' + pages[i].n + ' disagrees on the page count');
        if (i < pages.length - 1 && pages[i].rows.length !== first.rows.length) throw new Error('page ' + pages[i].n + ' is short: ' + pages[i].rows.length + ' rows');
      }
      var all = [], have = {};
      pages.forEach(function (p) { p.rows.forEach(function (r) { all.push(r); have[r.cms] = 1; }); });
      var missing = first.tick.filter(function (id) { return !have[id]; });
      return { rows: all, missing: missing, tick: first.tick.length };
    };
    var res = await walk();
    if (!res.tick) throw new Error('no side-bar job list on page 1');
    if (res.missing.length) {
      console.log('[gal-hr] side-bar jobs not on the pages (' + res.missing.join(',') + '), reading once more');
      res = await walk();
      if (res.missing.length) throw new Error('side-bar jobs still not on the pages: ' + res.missing.join(','));
    }
    for (var j = 0; j < res.rows.length; j++) {
      var R = res.rows[j];
      var title = R.title.replace(NBSP, ' ').replace(/\s+/g, ' ').trim();
      if (!title || !OK.test(title) || BAD.test(title)) { console.log('[gal-hr] language gate dropped ' + R.num + ': ' + title); continue; }
      if (!/^\d+$/.test(R.num)) throw new Error('row ' + R.cms + ' has no printed job number');
      /* line breaks come only from <br>: the source newline after each <br> is whitespace, not a second break */
      var c = R.cell.cloneNode(true), tw = c.ownerDocument.createTreeWalker(c, 4), tn;
      while ((tn = tw.nextNode())) tn.data = tn.data.replace(/\s+/g, ' ');
      var br = c.querySelectorAll('br');
      for (var b = 0; b < br.length; b++) br[b].replaceWith(NL);
      var lines = aiClean(c.textContent).split(NL), desc = [], req = [], inReq = false;
      for (var l = 0; l < lines.length; l++) {
        if (!inReq && lines[l].length <= 25 && REQ_HEAD.test(lines[l])) { inReq = true; continue; }
        (inReq ? req : desc).push(lines[l]);
      }
      var dText = aiClean(desc.join(NL)), rText = aiClean(req.join(NL));
      var tag = R.area.replace(NBSP, ' ').replace(/\s+/g, ' ').trim(), loc = tag;
      var cc = cueCity(dText + NL + rText);
      if (cc && (TAG_REGION[tag] === cc[1] || !TAG_REGION[tag])) loc = cc[0];
      var act = location.origin + '/Positions/SubmitCV.asp';
      var fields = [
        { name: 'SenderFName', label: 'שם פרטי', fieldType: 'text', required: false, tagName: 'INPUT' },
        { name: 'SenderLName', label: 'שם משפחה', fieldType: 'text', required: false, tagName: 'INPUT' },
        { name: 'Phone', label: 'טלפון', fieldType: 'text', required: false, tagName: 'INPUT' },
        { name: 'CvEmail', label: 'דואר אלקטרוני', fieldType: 'text', required: false, tagName: 'INPUT' },
        { name: 'comments', label: 'הערות', fieldType: 'textarea', required: false, tagName: 'TEXTAREA' },
        { name: 'cv', label: 'קורות חיים (עד 500K)', fieldType: 'file', required: true, tagName: 'INPUT' },
        { name: 'PrivacyPolicy', label: 'מאשר/ת את מדיניות הפרטיות ותנאי השימוש כולל קבלת הצעות עבודה במייל/וואטסאפ/SMS.', fieldType: 'checkbox', required: true, tagName: 'INPUT', value: '1' },
        { name: 'SelectedJobs', label: '', fieldType: 'hidden', required: false, tagName: 'INPUT', value: R.cms },
        { name: 'CategoryID', label: '', fieldType: 'hidden', required: false, tagName: 'INPUT', value: '162' }
      ];
      built.push({
        id: 'gal-hr-' + R.num, title: title, href: new URL(R.href, location.origin).href, loc: loc, desc: dText, req: rText,
        blob: JSON.stringify({ actionUrl: act, actionAttribute: act, method: 'POST', enctype: 'multipart/form-data', fields: fields })
      });
    }
    if (!built.length) throw new Error('no job kept');
  } catch (err) {
    console.log('[gal-hr] no rows: ' + err);
    built = [];
  }

  var hold = document.createElement('div');
  hold.id = 'haide-galhr';
  hold.style.display = 'none';
  for (var z = 0; z < built.length; z++) {
    var J = built[z], row = document.createElement('div');
    row.className = 'haide-job';
    var link = document.createElement('a');
    link.className = 'haide-link';
    link.href = J.href;
    link.textContent = J.title;
    row.appendChild(link);
    aiInject(row, '__ai-externalJobId', J.id);
    aiInject(row, '__ai-location', J.loc);
    aiInject(row, '__ai-description', J.desc, 'div');
    aiInject(row, '__ai-requirements', J.req, 'div');
    aiInject(row, '__ai-applicationInfo', J.blob, 'div');
    aiInject(row, '__ai-formData', J.blob, 'div');
    hold.appendChild(row);
  }
  document.body.appendChild(hold);
}
