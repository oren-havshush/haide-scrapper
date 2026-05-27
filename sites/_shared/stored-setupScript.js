(function () {
  try {
    if (document.querySelector('[data-extracted-location]')) return;
    var paras = document.querySelectorAll('.elementor-widget-text-editor p');
    for (var i = 0; i < paras.length; i++) {
      var p = paras[i];
      var strong = p.querySelector('strong');
      if (!strong) continue;
      if (/\u05de\u05d9\u05e7\u05d5\u05dd\s+\u05d2\u05d0\u05d5\u05d2\u05e8\u05e4\u05d9/.test(strong.textContent || '')) {
        var clone = p.cloneNode(true);
        var s = clone.querySelector('strong');
        if (s) s.remove();
        var val = (clone.textContent || '').replace(/[:\s\u00A0]+/g, ' ').trim();
        if (val) {
          var span = document.createElement('span');
          span.setAttribute('data-extracted-location', '1');
          span.style.display = 'none';
          span.textContent = val;
          document.body.appendChild(span);
        }
        break;
      }
    }
  } catch (e) {}
})();
