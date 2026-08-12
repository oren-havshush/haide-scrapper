async function cellcomInject() {
  const api = 'https://contentepi.cellcom.co.il/jobs/Careersportal/?expand=*&currentPageUrl=%2Fjobs%2FCareersportal%2F';
  const res = await fetch(api, { credentials: 'omit' });
  const data = await res.json();
  const jobs = (data && data.listAdsCareers && data.listAdsCareers.expandedValue) || [];
  const host = document.createElement('div');
  host.id = 'cc-jobs-injected';
  const val = (p) => (p && typeof p === 'object' && 'value' in p) ? p.value : p;
  const stripHtml = (h) => { const d = document.createElement('div'); d.innerHTML = h || ''; return (d.textContent || '').replace(/\s+/g, ' ').trim(); };
  for (const j of jobs) {
    if (val(j.isHiddenAd) === true || val(j.isHiddenAd) === 'True') continue;
    const card = document.createElement('div');
    card.className = 'cc-job';
    const title = val(j.title) || '';
    const code = val(j.codeJob) || '';
    const desc = val(j.description) || '';
    const reqArr = val(j.listRequirements) || [];
    const req = Array.isArray(reqArr) ? ('<ul><li>' + reqArr.join('</li><li>') + '</li></ul>') : String(reqArr || '');
    const locArr = val(j.listOfCareerLocations) || [];
    const loc = Array.isArray(locArr) ? locArr.join(', ') : String(locArr || '');
    const rel = j.url || '';
    const detail = rel ? ('https://cellcom.co.il' + rel) : '';
    const h = document.createElement('h3'); h.className = 'cc-title'; h.textContent = title; card.appendChild(h);
    const c = document.createElement('span'); c.className = 'cc-code'; c.textContent = code; card.appendChild(c);
    const foot = val(j.footerSite) || ''; const d = document.createElement('div'); d.className = 'cc-desc'; d.innerHTML = desc + foot; card.appendChild(d);
    const r = document.createElement('div'); r.className = 'cc-req'; r.innerHTML = req; card.appendChild(r);
    const l = document.createElement('div'); l.className = 'cc-loc'; l.textContent = loc; card.appendChild(l);
    if (detail) { const a = document.createElement('a'); a.className = 'cc-detail'; a.href = detail; a.textContent = 'apply'; card.appendChild(a); }
    host.appendChild(card);
  }
  document.body.appendChild(host);
  return jobs.length;
}
return await cellcomInject();
