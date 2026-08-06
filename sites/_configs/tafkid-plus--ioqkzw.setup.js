
try {
  document.querySelectorAll('.wrap_order_item').forEach(function (it) {
    if (it.querySelector('[data-haide-loc]')) return;
    var spans = it.querySelectorAll('ul.order-icon-list-items li span.text_icon');
    var loc = '', dept = '', pub = '';
    spans.forEach(function (s) {
      var t = (s.textContent || '').replace(/\s+/g, ' ').trim();
      if (t.indexOf('מיקום:') === 0) loc = t.replace('מיקום:', '').trim();
      else if (t.indexOf('תחום:') === 0) dept = t.replace('תחום:', '').trim();
      else if (t.indexOf('תאריך פרסום:') === 0) pub = t.replace('תאריך פרסום:', '').trim();
    });
    function inject(attr, val) {
      if (!val) return;
      var sp = document.createElement('span');
      sp.setAttribute(attr, '1');
      sp.style.display = 'none';
      sp.textContent = val;
      it.appendChild(sp);
    }
    inject('data-haide-loc', loc);
    inject('data-haide-dept', dept);
    inject('data-haide-date', pub);
  });
} catch (e) {}
