var w = window;
if (!w.angular) return;
var anchor = document.querySelector('.TableRowWrap') || document.body;
var s = w.angular.element(anchor).scope();
while (s && !s.Jobs) s = s.$parent;
if (!s || !Array.isArray(s.Jobs)) return;
var jobs = s.Jobs;
document.querySelectorAll('.TableRowWrap').forEach(function(n){ n.remove(); });
var host = document.body;
function esc(str){ var d=document.createElement('div'); d.textContent=str==null?'':String(str); return d.innerHTML; }
for (var i = 0; i < jobs.length; i++) {
  var j = jobs[i];
  var wrap = document.createElement('div');
  wrap.className = 'TableRowWrap';
  wrap.id = 'job_' + j.JobId;
  wrap.setAttribute('data-job-id', String(j.JobId));
  var apply = 'https://www.clalbit.co.il/careers/candidacy/?txtjobId=' + encodeURIComponent(j.JobId);
  wrap.innerHTML =
    '<span class="JobIdNumber" style="display:none">' + esc(j.JobId) + '</span>' +
    '<div class="TableCol">' + esc(j.JobTitle) + '</div>' +
    '<div class="TableCol">' + esc(j.Location) + '</div>' +
    '<div class="TableCol">' + esc(j.Extent) + '</div>' +
    '<div class="JobDetails">' + esc(j.JobDesc) + '</div>' +
    '<div class="WantedDesc">' + esc(j.Qualifications) + '</div>' +
    '<a class="SendBtn" href="' + apply + '">apply</a>';
  host.appendChild(wrap);
}
