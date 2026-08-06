(function(){try{
  if(document.querySelector('#haide-jobs-root'))return;

  function haideHash(s){var h=5381,i=s.length;while(i){h=(h*33)^s.charCodeAt(--i);}return(h>>>0).toString(36);}

  function structuredText(el){
    if(!el)return'';
    var c=el.cloneNode(true);
    c.querySelectorAll('p,div,ul,li,br,h1,h2,h3,h4,h5,h6').forEach(function(e){e.insertAdjacentText('afterend','\n');});
    return c.textContent.replace(/\n{3,}/g,'\n\n').trim();
  }

  function extractLocation(title){
    var m=title.match(/^(.*?)\s*[\u2013\u2014]\s*(.+)$/);
    if(m)return{cleanTitle:m[1].trim(),location:m[2].trim()};
    var m2=title.match(/^(.*)\s+\u05D1([\u05D0-\u05EA"' ]+)$/);
    if(m2)return{cleanTitle:m2[1].trim(),location:m2[2].trim()};
    return{cleanTitle:title,location:''};
  }

  function mk(cls,text){
    var e=document.createElement('div');
    if(cls)e.className=cls;
    e.style.display='none';
    e.textContent=text;
    return e;
  }

  var root=document.createElement('div');
  root.id='haide-jobs-root';
  root.style.display='none';

  var boxes=Array.from(document.querySelectorAll('.jobeBox.heb'));
  for(var i=0;i<boxes.length;i++){
    var box=boxes[i];
    var titleEl=box.querySelector('.theTitle span:first-child');
    if(!titleEl)continue;
    var titleText=(titleEl.textContent||'').trim();
    if(!titleText)continue;

    var loc=extractLocation(titleText);

    var numEl=box.querySelector('.jobeNumber span[data-font-size="50"]');
    var jobNum=numEl?'tama-'+(numEl.textContent||'').trim():'h-'+haideHash(titleText);

    var theJobe=box.querySelector('.theJobe');
    if(theJobe)theJobe.style.display='block';

    var contentEl=box.querySelector('.theJobe .Content');
    var descText=structuredText(contentEl);

    var job=document.createElement('div');
    job.setAttribute('data-haide-job',titleText.slice(0,100));
    job.appendChild(mk('__ai-title',loc.cleanTitle||titleText));
    var idEl=mk('',jobNum);
    idEl.setAttribute('data-haide-job-id','1');
    job.appendChild(idEl);
    if(loc.location)job.appendChild(mk('__ai-location',loc.location));
    if(descText)job.appendChild(mk('__ai-description',descText));
    root.appendChild(job);
  }
  document.body.appendChild(root);
}catch(e){}})();
