// callbiz.co.il /קריירה/ — listing-only, 3 jobs in an accordion (#flex-section-3.jobs_acc).
// The page renders each job as two SIBLINGS: div.accordion (title in .question) and div.panel
// (body in .answer .content, apply line in .answer .bot-ico). This script wraps each pair in one
// div.haide-job so every field reads relative to one item. The prose stays on its native nodes
// (LRN-SETUP-11); the script injects only one scalar: location.
// externalJobId: none emitted on purpose (no printed number, no per-job URL) -> the worker
// synthesises an h- id from title, department and url (addsite3 section 6.2).
// The FAQ accordion on the same page has no .jobs_acc class and is never wrapped.
var root = document.querySelector('.jobs_acc');
if (root && !root.querySelector('.haide-job')) {
  var heads = Array.prototype.slice.call(root.querySelectorAll('.accordion'));
  for (var i = 0; i < heads.length; i++) {
    try {
      var head = heads[i];
      var panel = head.nextElementSibling;
      if (!panel || !panel.classList.contains('panel')) continue;
      var wrap = document.createElement('div');
      wrap.className = 'haide-job';
      head.parentNode.insertBefore(wrap, head);
      wrap.appendChild(head);
      wrap.appendChild(panel);
      // the page's own script collapses the panel with max-height; un-collapse so text is readable
      panel.style.maxHeight = 'none';
      panel.style.overflow = 'visible';

      // Apply: the site-level CF7 form is the apply path (owner 2026-10-07); the ad's own email
      // line (.answer .bot-ico) stays in the description as written, so description reads .answer.

      // location: every ad says "לעבודה מהבית"; no ad names a work place -> Unknown (LRN-LOC-14)
      if (!wrap.querySelector('.__ai-location')) {
        var l = document.createElement('span');
        l.className = '__ai-location';
        l.style.display = 'none';
        l.textContent = 'Unknown';
        wrap.appendChild(l);
      }
    } catch (e) { /* degrade per item (LRN-WRK-19) */ }
  }
}
