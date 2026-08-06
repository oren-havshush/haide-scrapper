document.querySelectorAll('.accordion-button[onclick]').forEach(function (btn) {
  var header = btn.closest('.accordion-header') || btn.parentElement;
  if (!header || header.querySelector('a.sii-job-link')) return;
  var oc = btn.getAttribute('onclick') || '';
  var m = oc.match(/href\s*=\s*['"]([^'"]+)['"]/);
  if (!m) return;
  var a = document.createElement('a');
  a.className = 'sii-job-link';
  a.setAttribute('href', m[1]);
  a.textContent = (btn.textContent || '').trim();
  header.appendChild(a);
});
