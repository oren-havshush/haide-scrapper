try {
  // rapyd.net careers search, filtered to Tel Aviv (?location=tel-aviv-israel): .vcex-post-type-entry cards
  // with data-location; title/department/seniority/type in .c-position-details__list. No printed job
  // number -> id rapyd-<ASCII page slug>. Job page: two .job-details blocks (description, requirements);
  // the "Job Candidate Privacy Policy" line goes to the description. Apply = the page's Comeet apply iframe.
  var NBSP = String.fromCharCode(160);
  function span(cls, val) { var e = document.createElement('span'); e.className = cls; e.style.display = 'none'; e.textContent = val; return e; }
  function lines(el) { return el.innerText.split(NBSP).join(' ').split('\n').map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).filter(Boolean); }
  var PLACE = { 'Tel Aviv, Israel': 'תל אביב-יפו' };
  var CARD = '.vcex-post-type-entry[data-location]';
  if (document.querySelector(CARD)) {
    Array.prototype.forEach.call(document.querySelectorAll(CARD), function (card) {
      if (card.querySelector('.__ai-id')) return;
      var a = card.querySelector('a.theme-button');
      var m = a ? /\/positions\/([a-z0-9-]+)\/?$/i.exec(a.getAttribute('href') || '') : null;
      if (m) card.appendChild(span('__ai-id', 'rapyd-' + m[1].toLowerCase()));
      var n = card.querySelector('.c-position-location .name');
      card.appendChild(span('__ai-location', PLACE[n ? n.textContent.replace(/\s+/g, ' ').trim() : ''] || 'Unknown'));
    });
    return;
  }
  var main = document.querySelector('.single-career-position__main');
  if (!main || document.querySelector('.__ai-description')) return;
  var jd = main.querySelectorAll('.job-details');
  var desc = jd[0] ? lines(jd[0]) : [], req = [], tail = [];
  if (jd[1]) lines(jd[1]).forEach(function (l) { (/Privacy Policy/i.test(l) ? tail : req).push(l); });
  for (var i = 2; i < jd.length; i++) desc = desc.concat(lines(jd[i]));
  document.body.appendChild(span('__ai-description', desc.concat(tail).join('\n')));
  if (req.length) document.body.appendChild(span('__ai-requirements', req.join('\n')));
  var ifr = null;
  for (var w = 0; w < 20 && !ifr; w++) {
    ifr = Array.prototype.map.call(document.querySelectorAll('iframe'), function (f) { return f.src || f.getAttribute('data-src') || ''; }).filter(function (s) { return /comeet\.co\/jobs\/[^/]+\/[^/]+\/apply/.test(s); })[0] || null;
    if (!ifr) await new Promise(function (r) { setTimeout(r, 500); });
  }
  if (ifr) document.body.appendChild(span('__ai-apply', ifr));
  var ld = Array.prototype.map.call(document.querySelectorAll('script[type="application/ld+json"]'), function (s) { return s.textContent; }).join(' ');
  var dm = /"datePublished":"(\d{4}-\d{2}-\d{2})/.exec(ld);
  if (dm) document.body.appendChild(span('__ai-date', dm[1]));
} catch (e) { }
