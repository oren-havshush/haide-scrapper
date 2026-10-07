// negba.org "דרושים" page: Elementor (UiCore) page, listing-only, every job inline, no detail pages.
//
// Each job is one Elementor child container: an h3 heading (the title) and a text-editor widget
// holding "תיאור התפקיד:" + <ul>, "דרישות התפקיד:" + <ul> (wrapped in pasted job-board divs),
// "* משרה זו פונה לנשים וגברים כאחד." and the apply line
// "קורות חיים ניתן להעביר לדוא"ל – <mailto>".
//
// - title: the h3 text as printed.
// - externalJobId: NOT emitted. No printed job number, no per-job URL, no id attribute (the
//   elementor-element-xxxx classes are editor widget ids). The worker synthesises the h- id
//   itself (addsite3 6.2).
// - description / requirements: split at the section labels; labels dropped; the apply line
//   leaves the body (it is applicationInfo). The gender line stays in description. <li> lines
//   keep their list, <p> lines stay paragraphs; text copied as-is.
// - applicationInfo: the job's own mailto, bare (the page gives no instruction for the email).
// - location: places from the title and from the ad's hiring line ("... בבאר שבע דרוש/ה"),
//   matched against a closed list of city.csv rows. Nothing matched -> "Unknown" (injected so the
//   worker's gazetteer does not guess from prose). A neighbourhood (קריית מנחם) is never a value.
var ITEM_SEL = 'main .e-con.e-child:has(h3.elementor-heading-title)';
var PLACES = ['ירושלים', 'באר שבע', 'אופקים']; // each verbatim in CSV files/city.csv
var placeRe = new RegExp('(?:^|[\\s/,(])(?:ו?ב)?(' + PLACES.join('|') + ')(?=$|[\\s/,.):])', 'g');
var findPlaces = function (s, out) {
  placeRe.lastIndex = 0;
  var m;
  while ((m = placeRe.exec(s))) if (out.indexOf(m[1]) < 0) out.push(m[1]);
};

var items = document.querySelectorAll(ITEM_SEL);
for (var i = 0; i < items.length; i++) {
  var item = items[i];
  try {
    if (item.querySelector('.__ai-title')) continue; // re-run guard

    var h = item.querySelector('h3.elementor-heading-title');
    var title = h ? (h.textContent || '').replace(/\s+/g, ' ').trim() : '';

    var body = item.querySelector('.elementor-widget-text-editor');
    var blocks = body ? body.querySelectorAll('p, li') : [];
    var desc = [], req = [], mode = 'desc', mail = '', hiring = [];
    for (var b = 0; b < blocks.length; b++) {
      var el = blocks[b];
      var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      if (/^תיאור התפקיד\s*:?$/.test(text)) { mode = 'desc'; continue; }
      if (/^דרישות התפקיד\s*:?$/.test(text)) { mode = 'req'; continue; }
      if (/^קורות חיים ניתן להעביר/.test(text)) continue; // apply line -> applicationInfo
      var line = { li: el.tagName === 'LI', text: text };
      if (/^\*\s*משרה זו פונה/.test(text)) { desc.push(line); continue; } // not a requirement
      if (mode === 'desc' && /דרוש/.test(text)) hiring.push(text);
      (mode === 'req' ? req : desc).push(line);
    }
    var a = item.querySelector('a[href^="mailto:"]');
    if (a) mail = (a.getAttribute('href') || '').replace(/^mailto:/i, '').split('?')[0].trim();

    var places = [];
    for (var hi = 0; hi < hiring.length; hi++) findPlaces(hiring[hi], places);
    findPlaces(title, places);

    var add = function (cls, val) {
      var wrap = document.createElement('div');
      wrap.className = cls;
      wrap.style.display = 'none';
      if (typeof val === 'string') { wrap.textContent = val; item.appendChild(wrap); return; }
      var ul = null;
      for (var v = 0; v < val.length; v++) {
        if (val[v].li) {
          if (!ul) { ul = document.createElement('ul'); wrap.appendChild(ul); }
          var li = document.createElement('li');
          li.textContent = val[v].text;
          ul.appendChild(li);
        } else {
          ul = null;
          var p = document.createElement('p');
          p.textContent = val[v].text;
          wrap.appendChild(p);
        }
      }
      item.appendChild(wrap);
    };
    add('__ai-title', title);
    if (desc.length) add('__ai-description', desc);
    if (req.length) add('__ai-requirements', req);
    if (mail) add('__ai-apply', 'mailto:' + mail);
    add('__ai-location', places.length ? places.join(', ') : 'Unknown');
  } catch (e) {
    // degrade per item (LRN-WRK-19)
  }
}
