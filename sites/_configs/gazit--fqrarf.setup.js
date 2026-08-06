(function () {
  try {
    document.querySelectorAll('.elementor-accordion-item').forEach(function (item) {
      if (item.querySelector('[data-extracted-description]')) return;
      var content = item.querySelector('.elementor-tab-content');
      if (!content) return;
      var clone = content.cloneNode(true);
      clone.querySelectorAll('[data-elementor-type="page"], form, .elementor-form, .elementor-section').forEach(function (el) { el.remove(); });
      var div = document.createElement('div');
      div.setAttribute('data-extracted-description', '1');
      div.style.display = 'none';
      div.textContent = (clone.textContent || '').replace(/[\s\u00A0]+/g, ' ').trim();
      item.appendChild(div);
    });
  } catch (e) {}
})();
