(function(){
  function haideHash(s){var h=5381,i=s.length;while(i){h=(h*33)^s.charCodeAt(--i);}return(h>>>0).toString(36);}
  var LOC='נתב"ג';
  document.querySelectorAll('li.collapse--item').forEach(function(li){
    if(li.querySelector('.__ai-eid'))return;
    var a=li.querySelector('a[href*="jid="]');
    var m=a?(a.getAttribute('href')||'').match(/[?&]jid=(\d+)/):null;
    var title=(li.querySelector('button.collapse--question')||{}).textContent||'';
    var eid=m?('jid-'+m[1]):('h-'+haideHash(title.trim().toLowerCase()));
    function mk(cls,text){var s=document.createElement('span');s.className=cls;s.style.display='none';s.textContent=text;return s;}
    li.appendChild(mk('__ai-eid',eid));
    li.appendChild(mk('__ai-location',LOC));
  });
})()
