// flying-cargo.com/careers — Elementor loop grid, jobs are inline accordions.
// Injects: externalJobId (WP post id), location (branch city / region-* taxonomy),
// detailUrl + publishDate (from the open wp-json careers index), the per-job
// job_number, and a per-job apply blob. Also force-opens the <details>
// accordions so .main-text is visible text, not collapsed markup.
document.querySelectorAll('details').forEach(function (d) { d.setAttribute('open', ''); });

var byId = {};
try {
  var res = await fetch('/wp-json/wp/v2/careers?per_page=100&_fields=id,link,date', { credentials: 'omit' });
  if (res.ok) {
    (await res.json()).forEach(function (p) { byId[String(p.id)] = p; });
  }
} catch (e) { /* wp-json unavailable — detailUrl/publishDate simply stay empty */ }

var REGIONS = { 'region-center': 'מרכז', 'region-north': 'צפון', 'region-south': 'דרום' };

// Branch cities, matched against the TITLE only. Descriptions also name cities,
// but there they are usually shuttle pickup points ("הסעות מהערים: רחובות, רמלה
// ולוד") rather than the job's site — matching those would mislocate the job.
var CITIES = ['צריפין', 'כנות', 'קריית גת', 'קרית גת', 'נתב"ג', 'כרמיאל', 'עין כרמל', 'רחובות'];

// Every emitted location must exist VERBATIM in "CSV files/city.csv"
// (scripts/verify-location-csv.ts) — the gazetteer and locationFallback only fill an
// EMPTY location, they never correct a wrong one. צריפין is in neither the CSV nor the
// worker gazetteer; the site is in the באר יעקב area, which is the canonical entry.
var CANON = { 'צריפין': 'באר יעקב', 'קריית גת': 'קרית גת' };

// Elementor Pro submits over AJAX, not to the form's action attribute.
var ACTION_URL = location.origin + '/wp-admin/admin-ajax.php';

