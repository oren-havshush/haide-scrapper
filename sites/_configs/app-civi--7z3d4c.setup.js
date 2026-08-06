(function(){
  try {
    document.querySelectorAll('.thumb').forEach(function(el){
      var tc = el.querySelector('.thumb-content') || el.querySelector('.action-button');
      var onclick = tc ? (tc.getAttribute('onclick') || '') : '';
      var m = onclick.match(/openPromo\(event,\s*(\d+)\s*,\s*(\d+)/);
      var jobId = m && m[1] ? m[1] : '';
      var srcId = m && m[2] ? m[2] : '';
      if (jobId && !el.querySelector('[data-extracted-jobid]')) {
        var s = document.createElement('span');
        s.setAttribute('data-extracted-jobid','1');
        s.style.display='none';
        s.textContent = jobId;
        el.appendChild(s);
      }
      if (jobId && srcId && !el.querySelector('[data-extracted-detailurl]')) {
        var d = document.createElement('span');
        d.setAttribute('data-extracted-detailurl','1');
        d.style.display='none';
        d.textContent = 'https://app.civi.co.il/promo/id=' + jobId + '&src=' + srcId;
        el.appendChild(d);
      }
      if (!el.querySelector('[data-extracted-location]')) {
        var l = document.createElement('span');
        l.setAttribute('data-extracted-location','1');
        l.style.display='none';
        l.textContent = '\u05e8\u05de\u05ea \u05d2\u05df';
        el.appendChild(l);
      }
    });
  } catch(e){}
})();
