(function() {
  if (document.querySelector('#haide-jobs-root')) return;
  var root = document.createElement('div');
  root.id = 'haide-jobs-root'; root.style.display = 'none';
  function mk(cls, text) { var e=document.createElement('div'); e.className=cls; e.style.display='none'; e.textContent=text; return e; }
  document.querySelectorAll('div.faq-item').forEach(function(card) {
    var titleEl = card.querySelector('p.jobs-item-title strong');
    var locationEl = card.querySelector('p.jobs-item-title small');
    var toggleLink = card.querySelector('a[data-toggle="collapse"][href^="#collapseJobsItem"]');
    var title = titleEl ? titleEl.textContent.trim() : '';
    if (!title) return;
    var m = toggleLink ? toggleLink.getAttribute('href').match(/collapseJobsItem(\d+)/) : null;
    var jobId = m ? m[1] : '';
    if (!jobId) return;
    var contentDiv = card.querySelector('div[id^="jobs-content-"]');
    var description = '';
    var requirements = '';
    if (contentDiv) {
      var clone = contentDiv.cloneNode(true);
      clone.querySelectorAll('.d-inline-block,.clearfix,button,a,img').forEach(function(e){ e.remove(); });
      clone.querySelectorAll('br').forEach(function(br){ br.insertAdjacentText('afterend','\n'); });
      var raw = clone.textContent.replace(/[ \t]+/g,' ').replace(/\n[ \t]*/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
      var reqIdx = raw.indexOf("דרישות:");
      if (reqIdx > -1) {
        description = raw.slice(0, reqIdx).trim();
        requirements = raw.slice(reqIdx).trim();
      } else {
        description = raw;
      }
    }
    var item = document.createElement('div');
    item.setAttribute('data-haide-job', title.slice(0,100));
    var idEl = document.createElement('div');
    idEl.setAttribute('data-haide-job-id','1'); idEl.style.display='none'; idEl.textContent='sj-'+jobId;
    item.appendChild(mk('__ai-title', title));
    item.appendChild(idEl);
    if (locationEl && locationEl.textContent.trim()) item.appendChild(mk('__ai-location', locationEl.textContent.trim()));
    if (description) item.appendChild(mk('__ai-description', description));
    if (requirements) item.appendChild(mk('__ai-requirements', requirements));
    item.appendChild(mk('__ai-apply-url', 'https://www.shagrir.co.il/jobs#jobs-cv-' + jobId));
    root.appendChild(item);
  });
  document.body.appendChild(root);
})();
