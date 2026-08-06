
try {
  for (var w=0; w<60; w++){ if (document.querySelectorAll('.branch-item').length>0) break; await new Promise(function(r){setTimeout(r,150);}); }
  await new Promise(function(r){setTimeout(r,400);});
  function haideHash(str){var h=5381,i=str.length;while(i){h=(h*33)^str.charCodeAt(--i);}return (h>>>0).toString(36);}
  document.querySelectorAll('.branch-item').forEach(function(card){
    var hEl=card.querySelector('h2');
    if(!hEl) return;
    var title=(hEl.textContent||'').trim();
    var locEl=card.querySelector('.title-30 > div');
    var loc=locEl?(locEl.textContent||'').trim():'';
    if(title && !hEl.getAttribute('data-ex-id')){
      hEl.setAttribute('data-ex-id','gm-'+haideHash((title+'|'+loc).toLowerCase()));
    }
    if(!hEl.getAttribute('data-ex-req')){
      var pills=card.querySelectorAll('.flex.flex-wrap > div');
      var parts=[];
      pills.forEach(function(pp){var t2=(pp.textContent||'').replace(/\s+/g,' ').trim();if(t2)parts.push(t2);});
      if(parts.length) hEl.setAttribute('data-ex-req', parts.join('\n'));
    }
  });
} catch(e){}
