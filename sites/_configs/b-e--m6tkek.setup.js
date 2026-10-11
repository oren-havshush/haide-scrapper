// b-e.org.il jobs page: listing-only, one .jobs_list_order_wrap card per job.
// id: printed "מספר משרה" as b-e-<n> (LRN-ID-11). title: h3 without the number (rule 7).
// location (owner 2026-10-11): tag region -> city.csv region row; cues = a CLOSED place list (never a
// city.csv scan: הראל, בארי, אלונים ... are framework names) in the title (comma part, else exactly one
// whole word) and in the ad's opening line. Cue places inside the tag's area win, else the tag.
// body: דרישות -> requirements; תיאור labels dropped; "." lines dropped. Non HE/EN titles removed.
var USE_TITLE_CITY = true;
var REGION = {
  'מרכז': 'אזור מרכז',
  'תל אביב ומרכז': 'אזור מרכז',
  'חיפה חדרה והצפון': 'אזור צפון',
  'ירושלים והסביבה': 'אזור ירושלים',
  'דרום': 'אזור דרום',
  'צפון': 'אזור צפון'
};
// closed list: place as printed in the title -> [city.csv row, tags whose area contains it]
var C = ['מרכז'], TC = ['תל אביב ומרכז', 'מרכז'], J = ['ירושלים והסביבה'], S = ['דרום'], H = ['חיפה חדרה והצפון'];
var PLACE = {
  'ראשון לציון': ['ראשון לציון', C],
  'מזכרת בתיה': ['מזכרת בתיה', C],
  'חולון': ['חולון', TC],
  'קרית עקרון': ['קרית עקרון', C],
  'רחובות': ['רחובות', C],
  'רעננה': ['רעננה', TC],
  'כפר סבא': ['כפר סבא', TC],
  'פתח תקווה': ['פתח תקווה', TC],
  'יבנה': ['יבנה', C],
  'אור יהודה': ['אור יהודה', TC],
  'רמלה': ['רמלה לוד', C],            // owner 2026-10-11
  'רמת גן': ['רמת גן', TC],
  'הרצליה': ['הרצליה', TC],
  'רמת השרון': ['רמת השרון', TC],
  'יפו': ['תל אביב-יפו', TC],         // owner 2026-10-11
  'ירושלים': ['ירושלים', J],
  'מבשרת ציון': ['מבשרת ציון', J],
  'קרית גת': ['קרית גת', S],
  'אור עקיבא': ['אור עקיבא', H],
  'בנימינה': ['בנימינה', H],
  'פרדס חנה': ['פרדס חנה כרכור', H],  // owner 2026-10-11
  'תל אביב': ['תל אביב-יפו', TC],     // spelling variant, owner 2026-10-11
  'קרית אונו': ['קריית אונו', TC],    // spelling variant, owner 2026-10-11
  'נס ציונה': ['נס ציונה', C],
  'נווה ימין': ['נווה ימין', C],
  'עמק חפר': ['עמק חפר', C]          // central district: under the tag צפון it stays the tag (case 3)
};
var HE_OR_LATIN = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u;
var OTHER_SCRIPT = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;

