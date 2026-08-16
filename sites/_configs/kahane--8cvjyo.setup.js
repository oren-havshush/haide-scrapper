try {
  if (!document.querySelector('article.elementor-post')) {
    if (!document.querySelector('[data-haide-desc]')) {
      var parts = [];
      document.querySelectorAll('.elementor-widget-text-editor').forEach(function (el) {
        var probe = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!probe) return;
        if (/כל הזכויות שמורות|הצהרת נגישות|מדיניות פרטיות/.test(probe)) return;
        if (/^המשרה מיועדת לנשים ולגברים כאחד\.?$/.test(probe)) return;
        var c = el.cloneNode(true);
        c.querySelectorAll('style, script, noscript, svg, iframe').forEach(function (n) { n.remove(); });
        c.querySelectorAll('br').forEach(function (n) { n.replaceWith('\n'); });
        c.querySelectorAll('li').forEach(function (li) {
          var lt = (li.textContent || '').replace(/^\s+/, '');
          if (lt && !/^[•–\-]/.test(lt)) { li.prepend('• '); }
        });
        c.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, h5, h6').forEach(function (b) { b.append('\n'); });
        var t = (c.textContent || '')
          .replace(/[^\S\n]+/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
          .replace(/ \n/g, '\n')
          .replace(/\n /g, '\n')
          .trim();
        if (t) parts.push(t);
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
