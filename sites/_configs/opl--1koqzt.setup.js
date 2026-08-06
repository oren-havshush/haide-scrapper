;(function () {
  function fnv1a(str) {
    var h = 0x811c9dc5 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(36);
  }
  try {
    document.querySelectorAll('nav.accordion ul > li').forEach(function (li) {
      if (li.querySelector('[data-extracted-jobid]')) return;
      var ifr = li.querySelector('iframe.sendfile');
      if (!ifr) return;
      var src = ifr.getAttribute('src') || '';
      var m = src.match(/[?&]message=([^&]*)/);
      var msg = m ? m[1] : src;
      var span = document.createElement('span');
      span.setAttribute('data-extracted-jobid', '1');
      span.style.display = 'none';
      span.textContent = 'opl-' + fnv1a(msg);
      li.appendChild(span);
    });
  } catch (e) {}
})();
