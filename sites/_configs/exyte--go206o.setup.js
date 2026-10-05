// Phenom board. Runs on the listing (/global/en) only; the worker also runs it on job and apply pages.
if (/\/(job|apply)\b/.test(location.pathname)) return;
if (document.getElementById('haide-jobs')) return;

function sq(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
function mk(item, cls, v) { if (!v) return; var s = document.createElement('span'); s.className = cls; s.style.display = 'none'; s.textContent = v; item.appendChild(s); }

// Israel only (LRN-SPA-10): the board's own Country/Region facet, so every Israeli job is kept.
// City names map to the verbatim city.csv entry; any other city becomes Unknown (LRN-LOC-4).
var CITY = { 'Kiryat Gat': 'קרית גת', 'Rehovot': 'רחובות', 'Nes Ziona': 'נס ציונה' };
// Requirement headings, including ones an employer types inside the role section (24801).
var REQ_HEAD = /^(Show your expertise|Requirements?( \/ Desired Background)?|Required Skills|Qualifications)\s*:?$/i;
var LABEL = /^(Discover your exciting role|Explore your tasks and responsibilities|Role Overview|Responsibilities|Contact)\s*:?$/i;
// The equal-opportunity line stays in the description.
var KEEP = /regardless of gender|equal opportunit/i;
// An unfilled posting template: bullets reading "XXX" and a "<Name Surname>" contact.
var TEMPLATE = /<li>\s*XXX\s*<\/li>/i;

var jobs = [];
for (var from = 0, total = 1; from < total && from < 500; from += 50) {
  var body = { lang: 'en_global', deviceType: 'desktop', country: 'global', pageName: 'search-results', ddoKey: 'refineSearch',
    sortBy: 'Most recent', subsearch: '', from: from, jobs: true, counts: true, all_fields: ['country'], size: 50, clearAll: false,
    jdsource: 'facets', isSliderEnable: false, pageId: 'page12', siteType: 'external', keywords: '', global: true,
    selected_fields: { country: ['Israel'] }, locationData: {} };
  var res;
  try { res = await (await fetch('/widgets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' })).json(); } catch (e) { return; }
  var rs = res && res.refineSearch;
  if (!rs || !rs.data || !rs.data.jobs) return;
  total = rs.totalHits || 0;
  jobs = jobs.concat(rs.data.jobs);
}

function lines(html) {
  var d = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html').body;
  Array.prototype.forEach.call(d.querySelectorAll('br'), function (e) { e.replaceWith('\n'); });
  Array.prototype.forEach.call(d.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6'), function (e) { e.insertAdjacentText('afterend', '\n'); });
  return (d.textContent || '').split('\n').map(sq).filter(Boolean);
}
function ddo(html) {
  var i = html.indexOf('phApp.ddo = ');
  if (i < 0) return null;
  var s = html.slice(i + 12), dep = 0, e = 0;
  for (; e < s.length; e++) { if (s[e] === '{') dep++; else if (s[e] === '}') { dep--; if (!dep) break; } }
  try { return JSON.parse(s.slice(0, e + 1)); } catch (x) { return null; }
}

var host = document.createElement('div');
host.id = 'haide-jobs';
host.style.display = 'none';
document.body.appendChild(host);

var seen = {};
await Promise.all(jobs.map(async function (j) {
  if (j.country !== 'Israel' || !j.jobId || seen[j.jobId]) return;
  seen[j.jobId] = 1;
  var url = location.origin + '/global/en/job/' + j.jobId + '/' + encodeURIComponent((j.title || '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, ''));
  var job;
  try { var o = ddo(await (await fetch(url, { credentials: 'same-origin' })).text()); job = o && o.jobDetail && o.jobDetail.data && o.jobDetail.data.job; } catch (e) { return; }
  if (!job || !job.description) return;
  if (TEMPLATE.test(job.description)) return;
  var desc = [], req = [], inReq = false;
  lines(job.description).forEach(function (l) {
    if (REQ_HEAD.test(l)) { inReq = true; return; }
    if (LABEL.test(l)) { inReq = false; return; }
    (inReq && !KEEP.test(l) ? req : desc).push(l);
  });
  var item = document.createElement('div');
  item.className = '__haide-job';
  var a = document.createElement('a');
  a.className = '__haide-link';
  a.href = url;
  a.textContent = j.title;
  item.appendChild(a);
  mk(item, '__ai-title', sq(j.title));
  mk(item, '__ai-url', url);
  mk(item, '__ai-eid', 'exyte-' + j.jobId);
  mk(item, '__ai-location', CITY[j.city] || 'Unknown');
  mk(item, '__ai-dept', sq(j.category));
  mk(item, '__ai-date', String(j.postedDate || '').slice(0, 10));
  mk(item, '__ai-description', desc.join('\n'));
  mk(item, '__ai-requirements', req.join('\n'));
  host.appendChild(item);
}));