var items = document.querySelectorAll('.jobs_list_order_wrap');
for (var i = 0; i < items.length; i++) {
  var item = items[i];
  try {
    if (item.querySelector('.__ai-title')) continue; // re-run guard

    var h3 = item.querySelector('.jobs_list_order_title');
    var rawTitle = h3 ? (h3.textContent || '').replace(/\s+/g, ' ').trim() : '';
    if (!rawTitle || !HE_OR_LATIN.test(rawTitle) || OTHER_SCRIPT.test(rawTitle)) { item.remove(); continue; }

    var numEl = item.querySelector('.details_item.date_published .det_item');
    var num = numEl ? (numEl.textContent || '').trim() : '';
    if (!/^\d+$/.test(num)) num = '';

    var title = rawTitle;
    if (num) {
      var parts = rawTitle.split(' ');
      var at = parts.indexOf(num);
      if (at >= 0) { parts.splice(at, 1); title = parts.join(' ').trim(); }
    }

    var tagEl = item.querySelector('.details_item.location .det_item');
    var tag = tagEl ? (tagEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
    var hit = null;
    if (USE_TITLE_CITY) {
      if (title.indexOf(',') >= 0) {
        var tail = title.slice(title.lastIndexOf(',') + 1).replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
        hit = PLACE[tail] || null;
      }
      if (!hit) {
        // whole words only: a space, comma or bracket on both sides (a Hebrew prefix letter blocks a match)
        var padded = ' ' + title.replace(/[,()]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
        var found = [];
        for (var pk in PLACE) if (padded.indexOf(' ' + pk + ' ') >= 0) found.push(pk);
        if (found.length === 1) hit = PLACE[found[0]];
      }
    }

    // body: lines split at <br> and at raw newlines; a line opening with <b> remembers that bold text
    var body = item.querySelector('.hp-csc-posts-box-description');
    var lines = [], cur = '', curBold = '', atStart = true;
    var kids = body ? body.childNodes : [];
    for (var k = 0; k < kids.length; k++) {
      var n = kids[k];
      if (n.nodeType === 1 && n.tagName === 'BR') { lines.push({ t: cur, b: curBold }); cur = ''; curBold = ''; atStart = true; continue; }
      if (n.nodeType !== 1 && n.nodeType !== 3) continue;
      var txt = n.textContent || '';
      if (n.nodeType === 3 && txt.indexOf('\n') >= 0) {
        var segs = txt.split('\n');
        for (var s = 0; s < segs.length; s++) {
          if (s > 0) { lines.push({ t: cur, b: curBold }); cur = ''; curBold = ''; atStart = true; }
          cur += segs[s];
          if (segs[s].trim()) atStart = false;
        }
        continue;
      }
      if (atStart && n.nodeType === 1 && (n.tagName === 'B' || n.tagName === 'STRONG') && txt.trim()) curBold = txt.trim();
      if (txt.trim()) atStart = false;
      cur += txt;
    }
    lines.push({ t: cur, b: curBold });

    var desc = [], req = [], mode = 'desc';
    for (var l = 0; l < lines.length; l++) {
      var line = lines[l].t.replace(/\s+/g, ' ').trim();
      if (!line) continue;
      var b = lines[l].b;
      if (b) {
        if (/:$/.test(b) && b.length < 40) {
          if (/^דרישות/.test(b)) mode = 'req';
          else mode = 'desc';
          if (/^(דרישות|תיאור)/.test(b)) {
            line = line.slice(line.indexOf(b) + b.length).trim();
            if (!line) continue;
          }
        } else {
          mode = 'desc'; // a bold lead-in sentence ("המתאימים ייהנו ...") closes the requirements
        }
      }
      line = line.replace(/^[.\s]*תי?אור (המסגרת|משרה|התפקיד)\s*:\s*/, ''); // label typed as text (6874, 6844)
      if (!/[\p{L}\p{N}]/u.test(line)) continue; // an empty section printed as "." (6633, 6653, ...)
      (mode === 'req' ? req : desc).push(line);
    }

    // location: title cue + the ad's opening line (desc[0], owner 2026-10-11); a listed place there counts
    // as a whole word, bare or with the prefix ב / ו / וב ("ברחובות ונס ציונה"). Keep the cue places inside
    // the tag's area (cases 1/2); none inside -> the tag (case 3); no tag -> the cue places (case 4).
    var cues = hit ? [hit] : [];
    if (USE_TITLE_CITY && desc.length) {
      var lp = ' ' + desc[0].replace(/[,.()]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
      for (var lk in PLACE) {
        if (lp.indexOf(' ' + lk + ' ') >= 0 || lp.indexOf(' ב' + lk + ' ') >= 0 || lp.indexOf(' ו' + lk + ' ') >= 0 || lp.indexOf(' וב' + lk + ' ') >= 0) cues.push(PLACE[lk]);
      }
    }
    var vals = [];
    for (var q = 0; q < cues.length; q++) {
      if ((!tag || cues[q][1].indexOf(tag) >= 0) && vals.indexOf(cues[q][0]) < 0) vals.push(cues[q][0]);
    }
    var loc = vals.length ? vals.join(', ') : (REGION[tag] || 'Unknown');

    var add = function (cls, tag2, val) {
      var el = document.createElement(tag2);
      el.className = cls;
      el.style.display = 'none';
      if (Array.isArray(val)) {
        for (var v = 0; v < val.length; v++) { var pe = document.createElement('p'); pe.textContent = val[v]; el.appendChild(pe); }
      } else { el.textContent = val; }
      item.appendChild(el);
    };
    add('__ai-title', 'span', title);
    if (num) add('__ai-id', 'span', 'b-e-' + num);
    add('__ai-location', 'span', loc);
    if (desc.length) add('__ai-description', 'div', desc);
    if (req.length) add('__ai-requirements', 'div', req);
  } catch (e) {
    // degrade per item (LRN-WRK-19)
  }
}
