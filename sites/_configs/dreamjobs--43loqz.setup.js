
var host = document.querySelector('.careers__available-jobs-container') || document.body;
// Remove the SSR rows FIRST. If anything below fails, the page is left with no
// items, so the scrape reports empty_results and returns before deleteMany —
// existing jobs are preserved rather than overwritten with blank descriptions.
document.querySelectorAll('.careers__career-row').forEach(function(x){ x.remove(); });
var n = window.__NUXT__;
if (!n) return;
var jobs = null;
(function find(o, d){
  if (!o || d > 6 || jobs) return;
  if (Array.isArray(o)) {
    if (o.length > 20 && o[0] && typeof o[0] === 'object' &&
        'order_id' in o[0] && 'notes' in o[0]) { jobs = o; return; }
    for (var i = 0; i < Math.min(o.length, 3) && !jobs; i++) find(o[i], d + 1);
  } else if (typeof o === 'object') {
    for (var k in o) { if (jobs) break; find(o[k], d + 1); }
  }
})(n, 0);
if (!jobs || !jobs.length) return;
for (var i = 0; i < jobs.length; i++) {
  var j = jobs[i];
  if (j == null || j.order_id == null) continue;
  var a = document.createElement('a');
  a.className = 'careers__career-row';
  a.setAttribute('href', '/career/' + j.order_id);

  var h = document.createElement('h1');
  h.className = 'text-fontSize-24 text-fontWeight-600 text-lineHeight-1';
  h.textContent = j.description == null ? '' : String(j.description);
  a.appendChild(h);

  var pc = document.createElement('p');
  pc.className = 'careers__career-city mb-0 text-fontSize-16';
  var sp = document.createElement('span');
  sp.textContent = j.city == null ? '' : String(j.city);
  pc.appendChild(sp);
  a.appendChild(pc);

  var idw = document.createElement('div');
  idw.className = 'careers__career-id text-fontSize-22';
  var ids = document.createElement('span');
  ids.textContent = String(j.order_id);
  idw.appendChild(ids);
  a.appendChild(idw);

  var dw = document.createElement('div');
  dw.className = 'animated__drawer-open-content';
  var dp = document.createElement('p');
  dp.className = 'text-fontSize-22';
  dp.textContent = j.notes == null ? '' : String(j.notes);
  dw.appendChild(dp);
  a.appendChild(dw);

  host.appendChild(a);
}
