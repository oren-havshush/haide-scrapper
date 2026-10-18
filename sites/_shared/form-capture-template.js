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
    var honeypots = [];
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
      // The ancestors below the form: their classes and ids join the trap-word
      // hint, and one that hides the field makes it style-hidden (R8: CallBiz's
      // 1px clipped span.cf7apps-honeypot-wrap; worker/lib/formExtract.ts).
      var ancestorHint = '';
      var ancestorHidden = false;
      for (var a = el.parentElement; a && a !== form; a = a.parentElement) {
        ancestorHint += ' ' + (a.id || '') + ' ' + (typeof a.className === 'string' ? a.className : '');
        if (ancestorHidden) continue;
        var acs = window.getComputedStyle(a);
        var apv = a.parentElement ? window.getComputedStyle(a.parentElement).visibility : 'visible';
        var tiny = (/px$/.test(acs.width) && parseFloat(acs.width) <= 1) || (/px$/.test(acs.height) && parseFloat(acs.height) <= 1);
        var aclip = (acs.clip || '').replace(/\s+/g, '');
        var aclipPath = (acs.clipPath || '').replace(/\s+/g, '');
        ancestorHidden =
          acs.display === 'none' ||
          (acs.visibility === 'hidden' && apv !== 'hidden') ||
          (tiny && (acs.overflow || '').indexOf('hidden') !== -1) ||
          aclip === 'rect(0px,0px,0px,0px)' ||
          aclipPath === 'inset(50%)' ||
          aclipPath === 'inset(100%)';
      }
      var isHpName = /\b(hp[_-]|honeypot|maspik|nickname|malkodet)/i.test(name + ' ' + (el.id || '') + ' ' + (el.className || '') + ancestorHint);
      // A label beside the field, or its placeholder, asking that it be left
      // empty marks a trap (R8: "Please leave this field empty.").
      var nearLabel = '';
      if (el.parentElement) {
        var sibs = el.parentElement.children;
        for (var si = 0; si < sibs.length; si++) if (sibs[si] !== el && sibs[si].tagName === 'LABEL') nearLabel += ' ' + (sibs[si].textContent || '');
      }
      var askText = (nearLabel + ' ' + (el.getAttribute('placeholder') || '')).replace(/\s+/g, ' ');
      var asksEmpty =
        /leave (this|the) field (empty|blank)|do not fill|don't fill/i.test(askText) ||
        ['השאר שדה זה ריק', 'השאירו שדה זה ריק', 'יש להשאיר ריק', 'אין למלא', 'לא למלא', 'נא לא למלא'].some(function (h) { return askText.indexOf(h) !== -1; });
      // A text-like field hidden by its own style, or emptied by a script on
      // load, is a trap too (H4; worker/lib/formFields.ts TEXT_LIKE). One the
      // page gave a value carries the job: it is kept with the value, marked
      // prefilled, and the style rule does not judge it; emptied is a trap.
      var isTrap = false;
      var isTextLike = /^(text|email|tel|url|number|search|password|textarea)$/.test(type);
      var emptied = false;
      var prefilled = false;
      if (isTextLike) {
        var cs = window.getComputedStyle(el);
        var pv = el.parentElement ? window.getComputedStyle(el.parentElement).visibility : 'visible';
        emptied = (tag === 'textarea' ? (el.textContent || '').trim() !== '' : (el.getAttribute('value') || '').trim() !== '') && el.value === '';
        prefilled = !emptied && (el.value || '').trim() !== '';
        var styleHidden =
          cs.display === 'none' ||
          (cs.visibility === 'hidden' && pv !== 'hidden') ||
          cs.opacity === '0' ||
          (/px$/.test(cs.width) && parseFloat(cs.width) <= 1) ||
          (/px$/.test(cs.height) && parseFloat(cs.height) <= 1) ||
          ((cs.position === 'absolute' || cs.position === 'fixed') &&
            ((parseFloat(cs.left) || 0) <= -1000 || (parseFloat(cs.top) || 0) <= -1000)) ||
          (el.getAttribute('aria-hidden') === 'true' && el.getAttribute('tabindex') === '-1');
        isTrap = emptied || ((styleHidden || ancestorHidden) && !prefilled) || asksEmpty;
      }
      if ((isOffscreen || isHpName || isTrap) && type !== 'hidden') {
        // Left out of fields, and named in honeypots (R8).
        if (name && honeypots.indexOf(name) === -1) honeypots.push(name);
        continue;
      }
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
      if (prefilled) { rec.value = el.value; rec.prefilled = true; }
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
    schema.honeypots = honeypots;
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
