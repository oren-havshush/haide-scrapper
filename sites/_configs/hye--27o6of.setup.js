try {
  // hye.co.il (קבוצת ח.י., Magento). Listing /job: one card per job inside #all (the category tabs repeat
  // them). id = hye-<printed "מספר משרה"> (JB-614, JB480 as printed); no number -> hye-<detail id>.
  // A card whose detail page says "המשרה נסגרה" (closed, no apply form) is removed.
  // Detail: "תיאור משרה" section split at "דרישות התפקיד:"; a later "X:" sub-heading,
  // full-time/hours and equal-opportunity lines go back to the description.
  var NBSP = String.fromCharCode(160);
  function lines(el) {
    var c = el.cloneNode(true);
    Array.prototype.forEach.call(c.querySelectorAll('style,script'), function (e) { e.remove(); });
    Array.prototype.forEach.call(c.querySelectorAll('p,div,li,br,h1,h2,h3,h4,h5,h6'), function (e) { e.insertAdjacentText('afterend', '\n'); });
    return c.textContent.split(NBSP).join(' ').split('\n').map(function (l) { return l.replace(/[ \t]{2,}/g, ' ').trim(); }).filter(Boolean);
  }
  function span(cls, val) { var e = document.createElement('span'); e.className = cls; e.style.display = 'none'; e.textContent = val; return e; }
  function txt(el) { return el ? el.textContent.split(NBSP).join(' ').replace(/\s+/g, ' ').trim() : ''; }
  // Card tag -> verbatim city.csv entry. Anything else (משרת שטח, קרית שדה התעופה) -> the ad's own
  // location cue line, else Unknown.
  var TAGS = { 'כפר סבא': 'כפר סבא', 'אזור המרכז': 'אזור מרכז', 'פריסה ארצית': 'פריסה ארצית', 'יסודות': 'יסודות' };
  var CUE = /(?:ממוקם|ממוקמת|מיקום\s*:)\s*(?:ב-?|במושב\s+|מושב\s+)?\s*(כפר סבא|יסודות)(?![א-ת])/;

  // ---- listing
  var cards = Array.prototype.slice.call(document.querySelectorAll('#all a[href*="/job/index/detail/id/"]'));
  for (var i = 0; i < cards.length; i++) {
    var a = cards[i];
    if (a.querySelector('.__ai-id')) continue;
    var m = /\/detail\/id\/(\d+)/.exec(a.getAttribute('href') || '');
    if (!m) continue;
    var doc = null;
    try {
      var r = await fetch(a.href, { credentials: 'same-origin' });
      if (r.ok) doc = new DOMParser().parseFromString(await r.text(), 'text/html');
    } catch (e) { }
    if (doc && /המשרה נסגרה/.test(txt(doc.querySelector('.content-left'))) && !doc.querySelector('form#job-application-from')) {
      a.remove();
      continue;
    }
    var num = txt(a.querySelector('.jobs-number')).replace(/^מספר משרה\s*:\s*/, '');
    a.appendChild(span('__ai-id', 'hye-' + (/^[A-Za-z0-9-]+$/.test(num) ? num : m[1])));
    var loc = TAGS[txt(a.querySelector('.jobs-location')).replace(/^מיקום\s*:\s*/, '')] || '';
    if (!loc && doc) {
      var body = doc.querySelector('.job-detail .content');
      var hit = body ? CUE.exec(lines(body).join('\n')) : null;
      if (hit) loc = hit[1];
    }
    a.appendChild(span('__ai-location', loc || 'Unknown'));
  }

  // ---- detail
  var detail = document.querySelector('.job-detail .content');
  if (!detail || document.querySelector('.__ai-description')) return;
  var LABEL = /^(תיאור (ה)?משרה|תיאור (ה)?תפקיד|פרוט (ה)?תפקיד|פירוט (ה)?תפקיד)\s*:?$/;
  var REQ_H = /^דרישות (ה)?תפקיד\s*:?$/;
  var BACK = /^[-\s]*משרה מלאה|נשים ול?גברים|גברים ול?נשים/;
  var desc = [], req = [], manager = '';
  Array.prototype.forEach.call(detail.querySelectorAll('.jobs-detail-section'), function (sec) {
    var hEl = sec.querySelector('.jobs-detail-section-title');
    var head = hEl ? hEl.textContent.replace(/\s+/g, ' ').trim() : '';
    var c = sec.cloneNode(true);
    var ch = c.querySelector('.jobs-detail-section-title');
    if (ch) ch.remove();
    var ls = lines(c);
    if (head === 'מנהל ישיר') { manager = ls.join(' '); return; }
    var inReq = false;
    ls.forEach(function (l) {
      if (REQ_H.test(l)) { inReq = true; return; }
      if (LABEL.test(l)) return;
      if (inReq && /:\s*$/.test(l)) inReq = false;
      if (inReq && !BACK.test(l)) { req.push(l); return; }
      desc.push(l);
    });
  });
  if (manager) desc.push('מנהל ישיר: ' + manager);
  document.body.appendChild(span('__ai-description', desc.join('\n')));
  if (req.length) document.body.appendChild(span('__ai-requirements', req.join('\n')));
} catch (e) { }
