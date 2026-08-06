// Runs on BOTH the listing page and each detail page (worker fix 2026-06-03).
// Listing context: tag each job row with the job number sliced from its title.
document.querySelectorAll('li.jobItemRow').forEach(function (it) {
  try {
    if (it.querySelector('[data-extracted-jobid]')) return;
    var t = it.querySelector('.job_title');
    var m = ((t ? t.textContent : '') || '').match(/(\d{3,})/);
    if (m) {
      var s = document.createElement('span');
      s.setAttribute('data-extracted-jobid', '1');
      s.style.display = 'none';
      s.textContent = m[1];
      it.appendChild(s);
    }
    // Hardcoded per-site location: every Mei Avivim role is Tel Aviv.
    if (!it.querySelector('[data-extracted-location]')) {
      var loc = document.createElement('span');
      loc.setAttribute('data-extracted-location', '1');
      loc.style.display = 'none';
      loc.textContent = 'תל אביב';
      it.appendChild(loc);
    }
  } catch (e) {}
});
// Detail context: tag the page with the apply email parsed from the mailto: button.
(function () {
  try {
    if (document.querySelector('[data-extracted-email]')) return;
    var btn = document.querySelector('a.sendResumeBtn');
    if (!btn) return;
    var h = btn.getAttribute('href') || '';
    var em = h.match(/mailto:([^?\s]+)/);
    if (em) {
      var s = document.createElement('span');
      s.setAttribute('data-extracted-email', '1');
      s.style.display = 'none';
      s.textContent = em[1].trim();
      (document.querySelector('.jobPageContent') || document.body).appendChild(s);
    }
  } catch (e) {}
})();
