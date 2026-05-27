(function () {
  try {
    // Listing-only: each .job-container has onclick="jobline.openJob('A5.467')"
    // but no <a href>. We inject (a) a span carrying the clean uid for the
    // externalJobId field, and (b) an <a> with an absolute href to the
    // detail page so pageFlow `action: navigate` (which follows the first
    // <a> inside the item) can drive the detail-page navigation.
    var BASE = 'https://jobs.keshet-mediagroup.com';
    var items = document.querySelectorAll('.job-container');
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.querySelector('[data-extracted-jobid]')) continue;
      var onclick = it.getAttribute('onclick') || '';
      var m = onclick.match(/openJob\(\s*['"]([^'"]+)['"]\s*\)/);
      if (!m || !m[1]) continue;
      var uid = m[1];

      var idSpan = document.createElement('span');
      idSpan.setAttribute('data-extracted-jobid', uid);
      idSpan.style.display = 'none';
      idSpan.textContent = uid;
      it.appendChild(idSpan);

      var link = document.createElement('a');
      link.setAttribute('data-extracted-detailurl', '1');
      link.setAttribute('href', BASE + '/jobs/' + uid);
      link.style.display = 'none';
      link.textContent = 'detail';
      it.appendChild(link);
    }
  } catch (e) {
    try {
      var b = document.body;
      var es = document.createElement('span');
      es.setAttribute('data-setup-err', String(e).slice(0, 200));
      es.style.display = 'none';
      b.appendChild(es);
    } catch (_) {}
  }
})();
