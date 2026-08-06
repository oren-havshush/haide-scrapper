(function(){try{
  document.querySelectorAll('article.elementor-post.ecs-post-loop').forEach(function(art){
    if(art.querySelector('[data-haide-job-id]'))return;
    var titleEl=art.querySelector('.elementor-heading-title');
    var titleText=(titleEl?titleEl.textContent:'').trim();
    var m=titleText.match(/\u05DE\u05E9\u05E8\u05D4\s+(\d+)/);
    var jobId=m?'yeadim-'+m[1]:'yeadim-'+art.id;
    var idEl=document.createElement('span');
    idEl.setAttribute('data-haide-job-id','1');
    idEl.style.display='none';
    idEl.textContent=jobId;
    art.appendChild(idEl);
    var locEl=document.createElement('span');
    locEl.className='__ai-location';
    locEl.style.display='none';
    locEl.textContent='\u05E4\u05EA\u05D7 \u05EA\u05E7\u05D5\u05D5\u05D4';
    art.appendChild(locEl);
    var emailEl=document.createElement('span');
    emailEl.className='__ai-apply-email';
    emailEl.style.display='none';
    emailEl.textContent='mailto:info@yeadim-bit.co.il';
    art.appendChild(emailEl);
  });
}catch(e){}})();
