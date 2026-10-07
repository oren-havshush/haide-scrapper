// kortec.co.il careers page ("קריירה בקורטק") — Elementor toggle (accordion), listing-only.
//
// Each .elementor-toggle-item is one job: the title is the toggle heading, the body is one
// Yoast FAQ <p> whose lines are separated by <br>, labelled with <strong>תיאור התפקיד</strong>
// and <strong>דרישות התפקיד:</strong> / <strong>דרישות תפקיד:</strong>, and closing with
// "מייל לשליחת קורות חיים – orit@kortec.co.il" (mailto link).
//
// - title: heading text as printed, trailing colon kept (owner 2026-10-07).
// - externalJobId: NOT emitted. No printed job number, no per-job URL, no id attribute; the
//   elementor-tab-title-139N ids are panel positions (LRN-ID-3/10). The worker synthesises an
//   h- id from the title (addsite3 6.2).
// - description / requirements: split at the requirements label; labels dropped; the apply
//   line leaves the body (it is applicationInfo). One <p> per original line, no characters added.
// - applicationInfo: the item's own mailto, bare (the page gives no instruction for the email).
// - location: "קיבוץ חנתון" on every item, the value the site prints and the HQ city (owner 2026-10-07:
//   single-site company). Injected, never left empty (LRN-LOC-7): the gazetteer would publish "חנתון".
var items = document.querySelectorAll('.elementor-toggle .elementor-toggle-item');
for (var i = 0; i < items.length; i++) {
  var item = items[i];
  try {
    if (item.querySelector('.__ai-title')) continue; // re-run guard

    var tEl = item.querySelector('.elementor-toggle-title');
    var title = tEl ? (tEl.textContent || '').replace(/\s+/g, ' ').trim() : '';

    var content = item.querySelector('.elementor-tab-content');
    var desc = [], req = [], mode = 'desc', mail = '';
    var ps = content ? content.querySelectorAll('p') : [];
    for (var p = 0; p < ps.length; p++) {
      // Split the paragraph into lines at <br>, remembering whether a line opens with <strong>.
      var lines = [], cur = '', curStrong = '', atStart = true;
      var kids = ps[p].childNodes;
      for (var k = 0; k < kids.length; k++) {
        var n = kids[k];
        if (n.nodeType !== 1 && n.nodeType !== 3) continue; // skip <!-- /wp:... --> comments
        if (n.nodeType === 1 && n.tagName === 'BR') {
          lines.push({ text: cur, strong: curStrong });
          cur = ''; curStrong = ''; atStart = true;
          continue;
        }
        var t = n.textContent || '';
        if (atStart && n.nodeType === 1 && n.tagName === 'STRONG') curStrong = t.trim();
        if (t.trim()) atStart = false;
        cur += t;
      }
      lines.push({ text: cur, strong: curStrong });

      for (var l = 0; l < lines.length; l++) {
        var line = lines[l].text.replace(/\s+/g, ' ').trim();
        if (!line) continue;
        var strong = lines[l].strong;
        if (strong && strong.length < 40 && /(תיאור|דרישות)/.test(strong)) {
          if (/דרישות/.test(strong)) mode = 'req';
          else mode = 'desc';
          line = line.slice(line.indexOf(strong) + strong.length).replace(/^[\s:–-]+/, '').trim();
          if (!line) continue;
        }
        if (/^מייל לשליחת קורות חיים/.test(line)) continue; // apply line -> applicationInfo
        (mode === 'req' ? req : desc).push(line);
      }
    }
    var a = item.querySelector('a[href^="mailto:"]');
    if (a) mail = (a.getAttribute('href') || '').replace(/^mailto:/i, '').split('?')[0].trim();

    var add = function (cls, tag, val) {
      var el = document.createElement(tag);
      el.className = cls;
      el.style.display = 'none';
      if (Array.isArray(val)) {
        for (var v = 0; v < val.length; v++) {
          var pe = document.createElement('p');
          pe.textContent = val[v];
          el.appendChild(pe);
        }
      } else {
        el.textContent = val;
      }
      item.appendChild(el);
    };
    add('__ai-title', 'span', title);
    if (desc.length) add('__ai-description', 'div', desc);
    if (req.length) add('__ai-requirements', 'div', req);
    if (mail) add('__ai-apply', 'span', 'mailto:' + mail);
    // Site rule (owner 2026-10-07): a single-site company, so every job is at its address.
    add('__ai-location', 'span', 'קיבוץ חנתון');
  } catch (e) {
    // degrade per item (LRN-WRK-19)
  }
}
