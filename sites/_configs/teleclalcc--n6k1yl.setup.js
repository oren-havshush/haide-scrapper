(function () {
  function extractFormSchema(form) {
    var action = form.getAttribute('action') || '';
    var method = (form.getAttribute('method') || 'GET').toUpperCase();
    var fields = [];
    var els = form.querySelectorAll('input, select, textarea');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var tag = el.tagName.toLowerCase();
      var type = tag === 'input' ? ((el.getAttribute('type') || 'text').toLowerCase()) : tag;
      if (type === 'submit' || type === 'button' || type === 'image' || type === 'reset') continue;
      var name = el.getAttribute('name') || '';
      var style = (el.getAttribute('style') || '').toLowerCase();
      var isOffscreen = style.indexOf('-99999') !== -1 || style.indexOf('display:none !important') !== -1 || style.indexOf('display: none !important') !== -1;
      var isHpName = /\b(hp[_-]|honeypot|maspik|nickname)/i.test(name + ' ' + (el.id || '') + ' ' + (el.className || ''));
      if ((isOffscreen || isHpName) && type !== 'hidden') continue;
      var label = '';
      if (el.id) {
        var lab = form.querySelector('label[for="' + el.id.replace(/"/g, '\\"') + '"]');
        if (lab) label = (lab.textContent || '').replace(/\s+/g, ' ').trim();
      }
      if (!label) {
        var parentLabel = el.closest('label');
        if (parentLabel) label = (parentLabel.textContent || '').replace(/\s+/g, ' ').trim();
      }
      if (!label) label = el.getAttribute('placeholder') || el.getAttribute('aria-label') || '';
      var required = el.hasAttribute('required') || el.getAttribute('aria-required') === 'true';
      var rec = { name: name, fieldType: type, label: label, required: required, tagName: tag };
      if (type === 'hidden') rec.value = el.getAttribute('value') || '';
      if (type === 'file') {
        var accept = el.getAttribute('accept');
        if (accept) rec.accept = accept;
      }
      if (tag === 'select') {
        var opts = el.querySelectorAll('option');
        var options = [];
        for (var k = 0; k < opts.length; k++) {
          options.push({ value: opts[k].value, label: (opts[k].textContent || '').replace(/\s+/g, ' ').trim() });
        }
        rec.options = options;
      }
      fields.push(rec);
    }
    return { actionUrl: action, method: method, fields: fields };
  }
  function pickForm(scope) {
    var forms = scope.querySelectorAll('form');
    var best = null, bestScore = -1;
    for (var i = 0; i < forms.length; i++) {
      var f = forms[i];
      var name = (f.getAttribute('name') || '').toLowerCase();
      var role = (f.getAttribute('role') || '').toLowerCase();
      if (role === 'search' || /search/.test(name)) continue;
      var inputs = f.querySelectorAll('input:not([type="hidden"]), select, textarea');
      var visibleCount = 0;
      for (var j = 0; j < inputs.length; j++) {
        var t = (inputs[j].getAttribute('type') || '').toLowerCase();
        if (t === 'submit' || t === 'button' || t === 'image' || t === 'reset') continue;
        visibleCount++;
      }
      if (visibleCount > bestScore) { bestScore = visibleCount; best = f; }
    }
    return bestScore >= 1 ? best : null;
  }
  try {
    document.querySelectorAll('article.elementor-post.jobs').forEach(function (art) {
      if (!art.querySelector('[data-extracted-jobid]')) {
        var m = (art.className || '').match(/\bpost-(\d+)\b/);
        if (m) {
          var span = document.createElement('span');
          span.setAttribute('data-extracted-jobid', '1');
          span.style.display = 'none';
          span.textContent = m[1];
          art.appendChild(span);
        }
      }
      if (!art.querySelector('[data-extracted-form]')) {
        var f = pickForm(art);
        if (f) {
          var schema = extractFormSchema(f);
          var fs = document.createElement('span');
          fs.setAttribute('data-extracted-form', '1');
          fs.style.display = 'none';
          fs.textContent = JSON.stringify(schema);
          art.appendChild(fs);
        }
      }
    });
  } catch (e) {}
})();
