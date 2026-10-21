/* ISRACARD ישראכרט, careers site on Wix Studio (www.isracard.co.il/career/jobs). Listing-only, no fetch.
   - Jobs: the listing's own server-rendered data, read in the page: the wix-warmup-data JSON holds the JobObject
     dataset the repeater shows (itemIds in listing order, datasetSize total/loaded) with every job's full text.
     ALL-OR-NOTHING: no row at all unless the dataset is complete (total = loaded = items), the page heading
     "משרות פתוחות (N משרות)" says N = total, every item has its card (link /career/job/<n>, title label, region)
     and every record is consistent (JobNumber = the number in its link).
   - Id: the printed job number ("(מספר משרה: N)" on the job page = JobNumber = the link number) as isracard-<n>
     (addsite3 id rule, LRN-ID-11). Title: the record's title (the page adds the number only on the job page).
   - Department: the division printed after the last " – " of the card's title label.
   - Body: JobDescription -> description, JobRequires -> requirements, as the employer split them, line breaks kept.
   - Location: the card's region tag (מרכז / השרון / דרום) through the config locationMap. A city from the closed
     list below, named in the title or on a line that places the work (מוקד / מגייס / מגיעה / לעבודה / ממוקם /
     מיקום / המשרה / העבודה + "ב<city>"), replaces the tag when it lies inside the tag's area (four-case rule);
     a city outside it keeps the tag. Ruppin (מכללת/קמפוס רופין) is no city.csv row: the tag stays.
   - Apply: the job page's form (first name, last name, mobile, email, CV .pdf/.doc/.docx, no captcha, no consent
     box) is sent by the page's Velo code as POST /career/_webMethods/backend/serviceWrapper.web.js/sendCv1.ajax
     with the positional arguments [first, last, phone, email, JobNumber, "קורות חיים <first> <last>", file base64,
     file extension]. Stored as a per-job blob with the job number filled in (LRN-FORM-17).
   - Language gate: Hebrew, English or Arabic titles only. Undated: no date is printed (AdamUpdateDate and
     _createdDate are CMS times). */
