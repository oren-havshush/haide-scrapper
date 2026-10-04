/* ledico.com/careers — WordPress (BeTheme + WPBakery grid), offer CPT at /jobs/<hebrew-slug>/.
   Listing cards carry title + a truncated excerpt; each detail page is fetched same-origin.
   - id: ledico-<haideHash(decoded slug)> — no printed job number, Hebrew slug (LRN-ID-6)
   - description: .bold_txt + .simple_txt (+ any non-דרישות section), labels dropped,
     the "ניתן לשלוח קורות חיים..." apply sentence moved to applicationInfo
   - requirements: lists under the דרישות heading (a working-hours line stays in description)
   - apply: the job's own mailto (Cloudflare-obfuscated on the page, decoded here)
   - location: city.csv verbatim, only when the text names the workplace; else Unknown
   The WPBakery grid re-renders its cards after load, which wipes anything appended to
   them, so jobs are built into a hidden #haide-jobs-root instead (itemSelector). */
if (document.querySelector('#haide-jobs-root')) return;
var ITEM = '.vc_grid-item';
var prev = -1, stable = 0;
for (var t = 0; t < 60; t++) {
  var n = document.querySelectorAll(ITEM).length;
  if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n;
  await new Promise(function (r) { setTimeout(r, 500); });
}
var NBSP = String.fromCharCode(160);
var haideHash = function (s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); };
var cfDecode = function (hex) {
  var k = parseInt(hex.substr(0, 2), 16), out = '';
  for (var i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.substr(i, 2), 16) ^ k);
  return out;
};
var mk = function (item, cls, val) {
  if (!val) return;
  var s = document.createElement('div');
  s.className = cls; s.style.display = 'none'; s.textContent = val;
  item.appendChild(s);
};
var lines = function (s) {
  return s.split(NBSP).join(' ').split('\n').map(function (l) { return l.replace(/[ \t]+/g, ' ').trim(); }).filter(Boolean);
};
var APPLY = /ניתן לשלוח קורות חיים למייל הבא\s*([\w.+-]+@[\w.-]+\.\w+)\s*(בצירוף שם המשרה)?\.?/g;
var LABEL = /^תיאור התפקיד\s*:?\s*/;
var HOURS = /\d{1,2}:\d\d/;

var cards = [].slice.call(document.querySelectorAll(ITEM)).map(function (c) {
  var l = c.querySelector('a.vc-zone-link') || c.querySelector('a[href*="/jobs/"]');
  return { href: l && l.href, title: ((c.querySelector('h4') || {}).textContent || '').trim() };
}).filter(function (c) { return c.href && c.title; });
var root = document.createElement('div');
root.id = 'haide-jobs-root'; root.style.display = 'none';
var seen = {};
for (var x = 0; x < cards.length; x++) {
  var a = cards[x];
  if (seen[a.href]) continue;
  seen[a.href] = 1;
  try {
    var html = await fetch(a.href, { credentials: 'same-origin' }).then(function (r) { return r.text(); });
    var doc = new DOMParser().parseFromString(html, 'text/html');
    [].slice.call(doc.querySelectorAll('[data-cfemail]')).forEach(function (e) {
      e.replaceWith(doc.createTextNode(cfDecode(e.getAttribute('data-cfemail'))));
    });
    var btn = doc.querySelector('.apply-now-btn a');
    var bh = btn ? btn.getAttribute('href') || '' : '';
    var hm = /email-protection#([0-9a-f]+)/i.exec(bh);
    if (hm) bh = cfDecode(hm[1]);
    var EMAIL = (/[\w.+-]+@[\w.-]+\.\w+/.exec(decodeURIComponent(bh.replace(/^mailto:/i, ''))) || [])[0] || '';

    var body = doc.querySelector('.post-right-txt .column') || doc.querySelector('.post-right-txt');
    if (!body) continue;
    var desc = [], req = [], inReq = false, note = '';
    var kids = [].slice.call(body.children);
    for (var k = 0; k < kids.length; k++) {
      var el = kids[k], tag = el.tagName;
      if (tag === 'H2') continue;                                   // the title
      if (tag === 'SPAN' || tag === 'H4' || tag === 'P' || tag === 'DIV') {
        var txt = (el.textContent || '').replace(APPLY, function (m0, em, ins) {
          if (!EMAIL) EMAIL = em;
          if (ins && em === EMAIL) note = ins;
          return '\n';
        });
        lines(txt).forEach(function (l) {
          l = l.replace(LABEL, '');
          if (l) (inReq ? req : desc).push(l);
        });
        continue;
      }
      if (/^H[1-6]$/.test(tag)) {
        var h = (el.textContent || '').trim();
        if (!h) continue;                                           // empty h3 between lists: same section
        if (/^דרישות/.test(h)) { inReq = true; continue; }
        inReq = false;
        if (h.replace(LABEL, '')) desc.push(h.replace(LABEL, ''));
        continue;
      }
      if (tag === 'UL' || tag === 'OL') {
        [].slice.call(el.querySelectorAll('li')).forEach(function (li) {
          var l = lines(li.textContent || '').join(' ');
          if (!l) return;
          if (inReq && HOURS.test(l)) desc.push(l);                 // the schedule is not a requirement
          else (inReq ? req : desc).push(l);
        });
      }
    }
    // .bold_txt ends with the line .simple_txt starts with: drop an exact consecutive repeat only
    desc = desc.filter(function (l, i) { return i === 0 || l !== desc[i - 1]; });
    var own = desc.concat(req).join('\n');
    var loc = /(במשרדי החברה|למחסן|במחסן)\s+ב?(ראשון לציון|ראשל["״]צ)/.test(own) ? 'ראשון לציון'
      : /(ברחבי|בכל)\s+הארץ/.test(own) ? 'פריסה ארצית' : 'Unknown';
    var slug = decodeURIComponent(a.href.split('?')[0].split('/').filter(Boolean).pop());
    var pd = /"datePublished"\s*:\s*"([^"]+)"/.exec(html);

    var item = document.createElement('div');
    item.setAttribute('data-haide-job', '1');
    var link = document.createElement('a'); link.href = a.href; link.className = '__ai-link'; item.appendChild(link);
    mk(item, '__ai-title', a.title);
    mk(item, '__ai-externalJobId', 'ledico-' + haideHash(slug));
    mk(item, '__ai-description', desc.join('\n'));
    mk(item, '__ai-requirements', req.join('\n'));
    mk(item, '__ai-location', loc);
    mk(item, '__ai-publishDate', pd ? pd[1] : '');
    mk(item, '__ai-apply', EMAIL ? 'mailto:' + EMAIL + (note ? ' - ' + note : '') : '');
    root.appendChild(item);
  } catch (e) { }
}
document.body.appendChild(root);
