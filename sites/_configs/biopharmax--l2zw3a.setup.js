try {
  function hh(s){var h=5381,i=s.length;while(i){h=(h*33)^s.charCodeAt(--i);}return (h>>>0).toString(36);}
  document.querySelectorAll('div.inner').forEach(function(d){
    if(!d.querySelector(':scope > h2')) return;
    if(d.querySelector('[data-haide-desc]')) return;
    var h2 = d.querySelector(':scope > h2');
    var title = (h2.textContent||'').replace(/\s+/g,' ').trim();
    var parts=[];
    d.querySelectorAll(':scope > h3, :scope > p, :scope > ul').forEach(function(el){
      var t=(el.textContent||'').replace(/\s+/g,' ').trim();
      if(t) parts.push(t);
    });
    var ds=document.createElement('span'); ds.setAttribute('data-haide-desc','1'); ds.style.display='none'; ds.textContent=parts.join('\n'); d.appendChild(ds);
    var es=document.createElement('span'); es.setAttribute('data-ex-id','1'); es.style.display='none'; es.textContent='h-'+hh(title.toLowerCase()); d.appendChild(es);
  });
} catch(e){}
