(function(){try{
  if (document.querySelector('#haide-jobs-root')) return;
  var container = document.querySelector('.page-content');
  if (!container) return;
  var root = document.createElement('div');
  root.id = 'haide-jobs-root';
  root.style.display = 'none';
  var children = Array.prototype.slice.call(container.children);
  var current = null;
  for (var i = 0; i < children.length; i++) {
    var el = children[i];
    var tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'h3') {
      current = document.createElement('div');
      var slug = (el.textContent || '').trim().slice(0, 100);
      current.setAttribute('data-haide-job', slug || ('job-' + i));
      current.appendChild(el.cloneNode(true));
      var idSpan = document.createElement('span');
      idSpan.setAttribute('data-haide-job-id', '1');
      idSpan.style.display = 'none';
      idSpan.textContent = slug || ('job-' + i);
      current.appendChild(idSpan);
      root.appendChild(current);
    } else if (tag === 'hr' || tag === 'h1' || tag === 'h2') {
      current = null;
    } else if (current) {
      current.appendChild(el.cloneNode(true));
    }
  }
  document.body.appendChild(root);
} catch(e){}})();
