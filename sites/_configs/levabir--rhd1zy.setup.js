/* levabir.co.il/דרושים — one WordPress page, each posting a Pojo "image-text" widget:
   h2 title (a mailto link), then the same paragraph on every posting (company intro,
   "החברה מגייסת עובדים", "קורות חיים לכתובת הבאה:", the address). No detail pages;
   "הקודם/הבא" under the page are page navigation, not jobs.
   Title is injected as plain text so the mailto link is never read as a job URL.
   Id: no printed number, no id attribute, no detail URL, so no id is emitted and the
   worker builds an h- id from title and department.
   Apply: email; applicationInfo = mailto:<the posting's own mailto address>. The page
   says only where to send the CV, nothing about naming the job.
   Description: the posting's paragraph without its apply lines (the "קורות חיים..."
   line and the address). No requirements section.
   Location: site rule (owner 2026-10-12, LRN-LOC-20 single-address rule): the company
   prints one address (הלהב 6, איזור תעשיה חולון), so a posting whose title and text name
   no place and no field work gets חולון; a field-work cue (במבנה ציבורי, באתרי החברה,
   בשטח, אצל לקוחות...) or another-place cue leaves it Unknown. The shared intro's
   "בפרויקטים" is not a cue (it is on every posting). Keyed on text, never on the id. */
var EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;
var APPLY = /^קורות חיים/;
var HQ = 'חולון'; /* verbatim, CSV files/city.csv */
var FIELD = /עבודת שטח|בשטח|אצל (ה)?לקוח|באתרי |באתר (ה)?(לקוח|בנייה|בניה|עבודה)|במבנ(ה|י) |ברחבי הארץ|פריסה ארצית|נסיעות|ניידות|רכב צמוד/;
var OTHER = /ממוקמ|מיקום|באזור|באיזור|עבודה מהבית|עבודה היברידית|מודל היברידי|סניף/;
function add(item, cls, text) {
  var s = document.createElement('span');
  s.className = cls;
  s.style.display = 'none';
  s.textContent = text;
  item.appendChild(s);
}
document.querySelectorAll('#main .entry-content .pojo-image-text').forEach(function (item) {
  if (item.querySelector('.__ai-title')) return;
  var h = item.querySelector('.image-text-title');
  var body = item.querySelector('.image-text-description');
  if (!h) return;
  var title = h.textContent.replace(/\s+/g, ' ').trim();
  if (!title) return;
  var c = body ? body.cloneNode(true) : document.createElement('p');
  c.querySelectorAll('br').forEach(function (e) { e.replaceWith('\n'); });
  var ls = c.textContent.split('\n').map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
  var desc = ls.filter(function (l) { return !APPLY.test(l) && !EMAIL.test(l); });
  var a = item.querySelector('a[href^="mailto:"]'), addr = '';
  if (a) addr = a.getAttribute('href').replace(/^mailto:/i, '').split('?')[0].trim();
  if (!addr) ls.forEach(function (l) { var m = EMAIL.exec(l); if (m && !addr) addr = m[0]; });
  add(item, '__ai-title', title);
  add(item, '__ai-description', desc.join('\n'));
  var all = title + '\n' + desc.join('\n');
  add(item, '__ai-location', FIELD.test(all) || OTHER.test(all) ? 'Unknown' : HQ);
  if (addr) add(item, '__ai-apply', 'mailto:' + addr.toLowerCase());
});
