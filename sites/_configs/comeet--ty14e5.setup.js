/* Ceragon, Comeet board. Runs on listing AND detail pages.
   LISTING: drop non-IL rows; jobid, department, location. DETAIL: body, employmentType. */

var NL = String.fromCharCode(10);
/* fromCharCode: invisible chars in a regex literal have disabled a guard before (CLAUDE.md). */
var ZW = new RegExp('[' + String.fromCharCode(0xFEFF, 0x200B, 0x200C, 0x200D, 0x2060) + ']', 'g');
var NBSP = new RegExp(String.fromCharCode(0x00A0), 'g');

function aiClean(t) {
  t = String(t || '').replace(ZW, '').replace(NBSP, ' ');
  var lines = t.split(NL);
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i].replace(/[ \t]+/g, ' ').trim();
    if (/^apply for this job$/i.test(l)) break;
    if (!l) {
      if (out.length && out[out.length - 1] !== '') out.push('');
      continue;
    }
    out.push(l);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join(NL).trim();
}

/* textContent alone collapses the block to one run-on line (addsite2 §7). */
function structuredText(el) {
  if (!el) return '';
  var c = el.cloneNode(true), i;
  var kill = c.querySelectorAll('style,script,link,meta,iframe,img,noscript,form,button,svg');
  for (i = kill.length - 1; i >= 0; i--) kill[i].parentNode.removeChild(kill[i]);
  var brk = c.querySelectorAll('p,div,ul,ol,li,br,h1,h2,h3,h4,h5,h6,tr');
  for (i = 0; i < brk.length; i++) brk[i].insertAdjacentText('afterend', NL);
  return aiClean(c.textContent || '');
}

/* Company boilerplate on 7 of 14 postings, 2 versions (owner, 2026-09-29). One
   distinctive phrase per paragraph; NOT "global innovator", which 70.F65's own
   intro uses. "Who We Are?" goes only above a dropped line. */
var BOILER = [
  /provider of end-to-end wireless connectivity, specializing in transport/i,
  /deployed by more than 600 service providers/i,
  /enable our customers to embrace the future of wireless technology/i,
  /lower TCO through minimal use of spectrum/i
];

function aiIsBoiler(l) {
  for (var k = 0; k < BOILER.length; k++) if (BOILER[k].test(l)) return true;
  return false;
}

