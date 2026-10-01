;(function () {
  // Apply-form capture, pasted into a site's setupScript with __ITEMSEL__ set
  // to its item selector. Same rules as the worker's live extractor
  // (worker/lib/formFields.ts), checked on one page by worker/lib/formExtract.test.ts:
  //   every hidden input kept with its value (the honeypot filter never drops a
  //   hidden input); a radio group is ONE field with options; a file input keeps
  //   accept and multiple; the form keeps its enctype; the blob carries
  //   actionAttribute (resolved absolute, '' when the form has none) and pageUrl,
  //   and is stamped with capturedAt, captureSource "script" (a setup script
  //   injected it) and extractorVersion 3. The worker adds submitMechanism and
  //   shapeHash when it takes the blob (worker/lib/formShape.ts).
  var EXTRACTOR_VERSION = 3;
  function extractFormSchema(form) {
    var pageUrl = window.location.href;
    var actionRaw = (form.getAttribute('action') || '').trim();
    var actionAttribute = actionRaw;
    try { if (actionRaw) actionAttribute = new URL(actionRaw, pageUrl).toString(); } catch (e) {}
    var action = form.getAttribute('action') || '';
    var method = (form.getAttribute('method') || 'GET').toUpperCase();
    var enctype = form.getAttribute('enctype');
    var fields = [];
    var radios = {};
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
        var safeId = el.id.replace(/"/g, '\\"');
        var lab = form.querySelector('label[for="' + safeId + '"]');
        if (lab) label = (lab.textContent || '').replace(/\s+/g, ' ').trim();
      }
      if (!label) {
        var parentLabel = el.closest('label');
        if (parentLabel) label = (parentLabel.textContent || '').replace(/\s+/g, ' ').trim();
      }
      var required = el.hasAttribute('required') || el.getAttribute('aria-required') === 'true';
      if (type === 'radio') {
        var option = { value: el.value, label: label };
        if (name && radios[name]) {
          radios[name].options.push(option);
          radios[name].required = radios[name].required || required;
          continue;
        }
        var fs = el.closest('fieldset');
        var legend = fs ? fs.querySelector('legend') : null;
        var groupLabel = legend ? (legend.textContent || '').replace(/\s+/g, ' ').trim() : '';
        var group = { name: name, fieldType: 'radio', label: groupLabel || name, required: required, tagName: tag, options: [option] };
        if (name) radios[name] = group;
        fields.push(group);
        continue;
      }
      if (!label) label = el.getAttribute('placeholder') || el.getAttribute('aria-label') || '';
      var rec = { name: name, fieldType: type, label: label, required: required, tagName: tag };
      // The value as the page holds it now: a script may have set it.
      if (type === 'hidden') rec.value = el.value || '';
      if (type === 'file') {
        var accept = el.getAttribute('accept');
        if (accept) rec.accept = accept;
        if (el.multiple) rec.multiple = true;
      }
      if (tag === 'select') {
        var opts = el.querySelectorAll('option'); var options = [];
        for (var k = 0; k < opts.length; k++) {
          options.push({ value: opts[k].value, label: (opts[k].textContent || '').replace(/\s+/g, ' ').trim() });
        }
        rec.options = options;
      }
      fields.push(rec);
    }
    var schema = { actionUrl: action, actionAttribute: actionAttribute, pageUrl: pageUrl, method: method };
    if (enctype) schema.enctype = enctype;
    schema.fields = fields;
    schema.capturedAt = new Date().toISOString();
    schema.captureSource = 'script';
    schema.extractorVersion = EXTRACTOR_VERSION;
    return schema;
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
    document.querySelectorAll('__ITEMSEL__').forEach(function (item) {
      if (item.querySelector('[data-extracted-form]')) return;
      var f = pickForm(item);
      if (!f) return;
      var schema = extractFormSchema(f);
      var s = document.createElement('span');
      s.setAttribute('data-extracted-form', '1');
      s.style.display = 'none';
      s.textContent = JSON.stringify(schema);
      item.appendChild(s);
    });
  } catch (e) {}
})();
