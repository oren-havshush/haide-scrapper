// kashtan.co.il/קריירה: jobs inline as .vacancies__collapse accordions, listing-only, no job pages.
// - id: none emitted (owner 2026-10-12: data-jobid has been reused for other jobs); the worker keys on the title.
// - description / requirements: routed by the ad's own headings, labels dropped, native nodes kept;
//   the "הגשת מועמדות" button never enters either field.
// - location: a field-service line naming the whole country -> פריסה ארצית; else the owner-checked
//   titles in ONE_ADDR (ad names no place, no field work; the company prints one address, עודד 2
//   באר יעקב: LRN-LOC-20) -> באר יעקב; else Unknown. Keyed on the exact title, as the id is.
// - apply: ONE CF7 form (#applyNowModal) serves every job; on open the page's script writes the
//   job's title and data-jobid into hidden job-position / job-id. A site-level copy names no job,
//   so each card carries its own copy of the form with those two values filled (LRN-FORM-13).
var ITEM_SEL = '.vacancies__collapse';
var REQ_H = /^(דרישות|כישורים|דרישות\s+ה?תפקיד)/;
var DESC_H = /^(תיאור|התפקיד כולל|מה כולל)/;
var NATION = /(בשטח|נסיעות)[^\n]*ברחבי\s+הארץ/;
var ONE_ADDR = { 'מנהל/ת מכירות ופרויקטים': 'באר יעקב' };
var norm = function (s) { return (s || '').replace(/\s+/g, ' ').trim(); };
var fm = document.querySelector('#applyNowModal form.wpcf7-form') || document.querySelector('form.wpcf7-form:has(input[name="job-id"])');
var items = document.querySelectorAll(ITEM_SEL);
for (var i = 0; i < items.length; i++) {
  var item = items[i];
  try {
    if (item.querySelector('.__ai-description')) continue;
    var head = item.querySelector('.job_title');
    var title = head ? norm(head.textContent) : '';
    var jid = head ? norm(head.getAttribute('data-jobid')) : '';
    var body = item.querySelector('.vacancies__collapse-body > div') || item.querySelector('.vacancies__collapse-body');
    var desc = document.createElement('div'), req = document.createElement('div'), mode = 'desc', all = [];
    desc.className = '__ai-description'; desc.style.display = 'none';
    req.className = '__ai-requirements'; req.style.display = 'none';
    var kids = body ? body.children : [];
    for (var k = 0; k < kids.length; k++) {
      var el = kids[k];
      if (el.tagName === 'A' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
      var t = norm(el.textContent);
      if (!t) continue;
      all.push(t);
      if (t.length < 40 && REQ_H.test(t)) { mode = 'req'; continue; }
      if (t.length < 40 && DESC_H.test(t)) { mode = 'desc'; continue; }
      var c = el.cloneNode(true);
      c.querySelectorAll('a[href="#applyNowModal"]').forEach(function (a) { a.remove(); });
      // source line breaks are not rendered; without this every <li> ships a blank line (LRN-SETUP-9)
      var w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT), n;
      while ((n = w.nextNode())) n.nodeValue = n.nodeValue.replace(/[ \t]*[\r\n]+[ \t]*/g, ' ');
      (mode === 'req' ? req : desc).appendChild(c);
    }
    item.appendChild(desc);
    if (req.children.length) item.appendChild(req);
    var add = function (cls, val) { var d = document.createElement('div'); d.className = cls; d.style.display = 'none'; d.textContent = val; item.appendChild(d); };
    add('__ai-location', NATION.test(all.join('\n')) ? 'פריסה ארצית' : (ONE_ADDR[title] || 'Unknown'));
    if (fm) {
      var fields = [];
      var els = fm.querySelectorAll('input, select, textarea');
      for (var e = 0; e < els.length; e++) {
        var f = els[e];
        var ft = (f.tagName === 'INPUT' ? (f.getAttribute('type') || 'text') : f.tagName === 'SELECT' ? 'select' : 'textarea').toLowerCase();
        if (ft === 'submit' || ft === 'button' || ft === 'reset' || ft === 'image' || !f.name) continue;
        var lab = f.id ? fm.querySelector('label[for="' + f.id + '"]') : null;
        var fo = { name: f.name, label: lab ? norm(lab.textContent) : f.name, fieldType: ft, tagName: f.tagName,
          required: f.hasAttribute('required') || f.getAttribute('aria-required') === 'true' };
        if (ft === 'hidden') fo.value = f.name === 'job-position' ? title : f.name === 'job-id' ? jid : (f.getAttribute('value') || '');
        if (ft === 'file' && f.getAttribute('accept')) fo.accept = f.getAttribute('accept');
        fields.push(fo);
      }
      var act = new URL(fm.getAttribute('action') || location.href, location.href).href;
      var blob = JSON.stringify({ actionUrl: act, actionAttribute: act, formClass: fm.getAttribute('class') || '', formTag: 'form',
        method: (fm.getAttribute('method') || 'post').toUpperCase(), enctype: fm.getAttribute('enctype') || undefined, fields: fields });
      add('__ai-applicationInfo', blob);
      add('__ai-formData', blob);
    }
  } catch (err) { }
}
