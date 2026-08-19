// flying-cargo.com/careers — Elementor loop grid, jobs are inline accordions.
// Injects: externalJobId (WP post id), location (region-* taxonomy), detailUrl +
// publishDate (from the open wp-json careers index). Also force-opens the
// <details> accordions so .main-text is visible text, not collapsed markup.
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
  var cities = CITIES.filter(function (c) { return titleTxt.indexOf(c) !== -1; });
  if (cities.indexOf('קריית גת') !== -1) {
    cities = cities.filter(function (c) { return c !== 'קרית גת'; });
  }
  var loc = cities.length ? cities.join(', ') : region;

  var add = function (tag, cn, text, href) {
    var el = document.createElement(tag);
    el.className = cn;
    if (text) el.textContent = text;
    if (href) el.setAttribute('href', href);
    item.appendChild(el);
  };

  // WP post id is unique per posting; the form's job_number is not (3 blank, 2 reused).
  add('span', '__ai-jobid', pid ? 'fc-' + pid : '');
  add('span', '__ai-location', loc || 'ישראל');
  if (meta && meta.date) add('span', '__ai-publishdate', String(meta.date).slice(0, 10));
  if (meta && meta.link) add('a', '__ai-detail', 'לפרטי המשרה', meta.link);
});
