// pei.co.il/jobs — one page of <details> accordions. Title "<role> - <n>": the printed number is the id
// (pei-<n>) and leaves the title (rule 7). A job with no apply button (body only "הגשת מועמדות" + a
// PDF, e.g. 500472) has no apply path on the page and is removed (owner, 2026-10-05).
// All body lines sit under one "דרישות התפקיד" list; place, shift, pay and employment-terms lines
// are not requirements and go to description, followed by the paragraphs after the list.
var items = document.querySelectorAll('details.jobs-accordion__item');
if (items.length && !document.querySelector('.__ai-jobid')) {
  var NBSP = new RegExp(String.fromCharCode(160), 'g');
  var clean = function (s) { return String(s || '').replace(NBSP, ' ').replace(/[ \t]+/g, ' ').trim(); };
  var NOT_REQ = /^מקום העבודה|^העבודה במשמרות|^התפקיד דורש|^עבודה מתאימה|^העסקה|שכר|^אפשרויות קידום|^עבודה באזור/;
  var HEAD = /^דרישות התפקיד\s*:?$/;
  // Closed list: only these city.csv entries, read only from the job's own place lines.
  var PLACES = [
    ['הרצליה', /הרצליה/], ['אשדוד', /אשדוד/], ['חיפה', /חיפה/],
    ['קרית טבעון', /טבעון/], ['יוקנעם', /יוקנעם/], ['עמק יזרעאל', /עמק יז(?:רע|ער)אל/],
    ['באר שבע', /באר[\s-]?שבע/], ['אשקלון', /אשקלון/], ['רחובות', /רחובות/]
  ];
  var removed = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var rawTitle = clean((it.querySelector('.jobs-accordion__title') || {}).textContent);
    var btn = it.querySelector('.js-job-apply-open');
    if (!btn) { removed.push(rawTitle); it.remove(); continue; }
    var m = rawTitle.match(/^(.*?)\s*-\s*(\d+)\s*$/);
    var title = m ? m[1] : rawTitle;
    var body = it.querySelector('.jobs-accordion__body');
    var desc = [], reqs = [], after = [], seenList = false;
    var kids = body ? body.children : [];
    for (var k = 0; k < kids.length; k++) {
      var el = kids[k];
      if (el.tagName === 'UL' || el.tagName === 'OL') {
        seenList = true;
        el.querySelectorAll('li').forEach(function (li) {
          var t = clean(li.textContent);
          if (t) (NOT_REQ.test(t) ? desc : reqs).push(t);
        });
      } else {
        var t = clean(el.textContent);
        if (!t || HEAD.test(t)) continue;
        (seenList ? after : desc).push(t);
      }
    }
    desc = desc.concat(after);
    var placeText = desc.filter(function (l) { return /^מקום העבודה|^עבודה באזור/.test(l); }).join(' ');
    var locs = [];
    PLACES.forEach(function (p) { if (p[1].test(placeText)) locs.push(p[0]); });
    var dl = it.querySelector('time.jobs-accordion__date');
    var mk = function (cls, txt) {
      if (!txt) return;
      var s = document.createElement('span');
      s.className = cls; s.style.display = 'none'; s.textContent = txt;
      it.appendChild(s);
    };
    mk('__ai-title', title);
    mk('__ai-description', desc.join('\n'));
    mk('__ai-requirements', reqs.join('\n'));
    mk('__ai-location', locs.length ? locs.join(', ') : 'Unknown');
    mk('__ai-deadline', dl ? dl.getAttribute('datetime') : '');
    mk('__ai-jobid', m ? 'pei-' + m[2] : '');
  }
  if (removed.length) console.info('[pei] removed (no apply button): ' + removed.join(' | '));
}
