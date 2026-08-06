try {
  function hh(s){var h=5381,i=s.length;while(i){h=(h*33)^s.charCodeAt(--i);}return (h>>>0).toString(36);}
  var RE = /מס(?:['\u05f3\u2019`]|פר)?\s*משרה[\s\S]{0,40}?(\d{2,6})/;
  document.querySelectorAll('div.position.position-wrapper').forEach(function (d) {
    if (d.querySelector('[data-ex-id]')) return;
    var hl = d.querySelector('.position-headline');
    var title = (hl ? hl.textContent : '').replace(/\s+/g, ' ').trim();
    var body = d.querySelector('.position-body');
    var bodyText = (body ? body.textContent : '') || '';
    var m = bodyText.match(RE);
    var jobNo = m ? m[1] : '';
    var area = (d.getAttribute('data-area') || '').trim();
    var cat = (d.getAttribute('data-catagory') || '').trim();
    function mk(attr, val) { var s = document.createElement('span'); s.setAttribute(attr, '1'); s.style.display = 'none'; s.textContent = val; d.appendChild(s); }
    mk('data-ex-id', jobNo ? jobNo : ('h-' + hh(title.toLowerCase())));
    var apply = 'הגשה במייל: jobs@tuboul.co.il';
    if (jobNo) apply += '\nיש לציין בנושא המייל את מספר המשרה: ' + jobNo;
    mk('data-apply', apply);
    if (area) mk('data-loc', area);
    if (cat) mk('data-dept', cat);
  });
} catch (e) {}
