// kidum.com/career — WordPress `career` CPT in an Elementor loop grid: every card on
// one page (/page/2/ repeats page 1), each linking to a detail page fetched here.
// Injects: externalJobId, department, publishDate, location, description, requirements.
var ITEM = '.e-loop-item.type-career';
var haideHash = function (s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); };
var clean = function (s) { return String(s || '').replace(/[\s ]+/g, ' ').trim(); };

// Publish dates come from the page's own inline `misrot` array (raw WP post objects).
var dates = {};
document.querySelectorAll('script').forEach(function (s) {
  var m = (s.textContent || '').match(/let misrot = (\[[\s\S]*?\]);/);
  if (!m) return;
  try { JSON.parse(m[1]).forEach(function (p) { dates[String(p.ID)] = String(p.post_date || '').slice(0, 10); }); } catch (e) {}
});

// Requirements live in an inline `let reqs = [{req_item}]`. The site's own renderer for
// it never runs, so every page SHOWS the template row "מטיבציה ורעב למכירות והצלחה" —
// that row is a placeholder, never read. null = marker missing (layout changed).
var parseReqs = function (html) {
  var m = html.match(/let reqs = ([^\n]*?);\s*\n/);
  if (!m) return null;
  try {
    var v = JSON.parse(m[1]);
    return Array.isArray(v) ? v.map(function (r) { return clean(r && r.req_item); }).filter(Boolean) : [];
  } catch (e) { return null; }
};

// Locations: decide only WHICH words in the ad are places, and emit them as the ad writes
// them. Canonicalising (לוד -> רמלה לוד, הדרום -> אזור דרום) is the worker's job:
// normalizeLocations() applies the shared LOCATION_ALIAS table on save. Every name here
// must resolve through that table — an unresolved part is stored raw.
// Matched only after the ב preposition (never ה — LRN-LOC-8); nothing else is guessed.
var CITY = ['ראשון לציון', 'נהריה', 'אשדוד', 'ירושלים', 'חולון', 'אור עקיבא', 'נתניה', 'לוד', 'קריית אונו', 'באר יעקב'];
var findLocations = function (title, text) {
  var out = [];
  var add = function (v) { if (v && out.indexOf(v) === -1) out.push(v); };
  var hay = title + '\n' + text;
  CITY.forEach(function (name) {
    var re = new RegExp('(^|[^א-ת])(ב|באזור\\s+)' + name + '(?![א-ת])');
    if (re.test(hay)) add(name);
  });
  // "פריסה ארצית (אור עקיבא, נתניה, …)" — the parenthesised list is the real set.
  var list = text.match(/פריסה ארצית\s*\(([^)]*)\)/);
  if (list) list[1].split(/\s*,\s*/).forEach(function (p) { p = clean(p); if (CITY.indexOf(p) !== -1) add(p); });
  // "באזור הדרום והמרכז" -> "הדרום", "המרכז"
  var area = text.match(/באזור((?:\s+ו?ה(?:דרום|מרכז|צפון))+)(?![א-ת])/);
  if (area) (area[1].match(/ה(דרום|מרכז|צפון)/g) || []).forEach(add);
  return out;
};

var REQ_HEAD = /^(דרישות(\s+ה?תפקיד)?|כישורים|תנאי\s*סף)\s*:?\s*(.*)$/;
var DESC_HEAD = /^(מה\s*אנחנו\s*מציעים|אנחנו\s*מציעים|תנאים|הטבות)/;

var items = Array.prototype.slice.call(document.querySelectorAll(ITEM));
for (var n = 0; n < items.length; n++) {
  var item = items[n];
  if (item.querySelector('.__ai-jobid')) continue;
  var a = item.querySelector('a[href*="/career/"]');
  if (!a) continue;
  var href = a.href;
  var add = function (tag, cn, text) {
    var el = document.createElement(tag); el.className = cn;
    if (text) el.textContent = text;
    item.appendChild(el); return el;
  };

  // Hebrew slug: never the id itself, only the hash input (LRN-ID-6).
  var slug = decodeURIComponent(href.replace(/\/+$/, '').split('/').pop() || '');
  add('span', '__ai-jobid', 'kidum-' + haideHash(slug));

  var pid = ((item.className || '').match(/(?:^|\s)post-(\d+)/) || [])[1] || '';
  if (dates[pid]) add('span', '__ai-publishdate', dates[pid]);

  var title = clean((item.querySelector('.elementor-widget-theme-post-title .elementor-heading-title') || {}).textContent);
  var cats = Array.prototype.map.call(
    item.querySelectorAll('.elementor-widget-text-editor > .elementor-widget-container > span'),
    function (s) { return clean(s.textContent); }).filter(Boolean);
  if (cats.length) add('span', '__ai-department', cats.join(', '));

  var html = '';
  try { html = await (await fetch(href, { credentials: 'omit' })).text(); } catch (e) { continue; }
  var doc = new DOMParser().parseFromString(html, 'text/html');

  // The job body is the text-editor widget in the container headed "תיאור המשרה".
  var body = null;
  Array.prototype.forEach.call(doc.querySelectorAll('.elementor-location-single .elementor-heading-title'), function (h) {
    if (body || clean(h.textContent).indexOf('תיאור המשרה') === -1) return;
    var box = h.closest('.e-con-inner');
    body = box && box.querySelector('.elementor-widget-text-editor .elementor-widget-container');
  });
  if (!body) continue;

  // Walk the body's paragraphs: a דרישות heading moves what follows into requirements
  // (label dropped); a benefits heading moves it back. Nodes move, text is never rebuilt.
  var desc = document.createElement('div'); desc.className = '__ai-description';
  var moved = [], bucket = 'd';
  Array.prototype.slice.call(body.childNodes).forEach(function (node) {
    var t = clean(node.textContent);
    if (!t) return;                                   // empty <p>&nbsp;</p> spacers
    var m = t.match(REQ_HEAD);
    if (m) { bucket = 'r'; if (m[3]) moved.push(clean(m[3])); return; }
    if (bucket === 'r' && DESC_HEAD.test(t)) bucket = 'd';
    if (bucket === 'r') moved.push(t); else desc.appendChild(document.importNode(node, true));
  });
  if (!clean(desc.textContent)) continue;
  item.appendChild(desc);

  var reqs = parseReqs(html) || [];
  var seen = {};
  var ul = document.createElement('ul'); ul.className = '__ai-requirements';
  reqs.concat(moved).forEach(function (r) {
    var k = r.replace(/[\s\-–—.:!]+/g, '');
    if (!k || seen[k]) return;
    seen[k] = 1;
    var li = document.createElement('li'); li.textContent = r; ul.appendChild(li);
  });
  if (ul.children.length) item.appendChild(ul);

  var locs = findLocations(title, clean(body.textContent));
  add('span', '__ai-location', locs.length ? locs.join(', ') : 'Unknown');
}
