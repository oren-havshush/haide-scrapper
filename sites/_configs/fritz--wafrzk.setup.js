
// fritz.co.il/open-positions — jobs render in .job_row. The first ~9 come with the
// page; the rest arrive via a randomized admin-ajax "search_jobs" pool (load-more).
// Gather the FULL deduped pool here (worker awaits bare top-level await), then
// normalize each row: real title is the .description line (NOT the generic
// .job_title), full body is .requirements, location is parsed from the text.

var container = document.querySelector('#job_list') ||
                document.querySelector('.jobs_list') ||
                (document.querySelector('.job_row') ? document.querySelector('.job_row').parentNode : document.body);

var seen = {};
Array.prototype.forEach.call(document.querySelectorAll('.job_row [data-jobid]'), function (b) {
  var id = (b.getAttribute('data-jobid') || '').trim();
  if (id) seen[id] = true;
});

async function fetchPage(p) {
  try {
    var body = 'action=search_jobs&data=' + encodeURIComponent('region=&paged=' + p);
    var r = await fetch('/wp-admin/admin-ajax.php', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'x-requested-with': 'XMLHttpRequest'
      },
      body: body
    });
    var j = await r.json();
    return (j && j.html) ? j.html : '';
  } catch (e) { return ''; }
}

// The pool is small but the AJAX order is randomized + pages overlap, so cycle
// paged 1..3 several times and stop once new ids stop appearing.
var noNew = 0;
for (var attempt = 0; attempt < 24 && noNew < 5; attempt++) {
  var html = await fetchPage((attempt % 3) + 1);
  if (!html) { noNew++; continue; }
  var tmp = document.createElement('div');
  tmp.innerHTML = html;
  var rows = tmp.querySelectorAll('.job_row');
  var added = 0;
  Array.prototype.forEach.call(rows, function (row) {
    var b = row.querySelector('[data-jobid]');
    var id = b ? (b.getAttribute('data-jobid') || '').trim() : '';
    if (id && !seen[id]) { seen[id] = true; container.appendChild(row); added++; }
  });
  if (added === 0) noNew++; else noNew = 0;
  await new Promise(function (res) { setTimeout(res, 400); });
}

// --- normalize every row ---
var CITIES = [
  'אור יהודה','ראשון לציון','קרית גת','קרית מלאכי','קרית אתא','קרית ביאליק','קרית מוצקין',
  'קרית שמונה','קרית ים','תל אביב','פתח תקווה','באר שבע','בני ברק','רמת גן','רמת השרון',
  'כפר סבא','הר חוצבים','ראש העין','נס ציונה','בית שמש','מגדל העמק','מודיעין',
  'ירושלים','הרצליה','נתניה','רעננה','חיפה','אשדוד','אשקלון','חולון','רחובות','יבנה',
  'לוד','רמלה','עפולה','טבריה','נצרת','עכו','קיסריה','כנות','דימונה','עומר','גדרה',
  'חדרה','כרמיאל','צפת','אילת','יקנעם','שדרות'
].sort(function (a, b) { return b.length - a.length; });

function detectLoc(text) {
  if (!text) return '';
  var m = text.match(/מיקום\s*[:\-–]\s*([^\n.,;()]+)/);
  if (m && m[1].trim()) return m[1].trim();
  for (var i = 0; i < CITIES.length; i++) {
    if (text.indexOf(CITIES[i]) > -1) return CITIES[i];
  }
  return '';
}

Array.prototype.forEach.call(document.querySelectorAll('.job_row'), function (row) {
  var dEl = row.querySelector('.job_description .description');
  var rEl = row.querySelector('.job_requirements .requirements');
  if (dEl) { var h1 = dEl.querySelector('h4'); if (h1) h1.remove(); }
  if (rEl) { var h2 = rEl.querySelector('h4'); if (h2) h2.remove(); }

  var genericTitle = ((row.querySelector('.job_title') || {}).textContent || '').trim();
  var descLine = dEl ? (dEl.textContent || '').trim() : '';
  var body = rEl ? (rEl.textContent || '').trim() : '';

  // DROP rule: an empty requirements body means no real, scrapeable content.
  if (!body) { row.remove(); return; }

  // Real title = the specific .description line; strip a trailing "(1234)" id token.
  var title = (descLine || genericTitle).replace(/\s*\(\s*\d{2,6}\s*\)\s*$/, '').trim();
  if (!title) title = genericTitle;

  if (title && !row.querySelector('.__ai-title')) {
    var ts = document.createElement('span');
    ts.className = '__ai-title';
    ts.textContent = title;
    row.appendChild(ts);
  }

  // Prefer the city named in the title/role line (the actual job location) over a
  // city that only appears deep in the body (e.g. shuttle pickup "הסעות מ...").
  var loc = detectLoc(title) || detectLoc(descLine) || detectLoc(body);
  if (loc && !row.querySelector('.__ai-location')) {
    var ls = document.createElement('span');
    ls.className = '__ai-location';
    ls.textContent = loc;
    row.appendChild(ls);
  }

  if (!row.querySelector('.__ai-jobid')) {
    var btn = row.querySelector('.btn_upload');
    var jid = btn ? ((btn.getAttribute('data-jobid') || '').trim()) : '';
    if (jid) {
      var js = document.createElement('span');
      js.className = '__ai-jobid';
      js.textContent = 'fritz-' + jid;
      row.appendChild(js);
    }
  }

  if (!row.querySelector('.__ai-applyinfo')) {
    var as = document.createElement('span');
    as.className = '__ai-applyinfo';
    as.textContent = 'להגשת מועמדות: לחצו "העלאת קו״ח" והעלו קובץ קורות חיים (PDF) בעמוד המשרות — https://www.fritz.co.il/open-positions/';
    row.appendChild(as);
  }
});
