// topbit.co.il /vacancies/ (WordPress CPT "vacancies", theme topbit-2024), server-rendered.
// Two-step flow: listing cards .vacancies__item -> detail page /vacancies/<slug>/.
//
// Listing (runs where .vacancies__item exists):
// - externalJobId: the ASCII post slug from the card's "קרא עוד" link, as topbit-<slug>
//   (vacancy-1 -> topbit-vacancy-1). A Latin slug is a native id (addsite3 6.2).
// - publishDate: the card's <time> ("26 דצמ 2024") as YYYY-MM-DD.
// Detail (runs where .vacancyPage__content exists), injected into a hidden #__ai-detail:
// - description: the ad's lines (p / h2, split at <br>), as printed, minus the "שלח קו"ח" button.
//   The phone line and the mail@ line stay: the form is the apply path, the email is a parallel
//   one printed in the ad (callbiz owner rule).
// - requirements: the "*עדיפות ..." line (moved, not copied).
// - location: the ad's "סניף <place>" lines, mapped through a closed list of verbatim city.csv
//   rows; none -> "Unknown".
// - applicationInfo: this job's own apply-form blob. The page's form has a hidden "position"
//   that the theme's scripts.js fills with the page h1 only on click, and it posts by script
//   (FormData + action=form_sender_vacancy) to admin-ajax.php. The blob carries both, with
//   position = this job's h1 (LRN-FORM-13).
var MONTHS = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יונ', 'יול', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ'];
var PLACES = { 'מודיעין': 'מודיעין', 'בית שמש': 'בית שמש' }; // values verbatim in CSV files/city.csv
var clean = function (s) { return (s || '').replace(/\s+/g, ' ').trim(); };
var add = function (parent, cls, val) {
  var e = document.createElement('div');
  e.className = cls;
  if (typeof val === 'string') e.textContent = val;
  else for (var v = 0; v < val.length; v++) { var q = document.createElement('p'); q.textContent = val[v]; e.appendChild(q); }
  parent.appendChild(e);
  return e;
};

var cards = document.querySelectorAll('.vacancies__item');
for (var i = 0; i < cards.length; i++) {
  var it = cards[i];
  try {
    if (it.querySelector('.__ai-id')) continue;
    var a = it.querySelector('a.vacancies__more');
    var m = a ? /\/vacancies\/([A-Za-z0-9_-]+)\/?$/.exec(a.getAttribute('href') || '') : null;
    var box = document.createElement('div');
    box.style.display = 'none';
    if (m) add(box, '__ai-id', 'topbit-' + m[1]);
    var t = it.querySelector('time');
    var d = t ? /(\d{1,2})\s+(\S+)\s+(\d{4})/.exec(clean(t.textContent)) : null;
    if (d) {
      var mi = -1;
      for (var k = 0; k < MONTHS.length; k++) if (d[2].indexOf(MONTHS[k]) === 0) mi = k;
      if (mi >= 0) add(box, '__ai-date', d[3] + '-' + ('0' + (mi + 1)).slice(-2) + '-' + ('0' + d[1]).slice(-2));
    }
    it.appendChild(box);
  } catch (e) { /* degrade per card */ }
}

var body = document.querySelector('.vacancyPage__content');
if (body && !document.getElementById('__ai-detail')) {
  try {
    var desc = [], req = [], places = [];
    var blocks = body.querySelectorAll(':scope > p, :scope > h2, :scope > h3, :scope > ul > li');
    for (var b = 0; b < blocks.length; b++) {
      var parts = [], cur = '';
      var nodes = blocks[b].childNodes;
      for (var n = 0; n < nodes.length; n++) {
        if (nodes[n].nodeName === 'BR') { parts.push(cur); cur = ''; } else cur += nodes[n].textContent || '';
      }
      parts.push(cur);
      for (var p = 0; p < parts.length; p++) {
        var line = clean(parts[p]);
        if (!line) continue;
        if (/^\*\s*עדיפות/.test(line)) { req.push(line); continue; }
        var s = /^סניף\s+(.+)$/.exec(line);
        if (s && PLACES[clean(s[1])] && places.indexOf(PLACES[clean(s[1])]) < 0) places.push(PLACES[clean(s[1])]);
        desc.push(line);
      }
    }
    var root = document.createElement('div');
    root.id = '__ai-detail';
    root.style.display = 'none';
    if (desc.length) add(root, '__ai-description', desc);
    if (req.length) add(root, '__ai-requirements', req);
    add(root, '__ai-location', places.length ? places.join(', ') : 'Unknown');
    var form = document.querySelector('form.modalVacancy__form');
    var h1 = document.querySelector('.vacancyPage__titleBox h1');
    if (form && h1) {
      var fields = [{ name: 'action', label: '', tagName: 'INPUT', required: false, fieldType: 'hidden', value: 'form_sender_vacancy' }];
      var ins = form.querySelectorAll('input, textarea, select');
      for (var f = 0; f < ins.length; f++) {
        var el = ins[f];
        var type = (el.getAttribute('type') || el.tagName).toLowerCase();
        if (!el.name || /^(submit|button|reset|image)$/.test(type)) continue;
        var lab = el.id ? form.querySelector('label[for="' + el.id + '"]') : null;
        var label = clean((lab && lab.textContent) || el.getAttribute('placeholder') || '').replace(/^\*|\*$/g, '');
        var fld = { name: el.name, label: clean(label), tagName: el.tagName, required: el.hasAttribute('required'), fieldType: el.tagName === 'INPUT' ? type : el.tagName.toLowerCase() };
        if (el.name === 'position') fld.value = h1.textContent || '';
        fields.push(fld);
      }
      var ajax = location.origin + '/wp-admin/admin-ajax.php';
      add(root, '__ai-apply', JSON.stringify({ actionUrl: ajax, actionAttribute: ajax, method: 'POST', enctype: 'multipart/form-data', fields: fields }));
    }
    document.body.appendChild(root);
  } catch (e) { /* degrade: no injected detail fields */ }
}
