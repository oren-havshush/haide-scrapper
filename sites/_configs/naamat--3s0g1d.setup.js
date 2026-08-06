(function(){
  // === Listing page: inject job IDs ===
  document.querySelectorAll('div.job-preview.clearfix').forEach(function(item){
    if(item.querySelector('[data-haide-job-id]'))return;
    var link=item.querySelector('.job-content h5 a,.job-content a');
    if(!link)return;
    var href=link.href||'';
    var slug=href.replace(/.*\/job\//,'').replace(/\/$/, '');
    slug=decodeURIComponent(slug);
    var idEl=document.createElement('span');
    idEl.setAttribute('data-haide-job-id','1');
    idEl.style.display='none';
    idEl.textContent=slug||href;
    item.appendChild(idEl);
  });

  // === Detail page: combine תיאור + כישורים into one element ===
  if(document.querySelector('[data-haide-description]'))return;
  var descEl=document.querySelector('.jobs-row.position_description .jobs-row-input');
  var qualEl=document.querySelector('.jobs-row.position_qualifications .jobs-row-input');
  if(!descEl&&!qualEl)return;
  function structuredText(el){
    if(!el)return'';
    var c=el.cloneNode(true);
    c.querySelectorAll('p,div,li,br,h1,h2,h3,h4,h5,h6').forEach(function(e){e.insertAdjacentText('afterend','\n');});
    return c.textContent.replace(/\n{3,}/g,'\n\n').trim();
  }
  var parts=[];
  var d=structuredText(descEl);
  var q=structuredText(qualEl);
  if(d)parts.push(d);
  if(q)parts.push('כישורים:\n'+q);
  var combined=parts.join('\n\n');
  if(combined){
    var t=document.createElement('div');
    t.setAttribute('data-haide-description','1');
    t.style.display='none';
    t.textContent=combined;
    document.body.appendChild(t);
  }
})();