if (!document.getElementById('haide-isracard')) {
  var built = [];
  var NL = String.fromCharCode(10);
  /* fromCharCode, never escapes in this file (CLAUDE.md): NUL and U+FFFD (two division names carry a NUL byte in
     the server HTML, which the browser reads as U+FFFD), bidi embeds/marks, zero-width, BOM */
  var JUNK = new RegExp('[' + String.fromCharCode(0, 0xFFFD, 0x202A, 0x202B, 0x202C, 0x202D, 0x202E, 0x200E, 0x200F, 0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF) + ']', 'g');
  var NBSP = new RegExp(String.fromCharCode(0xA0), 'g');
  var DASH = ' ' + String.fromCharCode(0x2013) + ' ';
  var OK = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}]/u;
  var BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
  var BASE = 'https://www.isracard.co.il/career';
  var SEND = BASE + '/_webMethods/backend/serviceWrapper.web.js/sendCv1.ajax';
  /* card components (Wix comp ids of the jobs repeater) */
  var C_ITEM = 'comp-mn34pln4__', C_LABEL = 'comp-mn36pcb9__', C_AREA = 'comp-mn36shyv__';
  /* closed city list: the label the locationMap knows, and the site region tags whose area holds it */
  var CITIES = [['בני ברק', ['מרכז']], ['רחובות', ['דרום']]];
  var CUE = /(מוקד|מגייס|מגיעה|לעבודה|ממוקם|מיקום|המשרה|העבודה)/;
  var cl = function (t) { return String(t == null ? '' : t).replace(JUNK, '').replace(NBSP, ' ').replace(/[ \t]+/g, ' ').trim(); };
  var body = function (t) {
    var out = [], ls = String(t || '').replace(/\r/g, '').split(NL);
    for (var i = 0; i < ls.length; i++) { var l = cl(ls[i]); if (l || (out.length && out[out.length - 1])) out.push(l); }
    while (out.length && !out[out.length - 1]) out.pop();
    return out.join(NL);
  };
  var named = function (line, city) {
    return new RegExp('(^|[^א-ת])(ו?ב|ל)?' + city + '(?![א-ת])').test(line);
  };
  try {
    var ws = document.getElementById('wix-warmup-data');
    if (!ws) throw new Error('no warmup data');
    var store = JSON.parse(ws.textContent).appsWarmupData.dataBinding.dataStore;
    var recs = store.recordsByCollectionId.JobObject;
    if (!recs) throw new Error('no JobObject records');
    var sets = [], dsi = store.recordInfosByDatasetId;
    for (var k in dsi) {
      var ids0 = dsi[k].itemIds || [];
      if (ids0.length && ids0.every(function (x) { return Object.prototype.hasOwnProperty.call(recs, x); })) sets.push(dsi[k]);
    }
    if (sets.length !== 1) throw new Error(sets.length + ' JobObject datasets');
    var ids = sets[0].itemIds, size = sets[0].datasetSize || {};
    if (size.total !== ids.length || size.loaded !== ids.length) throw new Error('dataset ' + ids.length + ' items, total ' + size.total + ', loaded ' + size.loaded);
    var hm = cl(document.body.innerText).match(/משרות פתוחות\s*\(\s*(\d+)\s*משרות\s*\)/);
    if (!hm || +hm[1] !== ids.length) throw new Error('heading says ' + (hm && hm[1]) + ', dataset ' + ids.length);
    var nums = {};
    for (var x = 0; x < ids.length; x++) {
      var R = recs[ids[x]], n = R.JobNumber;
      if (!(n > 0) || Math.floor(n) !== n || R['link-mshrvt-title'] !== '/job/' + n) throw new Error('record ' + ids[x] + ': number ' + n + ', link ' + R['link-mshrvt-title']);
      if (nums[n]) throw new Error('job number ' + n + ' twice');
      nums[n] = 1;
      var lab = document.getElementById(C_LABEL + ids[x]), area = document.getElementById(C_AREA + ids[x]);
      if (!document.getElementById(C_ITEM + ids[x]) || !lab || !area) throw new Error('no card for ' + n);
      var href = lab.getAttribute('href') || '';
      if (href !== BASE + '/job/' + n) throw new Error('card link ' + href + ' for ' + n);
      var title = cl(R.title), label = cl(lab.getAttribute('aria-label') || lab.textContent);
      if (!title || label.indexOf(title) !== 0) throw new Error('title ' + n + ': ' + title + ' / ' + label);
      if (!OK.test(title) || BAD.test(title)) { console.log('[isracard] language gate drops ' + n + ' ' + title); continue; }
      var dep = label.lastIndexOf(DASH) >= title.length ? cl(label.slice(label.lastIndexOf(DASH) + DASH.length)) : '';
      var tag = cl(area.textContent);
      if (!tag) throw new Error('no region for ' + n);
      var desc = body(R.JobDescription), req = body(R.JobRequires);
      /* places named on cue lines: the title, then text lines that place the work */
      var lines = [title].concat((desc + NL + req).split(NL).filter(function (l) { return CUE.test(l); }));
      var found = [];
      for (var c = 0; c < CITIES.length; c++) {
        for (var y = 0; y < lines.length; y++) if (named(lines[y], CITIES[c][0])) { found.push(CITIES[c]); break; }
      }
      var inside = found.filter(function (f) { return f[1].indexOf(tag) >= 0; });
      var loc = found.length && inside.length === found.length ? inside.map(function (f) { return f[0]; }).join(' | ') : tag;
      var fields = [
        { name: 'fNameInput', label: 'שם פרטי', fieldType: 'text', required: true, tagName: 'INPUT' },
        { name: 'lNameInput', label: 'שם משפחה', fieldType: 'text', required: true, tagName: 'INPUT' },
        { name: 'phoneInput', label: 'טלפון נייד', fieldType: 'tel', required: true, tagName: 'INPUT' },
        { name: 'emailInput', label: 'אימייל', fieldType: 'email', required: true, tagName: 'INPUT' },
        { name: 'jobNumber', label: 'מספר משרה', fieldType: 'hidden', required: true, tagName: 'INPUT', value: String(n), prefilled: true },
        { name: 'cv', label: 'העלאת קורות חיים', fieldType: 'file', required: true, tagName: 'INPUT', accept: '.pdf,.doc,.docx' }
      ];
      built.push({
        id: 'isracard-' + n, title: title, href: href, dept: dep, loc: loc, desc: desc, req: req,
        blob: JSON.stringify({ actionUrl: SEND, actionAttribute: '', method: 'POST', enctype: 'application/json', fields: fields })
      });
    }
    if (!built.length) throw new Error('no job kept');
    console.log('[isracard] ' + built.length + ' of ' + ids.length + ' jobs');
  } catch (err) {
    console.log('[isracard] no rows: ' + err);
    built = [];
  }
  var box = document.createElement('div');
  box.id = 'haide-isracard';
  box.style.display = 'none';
  for (var r = 0; r < built.length; r++) {
    var J = built[r], row = document.createElement('div');
    row.className = 'haide-job';
    var a1 = document.createElement('a');
    a1.className = 'haide-link';
    a1.href = J.href;
    a1.textContent = J.title;
    row.appendChild(a1);
    var put = function (cls, val, tag) { if (!val) return; var s = document.createElement(tag || 'span'); s.className = cls; s.textContent = val; row.appendChild(s); };
    put('__ai-externalJobId', J.id);
    put('__ai-department', J.dept);
    put('__ai-location', J.loc);
    put('__ai-description', J.desc, 'div');
    put('__ai-requirements', J.req, 'div');
    put('__ai-applicationInfo', J.blob, 'div');
    put('__ai-formData', J.blob, 'div');
    box.appendChild(row);
  }
  document.body.appendChild(box);
}
