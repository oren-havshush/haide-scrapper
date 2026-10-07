try {
  // amitim.com /career/jobs/ (WordPress `job` CPT, server-rendered). Listing: ul.field-details-list > li cards
  // grouped under h3.job-field-name (division -> department). Card prints "מספר משרה JB-65" in several
  // spellings ("JB - 45", "משרה מספר- JB-66"); id = amitim-JB-<n> (printed number, LRN-ID-11/12).
  // Detail /job/<slug>/: .job-details = h3.job-details-title + div.job-details-text pairs:
  // תיאור -> description, דרישות -> requirements, הגשת מועמדות -> privacy line kept at the end of description (owner 2026-10-07), mailto line ->
  // applicationInfo with the job's number (rule 6/7 exception: one shared address per job), the
  // "נשים ולגברים" line -> end of description (rule 4). publishDate = JSON-LD JobPosting datePosted.
  // Location: only from a "מקום העבודה" cue line, closed list; else Unknown (JSON-LD jobLocation is the
  // HQ address on every posting, not a work place).
  var NBSP = String.fromCharCode(160);
  var span = function (cls, val) { var e = document.createElement('span'); e.className = cls; e.style.display = 'none'; e.textContent = val; return e; };
  var clean = function (s) { return (s || '').split(NBSP).join(' ').replace(/\s+/g, ' ').trim(); };
  var jbNum = function (s) { var m = /JB\s*-?\s*(\d+)/i.exec(s || ''); return m ? 'JB-' + m[1] : ''; };
  var HE_LA = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u;
  var OTHER = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;

  // ---------- LISTING ----------
  var cards = document.querySelectorAll('ul.field-details-list > li');
  if (cards.length) {
    Array.prototype.forEach.call(cards, function (li) {
      if (li.querySelector('.__ai-id')) return;
      var t = clean((li.querySelector('.job-box-bottom') || {}).textContent);
      if (!t || !HE_LA.test(t) || OTHER.test(t)) { li.parentNode.removeChild(li); return; }
      var num = jbNum((li.querySelector('.job-box-top-text') || {}).textContent);
      if (num) li.appendChild(span('__ai-id', 'amitim-' + num));
      var h = li.parentElement ? li.parentElement.previousElementSibling : null;
      while (h && !(h.matches && h.matches('h3.job-field-name'))) h = h.previousElementSibling;
      if (h && clean(h.textContent)) li.appendChild(span('__ai-department', clean(h.textContent)));
    });
    return;
  }

  // ---------- DETAIL ----------
  var box = document.querySelector('.job-details');
  if (!box || document.querySelector('.__ai-description')) return;
  var number = jbNum((document.querySelector('h2.job-number') || {}).textContent);

  // A section's units in document order: each <li> is a bullet, every other leaf block is split on <br>.
  var units = function (div) {
    var out = [];
    var c = div.cloneNode(true);
    Array.prototype.forEach.call(c.querySelectorAll('br'), function (b) { b.replaceWith('\n'); });
    Array.prototype.forEach.call(c.querySelectorAll('li, p, h1, h2, h3, h4, h5, h6'), function (el) {
      if (el.tagName !== 'LI' && el.closest('li')) return;
      if (el.tagName !== 'LI' && el.querySelector('li, p, h1, h2, h3, h4, h5, h6')) return;
      var isLi = el.tagName === 'LI';
      (el.textContent || '').split('\n').forEach(function (line) {
        var s = clean(line);
        if (s) out.push({ li: isLi, text: s });
      });
    });
    if (!out.length) (c.textContent || '').split('\n').forEach(function (line) { var s = clean(line); if (s) out.push({ li: false, text: s }); });
    return out;
  };

  var desc = [], req = [], tail = [], mail = '', instr = '';
  var kids = box.children;
  for (var i = 0; i < kids.length; i++) {
    var hd = kids[i];
    if (!hd.matches('h3.job-details-title')) continue;
    var body = hd.nextElementSibling;
    if (!body || !body.matches('.job-details-text')) continue;
    var name = clean(hd.textContent);
    var us = units(body);
    if (/^תיאור/.test(name)) { desc = desc.concat(us); continue; }
    if (/^דרישות/.test(name)) {
      us.forEach(function (u) { if (/@/.test(u.text) || /^להגשת מועמדות/.test(u.text)) return; req.push(u); });
      continue;
    }
    if (/^הגשת מועמדות/.test(name)) {
      var a = body.querySelector('a[href^="mailto:"]');
      if (a) mail = clean(a.getAttribute('href').replace(/^mailto:/i, '').split('?')[0]);
      us.forEach(function (u) {
        if (mail && u.text.indexOf(mail) >= 0) { instr = clean(u.text.slice(u.text.indexOf(mail) + mail.length)); return; }
        if (/@/.test(u.text)) return;
        tail.push({ li: false, text: u.text });
      });
      continue;
    }
    desc = desc.concat(us);
  }
  if (!mail) {
    var a2 = box.querySelector('a[href^="mailto:"]');
    if (a2) mail = clean(a2.getAttribute('href').replace(/^mailto:/i, '').split('?')[0]);
  }

  var block = function (cls, list) {
    var w = document.createElement('div'); w.className = cls; w.style.display = 'none';
    var ul = null;
    list.forEach(function (u) {
      if (u.li) { if (!ul) { ul = document.createElement('ul'); w.appendChild(ul); } var li = document.createElement('li'); li.textContent = u.text; ul.appendChild(li); }
      else { ul = null; var d = document.createElement('div'); d.textContent = u.text; w.appendChild(d); }
    });
    document.body.appendChild(w);
  };
  var fullDesc = desc.concat(tail);
  if (fullDesc.length) block('__ai-description', fullDesc);
  if (req.length) block('__ai-requirements', req);

  if (mail) {
    var ins = instr;
    if (ins && number && /המשרה\.?$/.test(ins)) ins = ins.replace(/\.?$/, ' ' + number + '.');
    document.body.appendChild(span('__ai-apply', 'mailto:' + mail + (ins ? ' - ' + ins : '')));
  }

  // Location: only a work-location cue line, closed list of verbatim city.csv values.
  var loc = 'Unknown';
  var all = desc.concat(req);
  for (var k = 0; k < all.length; k++) {
    var m = /^מקום העבודה(?: העיקרי)?(?: הוא)?\s*[:\-–]?\s*(ת["״׳']א|תל[\s-]*אביב(?:[\s-]*יפו)?|הרצליה)/.exec(all[k].text);
    if (m) { loc = /^הרצליה/.test(m[1]) ? 'הרצליה' : 'תל אביב-יפו'; break; }
  }
  document.body.appendChild(span('__ai-location', loc));

  var lds = document.querySelectorAll('script[type="application/ld+json"]');
  for (var q = 0; q < lds.length; q++) {
    try {
      var o = JSON.parse(lds[q].textContent);
      if (o && o['@type'] === 'JobPosting' && o.datePosted) {
        var dm = /^(\d{4}-\d{2}-\d{2})/.exec(o.datePosted);
        if (dm) document.body.appendChild(span('__ai-date', dm[1]));
        break;
      }
    } catch (e) { }
  }
} catch (e) { }
