// minrav.co.il /careers/ — setupScript
// Injects per-item hidden spans the worker's selectors read:
//   .__ai-loc          canonical city name (per "CSV files/city.csv")
//   .__ai-eid          stable externalJobId (hash of title only)
//   .__ai-description  full job body with line breaks preserved
//   .__ai-apply        recruiting-email apply path (kept as fallback next to formCapture)
// Runs on the listing page; re-run after "load more" (idempotent via the .__ai-loc guard).

function haideHash(s){var h=5381,i=s.length;while(i){h=(h*33)^s.charCodeAt(--i);}return (h>>>0).toString(36);}

// Canonical spellings taken from "CSV files/city.csv". The site writes
// "תל-אביב" (hyphen) and prefixes the HQ label, neither of which matches the file.
var LOC_ALIAS = {
  'תל-אביב': 'תל אביב-יפו',
  'תל אביב': 'תל אביב-יפו',
  'מטה החברה, תל-אביב': 'תל אביב-יפו',
  'מטה החברה + שטח (משולב)': 'תל אביב-יפו'
};

function cleanLocation(raw){
  var s = (raw || '').replace(/^\s*מיקום:\s*/, '').trim();
  if (LOC_ALIAS[s]) return LOC_ALIAS[s];
  if (s.indexOf(',') > -1) {                       // "מטה החברה, תל-אביב" -> keep the city segment
    var parts = s.split(',').map(function(p){ return p.trim(); }).filter(Boolean);
    var cities = parts.filter(function(p){ return !/^(מטה|משרדי|הנהלה)\b/.test(p); });
    if (cities.length) s = cities[cities.length - 1];
  }
  return LOC_ALIAS[s] || s;
}

function structuredText(el){
  if (!el) return '';
  var c = el.cloneNode(true);
  c.querySelectorAll('form,.c-form,dialog button,.c-box-career__content-close').forEach(function(e){ e.remove(); });
  c.querySelectorAll('p,div,ul,ol,li,br,h1,h2,h3,h4,h5,h6,tr').forEach(function(e){ e.insertAdjacentText('afterend', '\n'); });
  return c.textContent.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

for (const item of document.querySelectorAll('.c-box-career')) {
  if (item.querySelector('.__ai-loc')) continue;

  const locSpan = document.createElement('span');
  locSpan.className = '__ai-loc'; locSpan.style.display = 'none';
  locSpan.textContent = cleanLocation(item.querySelector('.c-box-career__location')?.textContent);
  item.appendChild(locSpan);

  // Hash the title alone: keeps the dedup key stable when a location string is corrected.
  const title = item.querySelector('.c-box-career__title')?.textContent?.trim() || '';
  const idSpan = document.createElement('span');
  idSpan.className = '__ai-eid'; idSpan.style.display = 'none';
  idSpan.textContent = 'h-' + haideHash(title.toLowerCase().replace(/\s+/g, ' ').trim());
  item.appendChild(idSpan);

  const descSpan = document.createElement('span');
  descSpan.className = '__ai-description'; descSpan.style.display = 'none';
  descSpan.textContent = structuredText(item.querySelector('.c-box-career__content-body'));
  item.appendChild(descSpan);

  // The per-job CF7 form is reCAPTCHA v3-gated, so the careers email stays as a usable fallback.
  const applySpan = document.createElement('span');
  applySpan.className = '__ai-apply'; applySpan.style.display = 'none';
  applySpan.textContent = 'mailto:cv@minrav.co.il';
  item.appendChild(applySpan);
}
