return (async function() {
  if (document.querySelector('#haide-jobs-root')) return;
  function haideHash(s) { var h=5381,i=s.length; while(i){h=(h*33)^s.charCodeAt(--i);} return(h>>>0).toString(36); }
  function decodeEntities(s) {
    if (!s || s.indexOf('&') === -1) return s;
    var t = document.createElement('textarea');
    t.innerHTML = s;
    return t.value;
  }
  function stripHtml(html) {
    if (!html) return '';
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    tmp.querySelectorAll('br').forEach(function(n){ n.replaceWith('\n'); });
    tmp.querySelectorAll('p,div,li').forEach(function(n){ n.prepend('\n'); });
    return decodeEntities(tmp.textContent || '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n[ \t]*/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  var root = document.createElement('div');
  root.id = 'haide-jobs-root'; root.style.display = 'none';
  function mk(cls, text) { var e=document.createElement('div'); e.className=cls; e.style.display='none'; e.textContent=text; return e; }
  const resp = await fetch('/wp-admin/admin-ajax.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'action=tb_get_jobs&search=&job_region=&job_code='
  });
  const jobs = await resp.json();
  jobs.forEach(function(job) {
    var title = (job.header || '').trim();
    if (!title || !job.id) return;
    var item = document.createElement('div');
    item.setAttribute('data-haide-job', title.slice(0, 100));
    var idEl = document.createElement('div');
    idEl.setAttribute('data-haide-job-id', '1'); idEl.style.display = 'none'; idEl.textContent = 'tgbr-' + job.id;
    item.appendChild(mk('__ai-title', title));
    item.appendChild(idEl);
    if (job.region) item.appendChild(mk('__ai-location', job.region));
    if (job.category) item.appendChild(mk('__ai-department', job.category));
    var desc = stripHtml(job.description || '');
    if (desc) item.appendChild(mk('__ai-description', desc));
    if (job.date) item.appendChild(mk('__ai-date', job.date.slice(0, 10)));
    if (job.job_wa_link) {
      var applyVal = job.job_wa_link + '\n' + 'https://tigbur.co.il/%d7%9c%d7%95%d7%97-%d7%9e%d7%a9%d7%a8%d7%95%d7%aa-%d7%a8%d7%90%d7%a9%d7%99/';
      item.appendChild(mk('__ai-apply-url', applyVal));
    } else {
      item.appendChild(mk('__ai-apply-url', 'https://tigbur.co.il/%d7%9c%d7%95%d7%97-%d7%9e%d7%a9%d7%a8%d7%95%d7%aa-%d7%a8%d7%90%d7%a9%d7%99/'));
    }
    root.appendChild(item);
  });
  document.body.appendChild(root);
  return root.children.length;
})();
