(function(){try{
  document.querySelectorAll('article.ecs-post-loop').forEach(function(el){
    if(!el.querySelector('[data-eso-jobid]')){
      var m=(el.className||'').match(/post-(\d+)/);
      if(m&&m[1]){var s=document.createElement('span');s.setAttribute('data-eso-jobid','1');s.style.display='none';s.textContent=m[1];el.appendChild(s);}
    }
    if(!el.querySelector('[data-eso-location]')){
      var l=document.createElement('span');l.setAttribute('data-eso-location','1');l.style.display='none';l.textContent='אופקים';el.appendChild(l);
    }
  });
}catch(e){}})();