function aiDropBoilerplate(s) {
  var lines = String(s || '').split(NL), out = [], i, j;
  for (i = 0; i < lines.length; i++) {
    if (aiIsBoiler(lines[i])) continue;
    if (/^who we are\s*[?:]*$/i.test(lines[i].trim())) {
      for (j = i + 1; j < lines.length && !lines[j].trim(); j++) {}
      if (j < lines.length && aiIsBoiler(lines[j])) continue;
    }
    out.push(lines[i]);
  }
  return aiClean(out.join(NL));
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

/* Separator before the position UID varies; take the last path segment. */
function uidFromHref(href) {
  var clean = String(href || '').split(/[?#]/)[0].replace(/\/+$/, '');
  var segs = clean.split('/'), out = '', i;
  for (i = 0; i < segs.length; i++) if (segs[i]) out = segs[i];
  return out;
}

/* city.csv verbatim; an unmapped city injects nothing (LRN-LOC-4). */
var CITY = {
  "rosh ha'ayin": 'ראש העין',
  'rosh haayin': 'ראש העין',
  'rosh ha-ayin': 'ראש העין'
};

var onDetail = !!document.querySelector('[data-qa="requirementFieldContent"]');

/* ---------------- LISTING SCOPE ---------------- */
if (!onDetail) {
  /* Wait for a stable item count (LRN-SETUP-13). */
  var prev = -1, stable = 0;
  for (var t = 0; t < 40; t++) {
    var n = document.querySelectorAll('a.positionItem').length;
    if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
    prev = n;
    await new Promise(function (r) { setTimeout(r, 500); });
  }

  /* Global board; keep IL only. Country from the board's data by UID, else the printed location. */
  var byUid = {};
  var data = window.COMPANY_POSITIONS_DATA;
  if (data && data.length) {
    for (var d = 0; d < data.length; d++) if (data[d] && data[d].uid) byUid[data[d].uid] = data[d].location || {};
  }

  /* Department = nearest PRECEDING .positionsGroupTitle, so walk in doc order. */
  var nodes = document.querySelectorAll('.positionsGroupTitle, a.positionItem');
  var dept = '';
  for (var i = 0; i < nodes.length; i++) {
    var nd = nodes[i];
    if (String(nd.className || '').indexOf('positionsGroupTitle') !== -1) {
      dept = (nd.textContent || '').replace(/\s+/g, ' ').trim();
      continue;
    }
    var li = nd.closest('li');
    if (!li) continue;
    var uid = uidFromHref(nd.getAttribute('href'));
    var loc = byUid[uid];
    var printed = nd.querySelector('.positionDetails li');
    printed = printed ? (printed.textContent || '').replace(/\s+/g, ' ').trim() : '';
    var isIL = loc ? loc.country === 'IL' : /^israel\b/i.test(printed);
    if (!isIL) {
      if (li.parentNode) li.parentNode.removeChild(li);
      continue;
    }
    aiInject(li, '__ai-jobid', uid);
    if (dept) aiInject(li, '__ai-department', dept);
    var cityRaw = loc && loc.city ? loc.city : printed.replace(/^israel\s*/i, '');
    var city = CITY[String(cityRaw).replace(/\s+/g, ' ').trim().toLowerCase()];
    if (city) aiInject(li, '__ai-location', city);
  }
}

/* ---------------- DETAIL SCOPE ---------------- */
if (onDetail && !document.querySelector('[data-ai-detail]')) {
  var box = document.createElement('div');
  box.setAttribute('data-ai-detail', '1');
  box.style.display = 'none';

  /* Route each section by its own label (LRN-SPA-13); requirements are not repeated in description. */
  var secs = document.querySelectorAll('[data-qa="requirementFieldContent"]');
  var desc = [], req = [];
  for (var s2 = 0; s2 < secs.length; s2++) {
    var sec = secs[s2];
    var h = sec.parentElement ? sec.parentElement.querySelector('[data-qa="requirementFieldTitle"]') : null;
    var label = h ? (h.textContent || '').replace(/\s+/g, ' ').trim() : '';
    var body = structuredText(sec);
    if (!body) continue;
    var isReq = /requirement|qualification|skill|advantage|nice to have/.test(label.toLowerCase());
    var restates = /^(description|job description|requirements|qualifications|skills)$/i.test(label);
    /* Benefits typed inside Requirements (27.E62 "Why Join Us?") go to description. */
    var perks = '';
    if (isReq) {
      var bl = body.split(NL);
      for (var b = 0; b < bl.length; b++) {
        if (/^(why join us|what we offer|we offer|benefits)\s*[?:]*$/i.test(bl[b])) {
          perks = aiClean(bl.slice(b).join(NL));
          body = aiClean(bl.slice(0, b).join(NL));
          break;
        }
      }
    }
    if (!isReq) body = aiDropBoilerplate(body);
    if (body) (isReq ? req : desc).push((label && !restates) ? (label + ':' + NL + body) : body);
    if (perks) desc.push(perks);
  }
  if (desc.length) {
    var dd = document.createElement('div');
    dd.className = '__ai-description';
    dd.textContent = desc.join(NL + NL);
    box.appendChild(dd);
  }
  if (req.length) {
    var rr = document.createElement('div');
    rr.className = '__ai-requirements';
    rr.textContent = req.join(NL + NL);
    box.appendChild(rr);
  }

  var eEl = document.querySelector('[data-qa="positionDetailEmploymentType"]');
  var emp = eEl ? (eEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
  if (emp) {
    var ee = document.createElement('div');
    ee.className = '__ai-employmentType';
    ee.textContent = emp;
    box.appendChild(ee);
  }

  if (box.childNodes.length) document.body.appendChild(box);
}