document.querySelectorAll('div.e-loop-item').forEach(function (item) {
  if (item.querySelector('.__ai-jobid')) return; // re-run guard

  var cls = item.className || '';
  var pid = (cls.match(/(?:^|\s)post-(\d+)/) || [])[1] || '';
  var regions = cls.match(/region-[a-z-]+/g) || [];
  var region = regions.map(function (r) { return REGIONS[r] || ''; }).filter(Boolean).join(', ');
  var meta = byId[pid];

  // Prefer the branch city named in the title; fall back to the region-* taxonomy.
  var titleEl = item.querySelector('h3.e-n-accordion-item-title-text');
  var titleTxt = titleEl ? (titleEl.textContent || '') : '';
  var cities = CITIES.filter(function (c) { return titleTxt.indexOf(c) !== -1; })
    .map(function (c) { return CANON[c] || c; })
    .filter(function (c, i, a) { return a.indexOf(c) === i; }); // both גת spellings collapse
  var loc = cities.length ? cities.join(', ') : region;

  // Split the single .main-text blob into description/requirements. There is no DOM
  // boundary — "דרישות:" is just a line inside the prose — so this runs the LRN-SETUP-10
  // two-bucket state machine over LINES (the tigbur variant), not a tail-split: these ads
  // put benefits and hours AFTER the requirements list ("שעות עבודה 08:00-17:00",
  // "תנאים מעולים..."), and "everything after the heading" files those as requirements.
  // Every line lands in exactly one bucket, so non-overlap holds by construction.
  // REQ is anchored to a line start so the body bullet "• ליקוט פריטים לפי דרישת המערכת."
  // (דרישת, no colon) can't be mistaken for the heading. DESC deliberately matches
  // תנאים/תנאי הע... but NOT "תנאי סף", which is requirements-class.
  var REQ_HEAD = /^\s*[•\-]?\s*(דרישות(\s+ה?תפקיד)?|כישורים|תנאי\s*סף|מי\s*מתאים|מה\s*אנחנו\s*מחפשים)\s*:?\s*(.*)$/;
  var DESC_HEAD = /^\s*[•\-]?\s*(שעות\s*עבודה|תנאים|הטבות|מה\s*אנחנו\s*מציעים|אנחנו\s*מציעים|היקף|שכר|מיקום|תיאור\s*התפקיד|המשרה\s*כוללת)/;

  var mt = item.querySelector('.main-text');
  var full = mt ? (mt.innerText || mt.textContent || '') : '';
  var dLines = [], rLines = [], bucket = 'd', sawReq = false;
  full.split('\n').forEach(function (line) {
    var m = line.match(REQ_HEAD);
    if (m) {
      bucket = 'r'; sawReq = true;
      var tail = (m[3] || '').trim();      // label and content can share one line
      if (tail) rLines.push(tail);
      return;                               // drop the label itself
    }
    if (bucket === 'r' && DESC_HEAD.test(line)) bucket = 'd';
    (bucket === 'r' ? rLines : dLines).push(line);
  });

  var desc = dLines.join('\n').trim();
  var reqs = rLines.join('\n').trim();
  // Never trade a real description for a split — if the heading opens the blob there is
  // nothing to keep on the description side, so leave the text whole.
  if (!sawReq || desc.length < 40) { desc = full.trim(); reqs = ''; }

  // Serialize THIS card's own apply form. The site-level _meta.formCapture cannot
  // carry form_fields[job_number], which differs per posting and is what routes an
  // application to the right role.
  var form = item.querySelector('form.elementor-form');
  var jobNumber = '';
  var fields = [];
  if (form) {
    form.querySelectorAll('input, select, textarea').forEach(function (el) {
      var type = el.type || el.tagName.toLowerCase();
      if (type === 'submit' || type === 'button' || type === 'reset' || type === 'image') return;
      var name = el.getAttribute('name') || '';
      if (name === 'form_fields[job_number]') jobNumber = el.value || '';

      // The site reuses id attrs across inputs (form-field-name / form-field-email are
      // each on two fields), so label[for=...] resolves wrong. Prefer the placeholder,
      // then the select's prompt option, then the field-group's own label.
      var label = '';
      if (type !== 'hidden') {
        var group = el.closest('.elementor-field-group');
        var groupLabel = group ? group.querySelector('label') : null;
        label = el.getAttribute('placeholder')
          || (el.tagName === 'SELECT' && el.options.length ? el.options[0].text : '')
          || (groupLabel ? (groupLabel.textContent || '').trim() : '');
        if (type === 'file') label = label + ' (קורות חיים)';
      }

      var f = {
        name: name,
        label: label,
        fieldType: el.tagName === 'SELECT' ? 'select' : type,
        required: !!el.required,
        tagName: el.tagName.toLowerCase(),
      };
      if (type === 'hidden') f.value = el.value || '';
      if (el.tagName === 'SELECT') {
        f.options = [].map.call(el.options, function (o) { return { value: o.value, label: o.text }; });
      }
      fields.push(f);
    });
  }

  var add = function (tag, cn, text, href) {
    var el = document.createElement(tag);
    el.className = cn;
    if (text) el.textContent = text;
    if (href) el.setAttribute('href', href);
    item.appendChild(el);
  };

  // WP post id is unique per posting; job_number is blank on 3 of 38 cards.
  add('span', '__ai-jobid', pid ? 'fc-' + pid : '');
  add('span', '__ai-location', loc || 'פריסה ארצית'); // canonical nationwide value (LRN-SETUP-11)
  add('span', '__ai-jobnumber', jobNumber);
  add('span', '__ai-description', desc);
  if (reqs) add('span', '__ai-requirements', reqs);
  if (fields.length) {
    add('span', '__ai-applicationInfo', JSON.stringify({
      actionUrl: ACTION_URL, method: 'POST', fields: fields,
    }));
  }
  if (meta && meta.date) add('span', '__ai-publishdate', String(meta.date).slice(0, 10));
  if (meta && meta.link) add('a', '__ai-detail', 'לפרטי המשרה', meta.link);
});
