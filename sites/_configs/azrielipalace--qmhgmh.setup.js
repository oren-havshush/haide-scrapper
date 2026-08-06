(function () {
  try {
    var accordions = document.querySelectorAll('.elementor-widget-n-accordion');
    accordions.forEach(function (acc) {
      var sib = acc.previousElementSibling;
      var hWidget = null;
      while (sib) {
        if (sib.classList && sib.classList.contains('elementor-widget-heading')) { hWidget = sib; break; }
        sib = sib.previousElementSibling;
      }
      if (!hWidget) return;
      var h = hWidget.querySelector('h1, h2, h3, h4, h5, h6');
      if (!h) return;
      var text = (h.textContent || '').trim();
      var parts = text.split(/\s+/);
      var loc = parts.length > 1 ? parts.slice(1).join(' ') : text;
      var items = acc.querySelectorAll('details.e-n-accordion-item');
      items.forEach(function (it) {
        if (it.querySelector('[data-extracted-location]')) return;
        var span = document.createElement('span');
        span.setAttribute('data-extracted-location', '1');
        span.style.display = 'none';
        span.textContent = loc;
        it.appendChild(span);
      });
    });
  } catch (e) {}
})();
