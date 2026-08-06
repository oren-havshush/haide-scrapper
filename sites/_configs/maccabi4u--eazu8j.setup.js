(function () {
  return (async function () {
    try {
      var resp = await fetch('/Umbraco/api/SearchJobsApi/FilterJobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'FreeText=&ResultsPerPage=500&PageNumber=0&AdvertisingDestination=1',
        credentials: 'same-origin',
      });
      var data = await resp.json();
      var container = document.querySelector('.search-jobs-results-cont');
      if (!container || !data || !Array.isArray(data.Results)) return -1;

      container.querySelectorAll('.job-item:not(.job-item-clone)').forEach(function (el) { el.remove(); });

      data.Results.forEach(function (j) {
        var areaText = (j.Areas && j.Areas[0] && j.Areas[0].Description) || '';
        var item = document.createElement('div');
        item.className = 'job-item';
        item.innerHTML =
          '<h2 class="job-title"></h2>' +
          '<div class="job-sub-title"></div>' +
          '<div class="job-profession"><span>תחום:</span><label></label></div>' +
          '<div class="bottom">' +
            '<div class="job-area"><span class="text"></span></div>' +
            '<a class="job-details-link"></a>' +
          '</div>' +
          '<span data-extracted-jobid="1" style="display:none"></span>';
        item.querySelector('.job-title').textContent = j.Description || '';
        item.querySelector('.job-sub-title').innerHTML = j.Notes || '';
        item.querySelector('.job-profession label').textContent = j.Profession || '';
        item.querySelector('.job-area .text').textContent = areaText;
        var a = item.querySelector('.job-details-link');
        a.setAttribute('href', j.JobUrl || '');
        a.textContent = 'לפרטי המשרה';
        item.querySelector('[data-extracted-jobid]').textContent = String(j.JobId || '');
        container.appendChild(item);
      });

      var btn = document.querySelector('button.load-more-jobs');
      if (btn && btn.parentElement) btn.parentElement.style.display = 'none';
    } catch (e) {}
    return document.querySelectorAll('.job-item:not(.job-item-clone)').length;
  })();
})();
