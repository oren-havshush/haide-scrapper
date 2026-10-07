try {
  // aig.co.il /jobs/ (Next.js + MUI). Listing: [class*="jobs-links_job-link"] cards (title + link to
  // /jobs/<Hebrew slug>/). No job number anywhere -> id aig-haideHash(decoded slug) (LRN-ID-6).
  // Job page: one .ritch-text body; "תיאור התפקיד" / "דרישות התפקיד" headings dropped; requirements
  // run until the closing block that starts at the "נשים וגברים" line, which goes back to the description.
  // No page names a work location -> Unknown (the Petach Tikva address is the company's, not the job's).
  var NBSP = String.fromCharCode(160);
  function haideHash(s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); }
  function span(cls, val) { var e = document.createElement('span'); e.className = cls; e.style.display = 'none'; e.textContent = val; return e; }
  var CARD = '[class*="jobs-links_job-link"]';
  if (/\/jobs\/?$/.test(location.pathname)) {
    var prev = -1, stable = 0;
    for (var t = 0; t < 60; t++) {
      var n = document.querySelectorAll(CARD).length;
      if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
      prev = n;
      await new Promise(function (r) { setTimeout(r, 500); });
    }
    Array.prototype.forEach.call(document.querySelectorAll(CARD), function (card) {
      if (card.querySelector('.__ai-id')) return;
      var a = card.querySelector('a[href*="/jobs/"]');
      if (!a) return;
      var seg = a.pathname.replace(/\/+$/, '').split('/').pop();
      var slug = seg; try { slug = decodeURIComponent(seg); } catch (e) { }
      if (slug) card.appendChild(span('__ai-id', 'aig-' + haideHash(slug)));
    });
    return;
  }
  var rt = null;
  for (var w = 0; w < 40 && !rt; w++) {
    rt = document.querySelector('.ritch-text');
    if (!rt) await new Promise(function (r) { setTimeout(r, 500); });
  }
  if (!rt || document.querySelector('.__ai-description')) return;
  var lines = rt.innerText.split(NBSP).join(' ').split('\n').map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
  var desc = [], req = [], sec = 'desc';
  lines.forEach(function (l) {
    if (/^תיאור (ה)?תפקיד\s*:?$/.test(l)) { sec = 'desc'; return; }
    if (/^דרישות (ה)?תפקיד\s*:?$/.test(l)) { sec = 'req'; return; }
    if (sec === 'req' && /נשים וגברים|גברים ונשים/.test(l)) sec = 'tail';
    (sec === 'req' ? req : desc).push(l);
  });
  document.body.appendChild(span('__ai-description', desc.join('\n')));
  if (req.length) document.body.appendChild(span('__ai-requirements', req.join('\n')));
  document.body.appendChild(span('__ai-location', 'Unknown'));
} catch (e) { }
