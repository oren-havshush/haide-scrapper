// aerohandling.com/CAREERS -- listing on the employer's page, body on the Niloos/Hunter vacancy page (LRN-SPA-7).
// Runs on BOTH pages. Listing: id from the vacancy ObjectId in the card href (ASCII slug), apply link, language gate.
// Detail (minisite.niloos.ai | minisite.hunter-edge.me): description / requirements / location into #__ai-detail.
var Q = String.fromCharCode(34), G = String.fromCharCode(0x5F4), RQ = String.fromCharCode(0x201D);
var HE_OR_LAT = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u;
var OTHER = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var put = function (host, cls, val) {
  var s = document.createElement('span'); s.className = cls; s.style.display = 'none'; s.textContent = val; host.appendChild(s);
};
var structuredText = function (el) {
  if (!el) return '';
  var c = el.cloneNode(true);
  c.querySelectorAll('p,div,ul,ol,li,br,h1,h2,h3,h4,h5,h6,tr').forEach(function (e) {
    var prev = e.previousSibling; // text glued before a block (Niloos: bare text node, then <div>)
    if (e.tagName !== 'BR' && prev && prev.nodeType === 3 && prev.textContent.trim()) e.insertAdjacentText('beforebegin', '\n');
    e.insertAdjacentText('afterend', '\n');
  });
  return c.textContent.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
};

if (/aerohandling\.com$/i.test(location.hostname)) {
  var cards = document.querySelectorAll('.boxs > .item');
  cards.forEach(function (item) {
    var a = item.querySelector('.cv a[href]');
    var t = item.querySelector('.title');
    var title = t ? t.textContent.trim() : '';
    if (!a || !title || !HE_OR_LAT.test(title) || OTHER.test(title)) { item.remove(); return; }
    if (item.querySelector('.__ai-jobid')) return;
    var m = /\/vacancy\/([0-9a-f]{24})\b/i.exec(a.getAttribute('href') || '');
    if (m) put(item, '__ai-jobid', 'aerohandling-' + m[1].toLowerCase());
    put(item, '__ai-applyinfo', a.href);
  });
} else if (/\/(vacancy|apply)\//.test(location.pathname)) {
  if (!document.getElementById('__ai-detail')) {
    for (var t = 0; t < 20 && !document.querySelector('section.job-info'); t++) {
      await new Promise(function (r) { setTimeout(r, 500); });
    }
    var sec = {};
    document.querySelectorAll('section.job-info [class*="font-bold"]').forEach(function (h) {
      var k = h.textContent.trim();
      if (h.nextElementSibling) sec[k] = structuredText(h.nextElementSibling);
    });
    var desc = sec['תיאור'] || '';
    var req = [sec['דרישות'], sec['כישורים']].filter(function (x) { return x && x.trim(); }).join('\n\n');
    // A benefits sub-heading printed under the requirements heading is not a requirement:
    // it and everything after it move to the end of the description (employer's words, moved not changed).
    var lines = req.split('\n');
    var cut = lines.findIndex(function (l) { return /^[^\p{L}]*(מה תקבלו|מה תקבל\/י|מה מציעים)/u.test(l); });
    if (cut >= 0) {
      desc = (desc + '\n\n' + lines.slice(cut).join('\n')).trim();
      req = lines.slice(0, cut).join('\n').trim();
    }
    // Location: only from a work-location cue line naming the airport; the one value is the city.csv entry.
    var AP = 'נתב[' + Q + G + RQ + ']ג';
    var cue = new RegExp('(עבודה|העבודה|עובדים|עשיה|עשייה)[^\\n]{0,40}(ב|בלב |– |- )' + AP + '|^[^\\n]{2,60}[–-] ?' + AP + '[^\\p{L}]*$', 'mu');
    var all = desc + '\n' + req;
    var loc = cue.test(all) ? 'נתב' + Q + 'ג' : 'Unknown';
    var box = document.createElement('div'); box.id = '__ai-detail'; box.style.display = 'none';
    put(box, '__ai-description', desc);
    put(box, '__ai-requirements', req);
    put(box, '__ai-location', loc);
    document.body.appendChild(box);
  }
}
