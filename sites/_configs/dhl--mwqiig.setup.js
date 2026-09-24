(function () {
  try {
    var ITEM = 'div.cmp-accordion__item';
    var items = document.querySelectorAll(ITEM);
    if (!items.length) return;
    var NBSP = String.fromCharCode(160);

    function haideHash(s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); }
    function clean(s) { return (s || '').split(NBSP).join(' ').replace(/[ \t]{2,}/g, ' ').trim(); }
    function add(item, cls, val) {
      if (!val || item.querySelector('.' + cls)) return;
      var sp = document.createElement('span');
      sp.className = cls;
      sp.style.display = 'none';
      sp.textContent = val;
      item.appendChild(sp);
    }

    // Department: nearest preceding h3 in document order (שירות / מכירות / תפעול).
    var deptOf = {};
    var walk = document.querySelectorAll('h3, ' + ITEM);
    var cur = '';
    for (var w = 0; w < walk.length; w++) {
      var el = walk[w];
      if (el.tagName === 'H3') { cur = clean(el.textContent); }
      else { deptOf[w] = cur; el.setAttribute('data-haide-dept', cur); }
    }

    // Labels that name the field itself — dropped (owner rule 2).
    var FIELD_LABEL = /^(במסגרת\s+התפקיד|תיאור\s+התפקיד|דרישות\s+התפקיד|דרישות)\s*:?\s*$/;
    var REQ_HEAD = /דרישות\s+התפקיד/;
    var LOC_LINE = /מיקום\s+המשרה\s*:?\s*(.+)$/;
    var APPLY_START = /קורות\s+חיים\s+שולחים\s+למייל/;

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (item.querySelector('.__ai-title')) continue;

      var titleEl = item.querySelector('span.cmp-accordion__title');
      var title = clean(titleEl ? titleEl.textContent : '');
      if (!title) continue;

      var panel = item.querySelector('div.cmp-accordion__panel');
      var ps = panel ? panel.querySelectorAll('p') : [];

      var descLines = [], reqLines = [], applyLines = [], location = '';
      var inReq = false, inApply = false;

      for (var k = 0; k < ps.length; k++) {
        var raw = clean(ps[k].textContent);
        if (!raw) continue;

        if (APPLY_START.test(raw)) { inApply = true; }
        if (inApply) { applyLines.push(raw); continue; }

        if (REQ_HEAD.test(raw)) { inReq = true; continue; }   // heading itself dropped

        var lm = raw.match(LOC_LINE);
        if (lm) {
          // Multi-city rows read "X / Y". Emit a COMMA: normalizer.ts rewrites
          // "/" to a space BEFORE normalizeLocations() splits, which would fuse
          // two cities into one off-vocabulary string and fail the city gate.
          // A comma survives both stages and splits into canonical parts.
          location = clean(lm[1].replace(/^[^֐-׿a-zA-Z0-9]+/, '')).replace(/\s*\/\s*/g, ', ');
          continue;
        }

        if (FIELD_LABEL.test(raw)) continue;                  // field-naming label dropped

        if (inReq) reqLines.push(raw); else descLines.push(raw);
      }

      var dept = item.getAttribute('data-haide-dept') || '';

      add(item, '__ai-title', title);
      add(item, '__ai-description', descLines.join('\n'));
      add(item, '__ai-requirements', reqLines.join('\n'));
      add(item, '__ai-location', location);
      add(item, '__ai-department', dept);
      add(item, '__ai-apply', applyLines.join(' '));
      add(item, '__ai-eid', 'h-' + haideHash((title + '|' + dept).toLowerCase().replace(/\s+/g, ' ').trim()));
    }
  } catch (e) {
    /* never throw inside the worker's setupScript */
  }
})();
