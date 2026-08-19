(function () {
  function clean(s) { return (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim(); }
  // Block-aware: one line per paragraph/heading, "• " per list item. Never
  // collapse the whole body with \s+ — that is what produces blob descriptions.
  function structuredText(nodes) {
    var out = [];
    nodes.forEach(function (el) {
      if (el.tagName === 'UL' || el.tagName === 'OL') {
        Array.prototype.forEach.call(el.children, function (li) {
          var t = clean(li.textContent);
          if (t) out.push('• ' + t);
        });
      } else {
        var tmp = document.createElement('div');
        tmp.innerHTML = (el.innerHTML || '').replace(/<br\s*\/?>/gi, '\n');
        tmp.textContent.split('\n').forEach(function (line) {
          var t = clean(line);
          if (t) out.push(t);
        });
      }
    });
    return out.join('\n');
  }
  var REQ = /^\s*(דרישות|כישורים|תנאי\s*סף|הדרישות)/;
  // A short closing paragraph (scope / address / hours) is not a requirement.
  var FOOTER = /היקף\s*משרה|משרדינו|מיקום\s*:|קו\s*רכבת|שעות|ימים\s*[א-ה]/;
  document.querySelectorAll('.panel.panel-default').forEach(function (panel) {
    var col = panel.querySelector('.panel-body__col');
    if (!col || panel.querySelector('[data-desc]')) return;

    // ---- externalJobId: "מס' משרה: 4082" in the heading; href digits as fallback.
    if (!panel.querySelector('[data-ex-id]')) {
      var head = (panel.querySelector('.panel-heading') || panel).textContent || '';
      var m = head.replace(/\s+/g, ' ').match(/משרה\D{0,4}(\d{3,})/);
      var num = m ? m[1] : '';
      if (!num) {
        var tg = panel.querySelector('a.accordion-toggle');
        num = ((tg && tg.getAttribute('href')) || '').replace(/[^0-9]/g, '');
      }
      if (num) {
        var si = document.createElement('span');
        si.setAttribute('data-ex-id', '1');
        si.style.display = 'none';
        si.textContent = num;
        panel.appendChild(si);
      }
    }

    // ---- split the body at the "דרישות" heading: before -> description,
    // that section -> requirements, trailing closing note -> description.
    var kids = Array.prototype.slice.call(col.children);
    var idx = -1;
    for (var i = 0; i < kids.length; i++) {
      if (/^H[1-6]$/.test(kids[i].tagName) && REQ.test(kids[i].textContent || '')) { idx = i; break; }
    }
    var descNodes, reqNodes;
    if (idx === -1) {
      descNodes = kids; reqNodes = [];
    } else {
      descNodes = kids.slice(0, idx);
      reqNodes = [];
      var sawList = false;
      for (var j = idx + 1; j < kids.length; j++) {
        var k = kids[j];
        if (/^H[1-6]$/.test(k.tagName)) break;
        var t = clean(k.textContent);
        if (k.tagName === 'UL' || k.tagName === 'OL') { sawList = true; reqNodes.push(k); continue; }
        if (!t) continue;
        if (sawList && FOOTER.test(t)) { descNodes.push(k); continue; }
        reqNodes.push(k);
      }
    }

    var d = document.createElement('div');
    d.setAttribute('data-desc', '1'); d.style.display = 'none';
    d.textContent = structuredText(descNodes);
    panel.appendChild(d);

    if (reqNodes.length) {
      var r = document.createElement('div');
      r.setAttribute('data-req', '1'); r.style.display = 'none';
      r.textContent = structuredText(reqNodes);
      panel.appendChild(r);
    }
  });
})();
