
// ===== MIGDAL JOBS — load all jobs from the CMS API =====
if (document.querySelector('#haide-jobs-root')) return;

return (async function() {
  var res = await fetch('/data/api/ContentData/FrontContentData/?ListType=Jobs&Source=content');
  var json = await res.json();
  var jobs = (json && json.Data) || [];

  function stripHtml(html) {
    if (!html) return '';
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    // newlines for block elements
    tmp.querySelectorAll('p,li,br,div,ul,ol').forEach(function(n) {
      if (n.tagName === 'BR') n.replaceWith('\n');
      else n.prepend('\n');
    });
    return (tmp.textContent || '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n[ \t]*/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  var root = document.createElement('div');
  root.id = 'haide-jobs-root';
  root.style.display = 'none';

  jobs.forEach(function(job) {
   // One bad record is skipped and named; it never aborts the list.
   try {
    // Use the CMS document _id as the unique key: numberJob is NOT unique on
    // this site (the recruiter reuses one requisition number across distinct
    // postings), which collapsed 43 -> 39 when dedup keyed off numberJob.
    var docId = (job._id != null ? String(job._id) : '').trim();
    var title = (job.jobTitle || job._name || '').trim();
    if (!title || !docId) return;

    var description = stripHtml(job.jobDescription);
    var requirements = stripHtml(job.requirements);

    // Clean location: strip address suffix after first comma if it's a street address
    var location = (job.jobLocation || '').replace(/\|.*$/, '').trim();
    // "היצירה 2, קרית אריה פתח-תקווה" -> take part after last comma (city)
    var locParts = location.split(',');
    if (locParts.length > 1) location = locParts[locParts.length - 1].trim();

    var area = '';
    // jobArea entries can be null (a deleted CMS area still referenced); one
    // null used to throw here and abort the whole list.
    var firstArea = Array.isArray(job.jobArea) ? job.jobArea.filter(Boolean)[0] : null;
    if (firstArea) {
      area = (firstArea.areaTitle || firstArea._name || '').trim();
    } else if (typeof job.jobArea === 'string') {
      area = job.jobArea.trim();
    }

    var scope = (job.jobScope || '').trim();

    var el = document.createElement('div');
    el.setAttribute('data-haide-job', '1');

    function mk(cls, val) {
      if (!val) return;
      var d = document.createElement('div');
      d.className = cls; d.style.display = 'none'; d.textContent = val;
      el.appendChild(d);
    }

    mk('__ai-title', title);
    mk('__ai-jobid', 'mgdl-' + docId);
    mk('__ai-location', location);
    mk('__ai-department', area);
    mk('__ai-description', description);
    mk('__ai-requirements', requirements);
    mk('__ai-scope', scope);

    root.appendChild(el);
   } catch (e) {
    console.warn('[setupScript my.migdal] skipped posting _id=' + (job && job._id) + ': ' + (e && e.message));
   }
  });

  document.body.appendChild(root);
  return root.children.length;
})();
