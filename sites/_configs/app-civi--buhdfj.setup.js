const items = [...document.querySelectorAll('.proflist .thumb')];
const txt = (el) => el ? (el.innerText || el.textContent || '').trim() : '';
const mk = (cls, val) => { const s = document.createElement('span'); s.className = cls; s.textContent = val; return s; };
const applyFields = [
  {name:'Form_submitted',label:'',tagName:'INPUT',required:false,fieldType:'hidden'},
  {name:'name',label:'שם מלא',tagName:'INPUT',required:true,fieldType:'text'},
  {name:'phone',label:'טלפון',tagName:'INPUT',required:true,fieldType:'tel'},
  {name:'email',label:'דוא"ל',tagName:'INPUT',required:true,fieldType:'email'},
  {name:'cv',label:'קורות חיים',tagName:'INPUT',required:true,fieldType:'file'}
];
await Promise.all(items.map(async (item) => {
  if (item.querySelector('.__ai-jobid')) return;
  const tc = item.querySelector('.thumb-content');
  if (!tc) return;
  const m = (tc.getAttribute('onclick') || '').match(/openPromo\(event,(\d+),(\d+)/);
  if (!m) return;
  const jobId = m[1], srcId = m[2];
  const detailUrl = 'https://app.civi.co.il/promo/id=' + jobId + '&src=' + srcId;
  let title = txt(tc.querySelector('.title'));
  let descr = '', req = '';
  try {
    const r = await fetch(detailUrl);
    const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
    descr = txt(doc.querySelector('#je-descr'));
    req = txt(doc.querySelector('#je-details'));
    const t = txt(doc.querySelector('#je-title'));
    if (t) title = t;
  } catch (e) {}
  item.appendChild(mk('__ai-jobid', jobId));
  item.appendChild(mk('__ai-title', title));
  item.appendChild(mk('__ai-location', 'כפר סבא'));
  if (descr) item.appendChild(mk('__ai-description', descr));
  if (req) item.appendChild(mk('__ai-requirements', req));
  item.appendChild(mk('__ai-applicationInfo', JSON.stringify({actionUrl: detailUrl, method: 'POST', fields: applyFields})));
  const a = document.createElement('a');
  a.className = '__ai-detailurl';
  a.href = detailUrl;
  item.appendChild(a);
}));
