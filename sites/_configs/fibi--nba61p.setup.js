document.querySelectorAll('section[id^="section"]').forEach(function (sec) {
  if (!sec.querySelector('a[href^="mailto"]')) return;
  if (sec.querySelector('.fibi-desc')) return;
  var clone = sec.cloneNode(true);
  var h2 = clone.querySelector('h2');
  if (h2) h2.remove();
  var existing = clone.querySelector('.fibi-desc');
  if (existing) existing.remove();
  var d = document.createElement('div');
  d.className = 'fibi-desc';
  d.setAttribute('data-jobid', sec.getAttribute('id') || '');
  d.textContent = (clone.textContent || '').replace(/\s+/g, ' ').trim();
  sec.appendChild(d);
});
