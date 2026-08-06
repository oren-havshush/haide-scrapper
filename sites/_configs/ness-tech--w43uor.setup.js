(function () {
  try {
    var DETAIL_PREFIX = 'https://www.ness-tech.co.il/careers/job/';
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/careers/api/Careers/GetAllItems', false);
    try { xhr.setRequestHeader('accept', 'application/json'); } catch (e) {}
    xhr.send();
    if (xhr.status !== 200) {
      var em = document.createElement('span');
      em.setAttribute('data-haide-setup-error', 'http_' + xhr.status);
      em.style.display = 'none';
      document.body.appendChild(em);
      return;
    }
    var data = JSON.parse(xhr.responseText);
    var list = (data && data.allOrderDetailsList) || [];
    var cards = document.querySelectorAll('.card-job-container');
    for (var i = 0; i < cards.length && i < list.length; i++) {
      var card = cards[i];
      if (card.querySelector('.haide-enrich')) continue;
      var d = list[i] || {};
      var domTitle = '';
      try {
        var liTitle = card.querySelectorAll('ul li')[1];
        if (liTitle) domTitle = (liTitle.textContent || '').replace(/\s+/g, ' ').trim();
      } catch (e) {}
      if (domTitle && d.title && domTitle.indexOf(d.title.replace(/\s+/g, ' ').trim()) === -1 &&
          d.title.replace(/\s+/g, ' ').trim().indexOf(domTitle) === -1) {
        var found = null;
        for (var k = 0; k < list.length; k++) {
          if (list[k] && list[k].title && (list[k].title.indexOf(domTitle) !== -1 || domTitle.indexOf(list[k].title) !== -1)) {
            found = list[k]; break;
          }
        }
        if (found) { d = found; } else { continue; }
      }
      var wrap = document.createElement('div');
      wrap.className = 'haide-enrich';
      wrap.style.display = 'none';
      function addSpan(cls, text) {
        var s = document.createElement('span');
        s.className = cls;
        s.textContent = text == null ? '' : String(text);
        wrap.appendChild(s);
      }
      function addLink(cls, href) {
        var a = document.createElement('a');
        a.className = cls;
        a.setAttribute('href', href);
        a.textContent = href;
        wrap.appendChild(a);
      }
      var descClean = (d.posDescription || '').replace(/<BR\s*\/?>/gi, '\n').replace(/&nbsp;/gi, ' ');
      addSpan('haide-title', d.title);
      addSpan('haide-location', d.posLocation);
      addSpan('haide-description', descClean);
      addSpan('haide-jobid', d.index);
      addSpan('haide-publish-date', d.lastUpdated);
      addSpan('haide-department', d.profName);
      addSpan('haide-subdept', d.subProfName);
      addSpan('haide-contact-name', d.rakazName);
      addSpan('haide-contact-email', d.rakazEmail);
      addSpan('haide-is-hot', d.isHot);
      if (d.index) addLink('haide-detail-url', DETAIL_PREFIX + d.index);
      card.appendChild(wrap);
    }
  } catch (e) {
    var em2 = document.createElement('span');
    em2.setAttribute('data-haide-setup-error', String(e).slice(0, 300));
    em2.style.display = 'none';
    document.body.appendChild(em2);
  }
})();
