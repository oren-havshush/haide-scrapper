/* allegronet.co.il/careers — EAEL accordion (listing-only, no detail pages).
   1. Title "JB-8 - <role>": the id is the printed number (allegronet-JB-8), the
      number phrase leaves the stored title (rule 7).
   2. Body routed by its own headings: הגדרת התפקיד -> description, דרישות -> requirements.
      JB-4 heads its role lines "דרישות התפקיד:" and then opens the real list with a
      second "דרישות:"; a requirements heading followed by another one heads role text.
   3. "המשרה מיועדת לנשים ולגברים כאחד." on a requirement line is not a requirement.
   4. Location only from "ממוקמ.. ב<place>" in the ad; otherwise Unknown, so the
      gazetteer never scans the title/body (LRN-LOC-14). The company's office
      (Tirat Carmel) is not the job location: these are often client-site roles. */
function structuredText(el) {
  if (!el) return '';
  var c = el.cloneNode(true);
  var w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT, null);
  var t;
  while ((t = w.nextNode())) t.nodeValue = t.nodeValue.replace(/\s+/g, ' ');
  c.querySelectorAll('p,div,ul,ol,li,br,h1,h2,h3,h4,h5,h6,tr').forEach(function (e) {
    e.insertAdjacentText('afterend', '\n');
  });
  return c.textContent
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

var HEAD = /^(הגדרת התפקיד|דרישות התפקיד|דרישות)\s*:?$/;
var GENDER = /\s*המשרה מיועדת לנשים ולגברים כאחד\.?/;
var PLACES = [
  ['חיפה', 'חיפה'], ['טירת הכרמל', 'טירת הכרמל'], ['טירת כרמל', 'טירת הכרמל'],
  ['תל אביב', 'תל אביב-יפו'], ['ירושלים', 'ירושלים'], ['נשר', 'נשר'], ['עכו', 'עכו'],
  ['נתניה', 'נתניה'], ['קרית אתא', 'קרית אתא'], ['קריית אתא', 'קרית אתא']
];

function placeOf(text) {
  var m = /ממוקמ\S*\s+ב/.exec(text);
  if (!m) return 'Unknown';
  var rest = text.slice(m.index + m[0].length);
  for (var i = 0; i < PLACES.length; i++) {
    var p = PLACES[i][0];
    if (rest.indexOf(p) === 0 && !/[א-תA-Za-z]/.test(rest.charAt(p.length))) return PLACES[i][1];
  }
  return 'Unknown';
}

function add(item, cls, text) {
  var s = document.createElement('span');
  s.className = cls;
  s.style.display = 'none';
  s.textContent = text;
  item.appendChild(s);
}

document.querySelectorAll('.eael-accordion-list').forEach(function (item) {
  if (item.querySelector('.__ai-jobid')) return;
  var head = item.querySelector('.eael-accordion-tab-title');
  var body = item.querySelector('.eael-accordion-content');
  if (!head || !body) return;
  var raw = head.textContent.replace(/\s+/g, ' ').trim();
  var m = /^(JB-\d+)\s*[-–]\s*/i.exec(raw);
  add(item, '__ai-title', m ? raw.slice(m[0].length).trim() : raw);
  if (m) add(item, '__ai-jobid', 'allegronet-' + m[1].toUpperCase());

  var c = body.cloneNode(true);
  c.querySelectorAll('style,script,[data-elementor-type]').forEach(function (e) { e.remove(); });
  c.querySelectorAll('a').forEach(function (a) {
    if (/elementor-template/.test(a.getAttribute('href') || '')) a.remove();
  });
  var lines = structuredText(c).split('\n').map(function (l) { return l.trim(); }).filter(Boolean);

  var heads = [];
  lines.forEach(function (l, i) { if (HEAD.test(l)) heads.push(i); });
  var desc = [], req = [], mode = 'd';
  lines.forEach(function (l, i) {
    if (HEAD.test(l)) {
      var isReq = /^דרישות/.test(l);
      var laterReq = heads.some(function (h) { return h > i && /^דרישות/.test(lines[h]); });
      mode = isReq && !laterReq ? 'r' : 'd';
      return;
    }
    if (mode === 'r') {
      var g = GENDER.exec(l);
      if (g) {
        var rest = (l.slice(0, g.index) + l.slice(g.index + g[0].length)).trim();
        if (rest) req.push(rest);
        desc.push(g[0].trim());
      } else req.push(l);
    } else desc.push(l);
  });
  add(item, '__ai-description', desc.join('\n'));
  add(item, '__ai-requirements', req.join('\n'));
  add(item, '__ai-location', placeOf(lines.join('\n')));
});
