try {
  if (!document.querySelector('article.elementor-post')) {
    if (!document.querySelector('[data-haide-desc]')) {
      var parts = [];
      document.querySelectorAll('.elementor-widget-text-editor').forEach(function (el) {
        var t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!t) return;
        if (/כל הזכויות שמורות|הצהרת נגישות|מדיניות פרטיות/.test(t)) return;
        if (/^המשרה מיועדת לנשים ולגברים כאחד\.?$/.test(t)) return;
        parts.push(t);
      });
      if (parts.length) {
        var span = document.createElement('span');
        span.setAttribute('data-haide-desc', '1');
        span.style.display = 'none';
        span.textContent = parts.join('\n\n');
        document.body.appendChild(span);
      }
    }
  }
} catch (e) {}
;try {
  if (!document.querySelector('article.elementor-post') && !document.querySelector('[data-haide-loc]')) {
    var _d = document.querySelector('[data-haide-desc]');
    var _t = _d ? (_d.textContent || '') : (document.body.textContent || '');
    if (!/מיקום|כתובת|סניף|פארק|ממוק|משרדינו/.test(_t)) {
      var _ls = document.createElement('span');
      _ls.setAttribute('data-haide-loc', '1');
      _ls.style.display = 'none';
      _ls.textContent = 'אבן יהודה';
      document.body.appendChild(_ls);
    }
  }
} catch (e) {}
