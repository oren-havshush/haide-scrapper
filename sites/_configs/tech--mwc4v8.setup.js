// tech.co.il/careers (TECH): Next.js static export, the jobs are in the server HTML, listing-only config.
//
// Each job is one div[id^="position-"] card under a category heading (h3: "Development and Technology",
// "Design", "Digital"). The card holds the title (h4), a location chip, a scope chip ("Full Time"), the
// intro text, then hidden-until-opened blocks headed "Responsibilities:" / "Requirements:" / "Advantages:"
// (h4 + .prose list), then the job's own apply form.
//
// - externalJobId: the card's own id attribute (position-11663) as tech-<n>.
// - detailUrl: the card's anchor on the page, /careers#position-<n> (the element id exists in the page).
// - department: the category heading above the card's group.
// - location: the chip, mapped to its city.csv row; anything else -> "Unknown".
// - description: the scope chip line, the intro, then "Responsibilities:" (title kept) and its list.
//   requirements: the "Requirements:" list (generic label dropped) and "Advantages:" (title kept) with its
//   list. Text as printed; the form never enters either field.
// - applicationInfo / _formData: the card's own form as the page has it, plus the two values the page script
//   adds at submit: "position" = this job's title and "captcha" (a reCAPTCHA v3 token the browser makes at
//   submit; a server-side submit cannot replay it). The script posts multipart to /api/positions/apply.
var ITEM_SEL = 'div[id^="position-"]';
var prev = -1, stable = 0;
for (var t = 0; t < 60; t++) {
  var n = document.querySelectorAll(ITEM_SEL).length;
  if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n;
  await new Promise(function (r) { setTimeout(r, 500); });
}

var PLACES = { 'bnei brak': 'בני ברק', 'tel-aviv': 'תל אביב-יפו', 'tel aviv': 'תל אביב-יפו' }; // verbatim city.csv rows
var DROP_H = /^requirements:?$/i;
var REQ_H = /^(requirements|advantages):?$/i;
var clean = function (s) { return String(s || '').replace(/\s+/g, ' ').trim(); };
var render = function (cls, rows) {
  var box = document.createElement('div'), ul = null;
  box.className = cls; box.style.display = 'none';
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r.li) {
      if (!ul) { ul = document.createElement('ul'); box.appendChild(ul); }
      var li = document.createElement('li'); li.textContent = r.t; ul.appendChild(li);
    } else {
      ul = null;
      var p = document.createElement('p'); p.textContent = r.t; box.appendChild(p);
    }
  }
  return box;
};
var hidden = function (cls, text, href) {
  var e = document.createElement(href ? 'a' : 'span');
  e.className = cls; e.style.display = 'none'; e.textContent = text;
  if (href) e.setAttribute('href', href);
  return e;
};
var listRows = function (el, out) {
  var c = el.cloneNode(true);
  var lis = c.querySelectorAll('li');
  if (lis.length) { for (var i = 0; i < lis.length; i++) { var lt = clean(lis[i].textContent); if (lt) out.push({ t: lt, li: true }); } return; }
  c.querySelectorAll('br').forEach(function (b) { b.replaceWith('\n'); });
  var ls = (c.textContent || '').split('\n');
  for (var j = 0; j < ls.length; j++) { var s = clean(ls[j]); if (s) out.push({ t: s, li: false }); }
};

var items = document.querySelectorAll(ITEM_SEL);
for (var i = 0; i < items.length; i++) {
  var item = items[i];
  try {
    if (item.querySelector('.__ai-title')) continue;
    var num = (/^position-(\d+)$/.exec(item.id) || [])[1] || '';
    var h4 = item.querySelector('h4');
    var title = clean(h4 ? h4.textContent : '');
    var head = h4 ? h4.parentElement : null;
    var locEl = head ? head.querySelector('span') : null;
    var locRaw = clean(locEl ? locEl.textContent : '');
    var loc = PLACES[locRaw.toLowerCase()] || 'Unknown';
    var scopeEl = head && head.nextElementSibling ? head.nextElementSibling : null;
    var scope = clean(scopeEl ? scopeEl.textContent : '');
    var grp = item.parentElement, cat = grp ? grp.previousElementSibling : null;
    var dept = cat && cat.tagName === 'H3' ? clean(cat.textContent) : '';

    var desc = [], req = [];
    if (scope) desc.push({ t: scope, li: false });
    var body = item.querySelector('.flex-1 > div');
    var intro = body ? body.firstElementChild : null;
    if (intro) listRows(intro, desc);
    var mode = desc;
    var blocks = intro && intro.nextElementSibling ? intro.nextElementSibling.children : [];
    for (var b = 0; b < blocks.length; b++) {
      var el = blocks[b];
      if (el.tagName === 'H4') {
        var ht = clean(el.textContent);
        mode = REQ_H.test(ht) ? req : desc;
        if (!DROP_H.test(ht)) mode.push({ t: ht, li: false });
        continue;
      }
      if (el.tagName === 'BUTTON' || el.tagName === 'FORM') continue;
      listRows(el, mode);
    }

    var url = location.origin + '/careers#position-' + num;
    item.appendChild(hidden('__ai-title', title));
    if (num) item.appendChild(hidden('__ai-jobid', 'tech-' + num));
    item.appendChild(hidden('__ai-detailUrl', url, url));
    if (dept) item.appendChild(hidden('__ai-department', dept));
    item.appendChild(hidden('__ai-location', loc));
    item.appendChild(render('__ai-description', desc));
    item.appendChild(render('__ai-requirements', req));

    var fm = item.querySelector('form');
    if (fm) {
      var fields = [];
      var els = fm.querySelectorAll('input, select, textarea');
      for (var e = 0; e < els.length; e++) {
        var fe = els[e];
        var ft = (fe.getAttribute('type') || fe.tagName).toLowerCase();
        if (ft === 'submit' || ft === 'button' || ft === 'reset' || ft === 'image' || !fe.name) continue;
        var lab = fe.id ? fm.querySelector('label[for="' + fe.id + '"]') : null;
        var star = !!(lab && /content-\[/.test(lab.className || ''));
        var fo = { name: fe.name, label: lab ? clean(lab.textContent) : '', fieldType: ft, required: fe.hasAttribute('required') || star, tagName: fe.tagName };
        if (fe.getAttribute('accept')) fo.accept = fe.getAttribute('accept');
        if (fe.getAttribute('maxlength')) fo.maxLength = Number(fe.getAttribute('maxlength'));
        fields.push(fo);
      }
      fields.push({ name: 'position', label: '', fieldType: 'hidden', required: false, tagName: 'INPUT', value: title });
      fields.push({ name: 'captcha', label: '', fieldType: 'hidden', required: true, tagName: 'INPUT', value: '' });
      var EP = location.origin + '/api/positions/apply';
      var blob = JSON.stringify({ actionUrl: EP, actionAttribute: EP, method: 'POST', enctype: 'multipart/form-data', fields: fields });
      item.appendChild(hidden('__ai-applicationInfo', blob));
      item.appendChild(hidden('__ai-formData', blob));
    }
  } catch (err) { /* one bad card never stops the rest */ }
}
