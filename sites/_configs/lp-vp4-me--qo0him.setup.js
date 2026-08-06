(function(){try{
  document.querySelectorAll('.article.product').forEach(function(el){
    if (el.querySelector('[data-haide-job-id]')) return;
    var s = document.createElement('span');
    s.setAttribute('data-haide-job-id', '1');
    s.style.display = 'none';
    s.textContent = (el.id || '').replace(/^i_/, '');
    el.appendChild(s);
  });
}catch(e){}})();
