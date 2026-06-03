// NVIDIA Workday (nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite?q=Israel)
// siteId cmplb58zt000601mvvpvedp8g — single-page config (pageFlow: []).
//
// Workday is an offset-paginated SPA: the page URL never changes between
// pages, so worker `url` pagination can't drive it. Instead this setupScript
// enumerates EVERY posting via the list API, rebuilds the results list with
// one row per posting, then enriches each with its description JSON
// (bounded concurrency + retry, since Workday throttles bursts with 429).
//
// Relies on the worker awaiting async setupScript (fix 2026-05-31): top-level
// `await` runs directly (the worker executes this source as an AsyncFunction
// body and awaits it). Do NOT wrap in a self-invoking IIFE.
//
// Paired config:
//   itemSelector:   [data-automation-id="jobResults"] li:has(a[data-automation-id="jobTitle"])
//   revealSelector: a[data-automation-id="jobTitle"]
//   fields (all relative to item, all source MANUAL):
//     title         -> a[data-automation-id="jobTitle"]
//     detailUrl     -> [data-extracted-detailurl]
//     externalJobId -> [data-extracted-jobid]
//     location      -> [data-extracted-location]
//     publishDate   -> [data-extracted-posted]
//     description   -> [data-extracted-description]
// Verified 2026-05-31: 480/480 jobs, 450 descriptions, 100% other fields.
try {
  var origin = location.origin;
  var listUrl = origin + '/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs';
  var cxsBase = origin + '/wday/cxs/nvidia/NVIDIAExternalCareerSite';
  var detailBase = origin + '/NVIDIAExternalCareerSite';

  var inj = function (li, attr, val) {
    var s = document.createElement('span');
    s.setAttribute(attr, '1');
    s.style.display = 'none';
    s.textContent = (val == null ? '' : String(val));
    li.appendChild(s);
    return s;
  };

  // 0) Discover Israel LOCATION-facet ids dynamically. We must filter by the
  //    location facet (applied key: "locations"), NOT searchText — a keyword
  //    search for "Israel" also returns US/Thailand jobs that merely mention
  //    Israel in their text. Facet ids are stable hashes; discovering them at
  //    runtime keeps us correct if NVIDIA adds a new Israeli site.
  var israelIds = [];
  try {
    var fr = await fetch(listUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ appliedFacets: {}, limit: 1, offset: 0, searchText: '' }),
    });
    if (fr.ok) {
      var fj = await fr.json();
      var stack = (fj.facets || []).slice();
      while (stack.length) {
        var node = stack.pop();
        if (!node || typeof node !== 'object') continue;
        if (/^Israel,/i.test(node.descriptor || '') && node.id) israelIds.push(node.id);
        if (Array.isArray(node.values)) for (var vi = 0; vi < node.values.length; vi++) stack.push(node.values[vi]);
        if (Array.isArray(node.facets)) for (var fi = 0; fi < node.facets.length; fi++) stack.push(node.facets[fi]);
      }
    }
  } catch (e) {}
  // Filter by location facet when discovered; fall back to keyword otherwise.
  var APPLIED = israelIds.length ? { locations: israelIds } : {};
  var SEARCH = israelIds.length ? '' : 'Israel';

  // 1) Enumerate every posting via offset pagination (20 per page).
  var all = [];
  var limit = 20, offset = 0, total = null;
  while (offset < 2000) {
    var lr = await fetch(listUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ appliedFacets: APPLIED, limit: limit, offset: offset, searchText: SEARCH }),
    });
    if (!lr.ok) break;
    var lj = await lr.json();
    if (total == null) total = lj.total || 0;
    var batch = lj.jobPostings || [];
    for (var i = 0; i < batch.length; i++) all.push(batch[i]);
    offset += limit;
    if (batch.length === 0 || offset >= total) break;
  }

  // 2) Rebuild the results list with one row per posting (seed from list data).
  var results = document.querySelector('[data-automation-id="jobResults"]');
  if (!results) return;
  var ul = results.querySelector('ul');
  if (!ul) { ul = document.createElement('ul'); results.appendChild(ul); }
  ul.innerHTML = '';

  var rows = [];
  for (var k = 0; k < all.length; k++) {
    var post = all[k];
    var ep = post.externalPath || '';
    if (!ep) continue;
    var li = document.createElement('li');
    var h3 = document.createElement('h3');
    var a = document.createElement('a');
    a.setAttribute('data-automation-id', 'jobTitle');
    a.setAttribute('href', detailBase + ep);
    a.textContent = post.title || '';
    h3.appendChild(a);
    li.appendChild(h3);
    inj(li, 'data-extracted-jobid', (post.bulletFields && post.bulletFields[0]) || '');
    inj(li, 'data-extracted-detailurl', detailBase + ep);
    var locSpan = inj(li, 'data-extracted-location', post.locationsText || '');
    var postedSpan = inj(li, 'data-extracted-posted', post.postedOn || '');
    var descSpan = inj(li, 'data-extracted-description', '');
    ul.appendChild(li);
    rows.push({ ep: ep, descSpan: descSpan, locSpan: locSpan, postedSpan: postedSpan });
  }

  // 3) Enrich each row with the per-job description JSON (bounded concurrency,
  //    continue-on-error so a throttled job just keeps its list-level fields).
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var idx = 0;
  var pump = async function () {
    while (idx < rows.length) {
      var my = rows[idx++];
      // Up to 3 attempts with backoff — Workday throttles rapid bursts (429).
      for (var attempt = 0; attempt < 3; attempt++) {
        try {
          var jr = await fetch(cxsBase + my.ep, { headers: { accept: 'application/json' }, credentials: 'include' });
          if (!jr.ok) {
            if (jr.status === 429 || jr.status >= 500) { await sleep(400 + attempt * 600); continue; }
            break;
          }
          var jj = await jr.json();
          var info = jj.jobPostingInfo || {};
          var tmp = document.createElement('div');
          tmp.innerHTML = info.jobDescription || '';
          var descText = (tmp.textContent || '').replace(/\s+/g, ' ').trim();
          if (descText) my.descSpan.textContent = descText;
          var loc = info.location || '';
          if (info.additionalLocations && info.additionalLocations.length) {
            loc = loc + '; ' + info.additionalLocations.join('; ');
          }
          if (loc) my.locSpan.textContent = loc;
          if (info.startDate) my.postedSpan.textContent = info.startDate;
          break;
        } catch (e) {
          await sleep(400 + attempt * 600);
        }
      }
    }
  };
  var CONC = 6;
  var pumps = [];
  for (var w = 0; w < CONC; w++) pumps.push(pump());
  await Promise.all(pumps);
} catch (e) {}
