// Phenom careers site (Just Eat Takeaway / 10bis), Israel view /il/he/israel.
// Listing: one hidden card per Israeli job from the page's own data (window.phApp.ddo, server-rendered).
// Job page: description / requirements from the page's own jobDetail data, split by its bold headings.
// The apply link is NOT built here: the config reads the page's apply button (a[data-ph-at-id="apply-link"]).
// Apply pages: nothing to do.
if (/\/apply\b/.test(location.pathname)) return;

function sq(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
function mk(item, cls, v) { if (!v) return; var s = document.createElement('span'); s.className = cls; s.style.display = 'none'; s.textContent = v; item.appendChild(s); }

var ddo = null;
for (var t = 0; t < 40; t++) {
  ddo = window.phApp && window.phApp.ddo;
  if (ddo && (ddo.eagerLoadRefineSearch || ddo.jobDetail)) break;
  await new Promise(function (r) { setTimeout(r, 250); });
}
if (!ddo) return;

// ---- job page ----
if (/\/job\//.test(location.pathname)) {
  if (document.getElementById('haide-detail')) return;
  var job = ddo.jobDetail && ddo.jobDetail.data && ddo.jobDetail.data.job;
  if (!job || !job.description) return;
  // Headings are paragraphs whose whole text is bold.
  var REQ = /^(מה צריך להיות לכם|מה אנחנו מחפשים|דרישות( התפקיד| המשרה)?|כישורים|Can you deliver|Requirements|Qualifications|What you('ll)? (need|bring)|Who you are|About you)\s*[?:]?\s*$/i;
  var DROP = /^(All about the role|About the role|תיאור (ה)?(תפקיד|משרה)|Job description)\s*[?:]?\s*$/i;
  // A closing call to send a CV is not a requirement: it stays in the description.
  var CLOSE = /^(חושבים שאתם מתאימים|שלחו לנו קו|Think you('re| are) a (good )?(fit|match)|Apply now)/i;
  var root = new DOMParser().parseFromString('<div>' + job.description + '</div>', 'text/html').body.firstChild;
  var desc = [], req = [], inReq = false;
  var push = function (line) {
    line = sq(line); if (!line || line === '•') return;
    if (CLOSE.test(line)) { desc.push(line); return; }
    (inReq ? req : desc).push(line);
  };
  Array.prototype.forEach.call(root.childNodes, function (n) {
    if (n.nodeType === 3) { push(n.textContent); return; }
    if (n.nodeType !== 1) return;
    var tag = n.tagName;
    if (tag === 'BR') return;
    if (tag === 'UL' || tag === 'OL') {
      Array.prototype.forEach.call(n.querySelectorAll('li'), function (li) { var x = sq(li.textContent); if (x) push('• ' + x); });
      return;
    }
    var text = sq(n.textContent);
    var bold = Array.prototype.map.call(n.querySelectorAll('b,strong'), function (b) { return b.textContent; }).join('');
    if (text && sq(bold) === text) {
      if (REQ.test(text)) { inReq = true; return; }
      inReq = false;
      if (DROP.test(text)) return;
      desc.push(text);
      return;
    }
    var c = n.cloneNode(true);
    Array.prototype.forEach.call(c.querySelectorAll('br'), function (b) { b.replaceWith('\n'); });
    c.textContent.split('\n').forEach(push);
  });
  var holder = document.createElement('div');
  holder.id = 'haide-detail';
  holder.style.display = 'none';
  mk(holder, '__ai-description', desc.join('\n'));
  mk(holder, '__ai-requirements', req.join('\n'));
  document.body.appendChild(holder);
  return;
}

// ---- listing ----
if (document.getElementById('haide-jobs')) return;
var rs = ddo.eagerLoadRefineSearch;
var jobs = (rs && rs.data && rs.data.jobs) || [];
// The page's data holds its first page of results only; say so in the run log if the board outgrows it.
if (rs && rs.totalHits > jobs.length) console.warn('[haide] listing data holds ' + jobs.length + ' of ' + rs.totalHits + ' jobs: paging needed');
// Hebrew and English titles only (owner, 2026-09-27).
var HE_EN = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u;
var OTHER = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var base = location.origin + location.pathname.split('/').slice(0, 3).join('/');
var host = document.createElement('div');
host.id = 'haide-jobs';
host.style.display = 'none';
jobs.forEach(function (j) {
  if (j.country !== 'Israel' || !j.jobId) return;
  var title = sq(j.title);
  if (!HE_EN.test(title) || OTHER.test(title)) return;
  var url = base + '/job/' + j.jobId;
  var item = document.createElement('div');
  item.className = '__haide-job';
  var a = document.createElement('a');
  a.className = '__haide-link';
  a.href = url;
  a.textContent = title;
  item.appendChild(a);
  mk(item, '__ai-title', title);
  mk(item, '__ai-eid', 'justeattakeaway-' + j.jobId);
  mk(item, '__ai-location', sq(j.location));
  mk(item, '__ai-dept', sq(j.category));
  mk(item, '__ai-type', sq(j.type));
  mk(item, '__ai-date', String(j.postedDate || '').slice(0, 10));
  host.appendChild(item);
});
document.body.appendChild(host);
