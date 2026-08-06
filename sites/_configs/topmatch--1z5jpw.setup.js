// Wait for SPA to partially boot
await new Promise(r => setTimeout(r, 2000));

// Fetch all positions using the correct filter body
let positions = [];
try {
  const resp = await fetch('https://careers.topmatch.co.il/CandidateAPI/api/position/Search/76949C31-CA73-465E-A9DA-D374605B9212', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ PageNum: 1, PageSize: 100, KeyWords: '', CategoryIds: [], CityIds: [], CountryIds: [2] })
  });
  const data = await resp.json();
  positions = data.positions || [];
} catch(e) {
  // API failed — fall back to what SPA rendered, inject applicationInfo from position ID
  for (const item of document.querySelectorAll('a.job-item')) {
    if (item.querySelector('.__ai-applicationInfo')) continue;
    const posId = (item.getAttribute('data-positionid') || item.getAttribute('data-id') || '').trim();
    if (posId) {
      const s = document.createElement('span'); s.className = '__ai-applicationInfo';
      s.textContent = 'https://careers.topmatch.co.il/tadiran/redmatch-apply/redmatch.apply.html?compPositionID=' + posId;
      item.appendChild(s);
    }
  }
  return;
}

if (positions.length === 0) return;

// Check if we already injected (guard against re-run)
if (document.getElementById('__haide-jobs')) return;

const mk = (cls, val) => { const s = document.createElement('span'); s.className = cls; s.textContent = val; return s; };
const stripHtml = (html) => { const d = document.createElement('div'); d.innerHTML = html || ''; return (d.innerText || d.textContent || '').trim(); };

// Create an isolated container at the start of body — invisible to SPA
const container = document.createElement('div');
container.id = '__haide-jobs';
container.style.display = 'none';

for (const pos of positions) {
  const a = document.createElement('a');
  a.className = 'job-item __api-injected';

  a.appendChild(mk('__ai-title', pos.jobTitleText || ''));
  a.appendChild(mk('__ai-externalJobId', String(pos.compPositionID)));
  a.appendChild(mk('__ai-location', pos.location || pos.displayLocation || ''));
  a.appendChild(mk('__ai-publishDate', pos.activationDate || ''));
  a.appendChild(mk('__ai-applicationInfo', 'https://careers.topmatch.co.il/tadiran/redmatch-apply/redmatch.apply.html?compPositionID=' + pos.compPositionID));

  const desc = stripHtml(pos.description || pos.shortDescription || '');
  if (desc) a.appendChild(mk('__ai-description', desc));
  if (pos.affiliateDisplayName) a.appendChild(mk('__ai-department', pos.affiliateDisplayName));

  container.appendChild(a);
}

document.body.prepend(container);
