(function () {
  try {
    document.querySelectorAll('.elementor-widget-accordion').forEach(function (acc) {
      var wrap = acc.closest('.elementor-widget-wrap');
      var loc = '';
      if (wrap) {
        var h = wrap.querySelector('.elementor-widget-heading h3');
        if (h) loc = (h.textContent || '').trim();
      }
      loc = loc.replace(/^\s*דרושים\s*/, '').trim();
      acc.querySelectorAll('.elementor-accordion-item').forEach(function (item) {
        if (!item.querySelector('[data-haide-location]')) {
          var s = document.createElement('span');
          s.setAttribute('data-haide-location', '1');
          s.style.display = 'none';
          s.textContent = loc;
          item.appendChild(s);
        }
        if (!item.querySelector('[data-haide-jobid]')) {
          var titleEl = item.querySelector('.elementor-accordion-title');
          var title = titleEl ? (titleEl.textContent || '').trim() : '';
          var idspan = document.createElement('span');
          idspan.setAttribute('data-haide-jobid', '1');
          idspan.style.display = 'none';
          idspan.textContent = (loc + ' | ' + title).trim();
          item.appendChild(idspan);
        }
      });
    });
  } catch (e) {}
})();
