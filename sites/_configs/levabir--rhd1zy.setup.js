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
   line and the address). No requirements section. Location: no posting says where the
   work is, so Unknown (the gazetteer never scans; the Holon office address in the
   footer is not a job location). */
var EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;
var APPLY = /^קורות חיים/;
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
  add(item, '__ai-location', 'Unknown');
  if (addr) add(item, '__ai-apply', 'mailto:' + addr.toLowerCase());
});
