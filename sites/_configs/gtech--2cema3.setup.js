document.querySelectorAll('article.elementor-post').forEach(function(it){
  try {
    if (!it.querySelector('[data-extracted-jobid]')) {
      var m = (it.className||'').match(/post-(\d+)/);
      if (m) {
        var s=document.createElement('span');
        s.setAttribute('data-extracted-jobid','1');
        s.style.display='none';
        s.textContent=m[1];
        it.appendChild(s);
      }
    }
    if (!it.querySelector('[data-extracted-location]')) {
      var loc=document.createElement('span');
      loc.setAttribute('data-extracted-location','1');
      loc.style.display='none';
      loc.textContent='תל אביב';
      it.appendChild(loc);
    }
  } catch(e){}
});
