function aiClean(t) {
  t = t.replace(/[﻿​-‍⁠]/g, '');
  t = t.replace(/ /g, ' ');
  t = t.replace(/·/g, '\n• ');
  var lines = t.split('\n');
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i].replace(/[ \t]+/g, ' ').trim();
    if (!l) continue;
    if (/^<\/?[a-z][^>]*>$/i.test(l)) continue;
    if (/^apply for this job$/i.test(l)) break;
    out.push(l);
  }
  return out.join('\n').trim();
}

function structuredText(el) {
  if (!el) return '';
  var scope = el.querySelector('.positionInfo') || el;
  var c = scope.cloneNode(true);
  var i;
  var kill = c.querySelectorAll('style,script,link,meta,iframe,img,noscript,form,button,svg');
  for (i = kill.length - 1; i >= 0; i--) kill[i].parentNode.removeChild(kill[i]);
  var brk = c.querySelectorAll('p,div,ul,ol,li,br,h1,h2,h3,h4,h5,h6,tr');
  for (i = 0; i < brk.length; i++) brk[i].insertAdjacentText('afterend', '\n');
  return aiClean(c.textContent || '');
}

/* Drop a redundant leading label line ("Requirements:", "דרישות התפקיד:").
   Line-based rather than one regex over the whole string: the separator
   between the label words is not always a plain U+0020 on this board, so a
   literal-space pattern silently misses it. Only a SHORT first line whose
   words start with a known label keyword is dropped, so real opening
   headings ("מה צריך?", the job title) survive. */
function aiStripLabel(s) {
  var lines = s.split('\n');
  /* These blocks carry TWO stacked label lines — the block's own heading
     ("Requirements") followed by the employer's sub-label
     ("דרישות התפקיד:") — so strip in a loop, not once.
     No \b after the keyword: JS \b is ASCII-only and never matches at the
     edge of a Hebrew word. The keyword-prefix + short-line test is what
     keeps real opening headings ("מה צריך?", the job title) intact. */
  while (lines.length > 1) {
    var head = lines[0].replace(/\s+/g, ' ').trim();
    if (
      head.length <= 40 &&
      /^(description|requirements|job description|תיאור|דרישות)/i.test(head)
    ) {
      lines.shift();
    } else {
      break;
    }
  }
  return lines.join('\n').trim();
}

function uidFromHref(href) {
  var clean = String(href || '').split(/[?#]/)[0].replace(/\/+$/, '');
  var segs = clean.split('/');
  var out = '';
  for (var i = 0; i < segs.length; i++) if (segs[i]) out = segs[i];
  return out;
}

function aiInject(host, cls, val) {
  if (!host || !val) return;
  if (host.querySelector('.' + cls)) return;
  var s = document.createElement('span');
  s.className = cls;
  s.style.display = 'none';
  s.textContent = val;
  host.appendChild(s);
}

/* ------------------------------------------------------------------ *
 * LISTING SCOPE — group headings on this board are LOCATIONS, not
 * departments (Hatzerim/Magal/Yiftah/Tel Aviv Israel, Colombia, India
 * Pune, ...). Netafim is global; haide-jobs serves Israel, so every
 * position under a non-Israeli heading is removed before extraction.
 * Department + employment type come from .positionDetails li 1 and 2.
 * ------------------------------------------------------------------ */
if (document.querySelector('.positionsGroupTitle')) {
  var nodes = document.querySelectorAll('.positionsGroupTitle, a.positionItem');
  var group = '';
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    if (n.className && String(n.className).indexOf('positionsGroupTitle') !== -1) {
      group = (n.textContent || '').trim();
      continue;
    }
    var li = n.closest('li');
    if (!li) continue;
    if (!/israel|ישראל/i.test(group)) {
      if (li.parentNode) li.parentNode.removeChild(li);
      continue;
    }
    aiInject(li, '__ai-jobid', uidFromHref(n.getAttribute('href')));
    var det = li.querySelectorAll('.positionDetails li');
    if (det[0]) aiInject(li, '__ai-department', (det[0].textContent || '').trim());
    if (det[1]) aiInject(li, '__ai-employmentType', (det[1].textContent || '').trim());
  }
}

/* ------------------------------------------------------------------ *
 * DETAIL SCOPE — the data-qa blocks are two-column .careerCard rows:
 * column 1 (.positionInfo) is the prose, column 2 holds the apply
 * iframe. structuredText scopes to .positionInfo and restores block
 * line breaks (textContent alone collapses to one run-on blob).
 * ------------------------------------------------------------------ */
if (!document.querySelector('.__ai-description')) {
  var dEl = document.querySelector('[data-qa="positionDescription"]');
  var rEl = document.querySelector('[data-qa="positionRequirements"]');
  if (dEl || rEl) {
    var box = document.createElement('div');
    box.setAttribute('data-ai-detail', '1');
    box.style.display = 'none';

    var dTxt = aiStripLabel(structuredText(dEl));
    if (dTxt) {
      var dd = document.createElement('div');
      dd.className = '__ai-description';
      dd.textContent = dTxt;
      box.appendChild(dd);
    }
    var rTxt = aiStripLabel(structuredText(rEl));
    if (rTxt) {
      var rr = document.createElement('div');
      rr.className = '__ai-requirements';
      rr.textContent = rTxt;
      box.appendChild(rr);
    }
    if (box.childNodes.length) document.body.appendChild(box);
  }
}

/* ------------------------------------------------------------------ *
 * DETAIL SCOPE — location. Sourced from the detail page's own
 * [data-qa="headerLocation"] rather than the listing group heading:
 * the group is a coarse label ("Tel Aviv, Israel") while the per-job
 * header names the real office ("גבעתיים, מחוז תל אביב, IL").
 * Comeet emits this field in mixed languages, so the English plant
 * names are mapped to the Hebrew gazetteer spellings (city.csv) —
 * without this the gazetteer leaves them un-normalised and the
 * dashboard cannot filter them by city. Hebrew values pass through.
 * ------------------------------------------------------------------ */
if (!document.querySelector('.__ai-location')) {
  var hl = document.querySelector('[data-qa="headerLocation"]');
  if (hl) {
    var raw = (hl.textContent || '').replace(/[﻿​]/g, '').trim();
    var city = raw.split(',')[0].trim();
    var HE = {
      hatzerim: 'חצרים',
      magal: 'מגל',
      yiftah: 'יפתח',
      israel: 'פריסה ארצית',
      'tel aviv': 'תל אביב-יפו',
      givatayim: 'גבעתיים'
    };
    var key = city.toLowerCase();
    var val = HE[key] || city;
    if (val) {
      var lc = document.createElement('div');
      lc.className = '__ai-location';
      lc.style.display = 'none';
      lc.textContent = val;
      document.body.appendChild(lc);
    }
  }
}
