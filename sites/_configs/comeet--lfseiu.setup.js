/* Mentee Robotics — Comeet board. Runs on BOTH pageFlow scopes, so each block is guarded.
   LISTING: externalJobId (Comeet position UID) + department (group heading).
   DETAIL : description / requirements (routed by section label), location, employmentType. */

var NL = String.fromCharCode(10);
/* fromCharCode on purpose: these are invisible in a regex literal, and this repo
   has silently disabled a guard exactly that way before (CLAUDE.md). */
var ZW = new RegExp('[' + String.fromCharCode(0xFEFF, 0x200B, 0x200C, 0x200D, 0x2060) + ']', 'g');
var NBSP = new RegExp(String.fromCharCode(0x00A0), 'g');
var HEB = new RegExp('[' + String.fromCharCode(0x05D0) + '-' + String.fromCharCode(0x05EA) + ']');

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

/* Company boilerplate printed verbatim on all 7 postings (768 of an average
   1341-char description). Owner rule, as on the Mobileye board: board-wide
   "about us" copy is not part of any one job's description. Matched on a
   distinctive phrase per paragraph, NOT on the whole "Description" section,
   so a future posting that puts real job-specific intro there keeps it. */
var BOILER = [
  /brings world-class robotics expertise/i,
  /our technologies power more than/i
];

function aiDropBoilerplate(s) {
  var lines = String(s || '').split(NL), out = [], i, k, drop;
  for (i = 0; i < lines.length; i++) {
    drop = false;
    for (k = 0; k < BOILER.length; k++) if (BOILER[k].test(lines[i])) { drop = true; break; }
    if (!drop) out.push(lines[i]);
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

/* The slug between board UID and position UID is the slugified title, so the
   separator varies per item. Take the last non-empty path segment. */
function uidFromHref(href) {
  var clean = String(href || '').split(/[?#]/)[0].replace(/\/+$/, '');
  var segs = clean.split('/'), out = '', i;
  for (i = 0; i < segs.length; i++) if (segs[i]) out = segs[i];
  return out;
}

/* city.csv verbatim. The board prints the office in English and the product's
   city filter has no bucket for "Herzliya". An UNMAPPED value is injected not
   at all, so a new office ships empty rather than unfilterable (LRN-LOC-4). */
var CITY = {
  'herzliya': 'הרצליה',
  'hertzliya': 'הרצליה',
  'herzeliya': 'הרצליה',
  'tel aviv': 'תל אביב-יפו',
  'tel-aviv': 'תל אביב-יפו',
  'ramat gan': 'רמת גן',
  'petah tikva': 'פתח תקווה',
  'haifa': 'חיפה',
  'jerusalem': 'ירושלים',
  'raanana': 'רעננה',
  'kfar saba': 'כפר סבא',
  'netanya': 'נתניה'
};

function aiCity(raw) {
  var s = String(raw || '').replace(ZW, '').replace(NBSP, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  var city = s.split(',')[0].trim();
  var hit = CITY[city.toLowerCase()];
  if (hit) return hit;
  return HEB.test(city) ? city : '';
}

var onDetail = !!document.querySelector('[data-qa="requirementFieldContent"]');

/* ---------------- LISTING SCOPE ---------------- */
if (!onDetail) {
  /* Poll: the worker runs this before its own autoScrollUntilStable
     (LRN-SETUP-13). Exits at once on an already-rendered page. */
  var prev = -1, stable = 0;
  for (var t = 0; t < 40; t++) {
    var n = document.querySelectorAll('a.positionItem').length;
    if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
    prev = n;
    await new Promise(function (r) { setTimeout(r, 500); });
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
    aiInject(li, '__ai-jobid', uidFromHref(nd.getAttribute('href')));
    if (dept) aiInject(li, '__ai-department', dept);
  }
}

/* ---------------- DETAIL SCOPE ---------------- */
if (onDetail && !document.querySelector('[data-ai-detail]')) {
  var box = document.createElement('div');
  box.setAttribute('data-ai-detail', '1');
  box.style.display = 'none';

  /* Sections are <h3 data-qa=requirementFieldTitle> + sibling content block.
     On THIS board the populated wrapper is positionRequirements and it holds
     ALL sections, so route each block by its own label instead (LRN-SPA-13).
     Requirements-class -> requirements, NOT repeated in description (owner
     rule). "Advantages" keeps its label: it marks preferred vs mandatory. */
  var secs = document.querySelectorAll('[data-qa="requirementFieldContent"]');
  var desc = [], req = [];
  for (var s2 = 0; s2 < secs.length; s2++) {
    var sec = secs[s2];
    var h = sec.parentElement ? sec.parentElement.querySelector('[data-qa="requirementFieldTitle"]') : null;
    var label = h ? (h.textContent || '').replace(/\s+/g, ' ').trim() : '';
    var body = structuredText(sec);
    if (!body) continue;
    var isReq = /requirement|qualification|skill|advantage|nice to have|דרישות|כישורים|יתרון/.test(label.toLowerCase());
    if (!isReq) {
      body = aiDropBoilerplate(body);
      if (!body) continue;
    }
    var restates = /^(description|job description|requirements|qualifications|skills)$/i.test(label);
    var chunk = (label && !restates) ? (label + ':' + NL + body) : body;
    (isReq ? req : desc).push(chunk);
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

  var lEl = document.querySelector('[data-qa="positionDetailLocation"]');
  var city = aiCity(lEl ? lEl.textContent : '');
  if (city) {
    var lc = document.createElement('div');
    lc.className = '__ai-location';
    lc.textContent = city;
    box.appendChild(lc);
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
