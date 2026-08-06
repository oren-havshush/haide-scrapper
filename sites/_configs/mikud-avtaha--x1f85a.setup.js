(function(){
  function haideHash(s){var h=5381,i=s.length;while(i){h=(h*33)^s.charCodeAt(--i);}return(h>>>0).toString(36);}
  function blockText(el){
    if(!el)return '';
    var parts=[];
    (function walk(node){
      Array.prototype.forEach.call(node.childNodes,function(c){
        if(c.nodeType===3){parts.push(c.textContent);}
        else if(c.nodeType===1){
          var tag=c.tagName.toLowerCase();
          if(tag==='br'){parts.push('\n');return;}
          if(tag==='script'||tag==='style')return;
          walk(c);
          if(['div','p','h3','h4','h5','h6','li','tr'].indexOf(tag)!==-1)parts.push('\n');
        }
      });
    })(el);
    return parts.join('')
      .replace(/\u00A0/g,' ')
      .replace(/[^\S\n]+/g,' ')
      .replace(/\s*\n\s*/g,'\n')
      .replace(/\n{2,}/g,'\n')
      .trim();
  }
  function mk(cls,text){var e=document.createElement('span');e.className=cls;e.style.display='none';e.textContent=text;return e;}
  function jobNumOf(row){
    var firstTd=row.querySelector('td:nth-child(1)');
    if(!firstTd)return '';
    var titleText=Array.from(firstTd.childNodes).filter(function(n){return n.nodeType===3;}).map(function(n){return n.textContent.trim();}).join(' ').replace(/\s+/g,' ').trim();
    var tm=titleText.match(/\u05de\u05e9\u05e8\u05d4\s*[\u2013\-]\s*(\d+)/);
    if(tm)return tm[1];
    var detailRow=row.nextElementSibling;
    var detailTd=detailRow?detailRow.querySelector('td[id$="_to"]'):null;
    if(detailTd){var dm=(detailTd.textContent||'').match(/\u05de\u05e1\u05e4\u05e8\s*\u05de\u05e9\u05e8\u05d4:\s*(\d+)/);if(dm)return dm[1];}
    return '';
  }
  var rows=Array.prototype.filter.call(document.querySelectorAll('table.table.table-hover.jobs tr'),function(row){return row.querySelector('td:nth-child(5) a.fancybox');});
  var freq={};
  rows.forEach(function(row){var n=jobNumOf(row);if(n)freq[n]=(freq[n]||0)+1;});
  rows.forEach(function(row){
    if(row.querySelector('.__ai-title'))return;
    var firstTd=row.querySelector('td:nth-child(1)');
    if(!firstTd)return;
    var titleText=Array.from(firstTd.childNodes).filter(function(n){return n.nodeType===3;}).map(function(n){return n.textContent.trim();}).join(' ').replace(/\s+/g,' ').trim();
    var applyLink=row.querySelector('td:nth-child(5) a.fancybox');
    var postId=(applyLink.getAttribute('href')||'').replace('#job_form_pop_','');
    var jobNum=jobNumOf(row);
    var eid;
    if(jobNum){eid=freq[jobNum]>1?(jobNum+'-'+postId):jobNum;}
    else{eid='h-'+haideHash(titleText.toLowerCase());}
    firstTd.insertBefore(mk('__ai-title',titleText),firstTd.firstChild);
    firstTd.appendChild(mk('__ai-externalJobId',eid));
    var detailRow=row.nextElementSibling;
    var detailTd=detailRow?detailRow.querySelector('td[id$="_to"]'):null;
    if(detailTd){
      var descEl=detailTd.querySelector('.job-details');
      var reqEl=detailTd.querySelector('.job-requirements');
      if(descEl)firstTd.appendChild(mk('__ai-description',blockText(descEl)));
      if(reqEl)firstTd.appendChild(mk('__ai-requirements',blockText(reqEl)));
      var mail=detailTd.querySelector('a[href^="mailto:"]');
      if(mail)firstTd.appendChild(mk('__ai-apply-email','mailto:'+mail.getAttribute('href').replace(/^mailto:/,'').trim()));
    }
  });
})()
