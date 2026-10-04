// ofeksec.org.il/career-ofek — WordPress theme, 3 role cards (a.career-item), each
// linking a static role page. The listing carries only title + teaser, so this
// fetches each role page and injects: externalJobId (ofeksec-<ASCII slug>; the page
// prints no job number), description, requirements, applicationInfo (the role's own
// "להגשת מועמדות" link, a monday.com form) and location.
// Location is the literal "Unknown" by owner decision (2026-10-04): every role works
// at an overseas station, and the only Israeli places on the page are training
// sites, which are not where the job is.
var ITEM_SEL = 'a.career-item';

var NBSP = new RegExp(String.fromCharCode(160), 'g');
var clean = function (s) {
  return (s || '').replace(NBSP, ' ').replace(/[ \t]+/g, ' ').trim();
};

// Text of one block element, keeping <br> as a line break.
var blockText = function (el) {
  var c = el.cloneNode(true);
  c.querySelectorAll('br').forEach(function (br) { br.replaceWith('\n'); });
  return (c.textContent || '').split('\n').map(clean).filter(Boolean);
};

// Leaf blocks (p / li / headings) under root, in document order.
var blockLines = function (root) {
  var out = [];
  if (!root) return out;
  root.querySelectorAll('p, li, h3, h4, h5').forEach(function (el) {
    if (el.querySelector('p, li')) return;          // only leaves
    if (el.closest('a.btn')) return;                // the apply button's label
    out = out.concat(blockText(el));
  });
  return out;
};

var parseRole = function (doc) {
  var desc = blockLines(doc.querySelector('.single-page-top .desc-text'));
  var reqs = [];
  var extra = [];
  doc.querySelectorAll('.single-page-top ul.selectbox').forEach(function (sec) {
    var head = clean((sec.querySelector('.resource-selectbox-title') || {}).textContent);
    var body = blockLines(sec.querySelector('.selectbox-dropdown'));
    if (/^דרישות/.test(head)) { reqs = reqs.concat(body); return; }   // label dropped (rule 2)
    if (body.length) extra.push([head].concat(body).join('\n'));
  });

  var parts = [desc.join('\n')].concat(extra);

  var main = doc.querySelector('.single-page-main');
  if (main) {
    var h2 = main.querySelector('h2');
    var steps = [];
    main.querySelectorAll('.grid-narrow > p, .grid-narrow > h3, .single-page-step h4').forEach(function (el) {
      steps = steps.concat(blockText(el));
    });
    if (steps.length) parts.push([h2 ? clean(h2.textContent) : ''].concat(steps).filter(Boolean).join('\n'));
  }

  var places = doc.querySelector('section.places');
  if (places) {
    var ph = places.querySelector('h2');
    var names = [];
    places.querySelectorAll('.swiper-slide h5').forEach(function (h) { var t = clean(h.textContent); if (t) names.push(t); });
    if (names.length) parts.push([ph ? clean(ph.textContent) : ''].concat(names).filter(Boolean).join('\n'));
  }

  // Printed under each apply button; one copy per job.
  var note = '';
  doc.querySelectorAll('.single-page-top a.btn.primary + p').forEach(function (p) { if (!note) note = clean(p.textContent); });
  if (note) parts.push(note);

  var apply = doc.querySelector('.single-page-top a.btn.primary[href]');
  return {
    description: parts.filter(Boolean).join('\n\n'),
    requirements: reqs.join('\n'),
    apply: apply ? apply.getAttribute('href') : ''
  };
};

var add = function (item, cls, val) {
  if (!val) return;
  var s = document.createElement('span');
  s.className = cls;
  s.style.display = 'none';
  s.textContent = val;
  item.appendChild(s);
};

var items = document.querySelectorAll(ITEM_SEL);
for (var i = 0; i < items.length; i++) {
  var it = items[i];
  if (it.querySelector('.__ai-externalJobId')) continue;   // re-run guard
  var href = it.href || '';
  var slug = (href.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop() || '').toLowerCase();
  if (!/^[a-z0-9-]+$/.test(slug)) continue;                // never a non-ASCII or empty id
  add(it, '__ai-externalJobId', 'ofeksec-' + slug);
  add(it, '__ai-location', 'Unknown');
  var a = document.createElement('a');
  a.className = '__ai-detailurl';
  a.href = href;
  it.appendChild(a);
  try {
    var res = await fetch(href, { credentials: 'omit' });
    if (!res.ok) continue;
    var doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    var r = parseRole(doc);
    add(it, '__ai-description', r.description);
    add(it, '__ai-requirements', r.requirements);
    add(it, '__ai-applicationInfo', r.apply);
  } catch (e) { /* role page unreachable: fields stay empty and QA reports it */ }
}
