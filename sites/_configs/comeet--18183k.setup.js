function structuredText(el){
  if(!el) return '';
  const c = el.cloneNode(true);
  c.querySelectorAll('style,script,link,meta').forEach(n=>n.remove());
  c.querySelectorAll('p,div,ul,ol,li,br,h1,h2,h3,h4,h5,h6,tr').forEach(e=>e.insertAdjacentText('afterend','\n'));
  return c.textContent.replace(/[ \t]+/g,' ').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
// LISTING page: inject a clean, stable externalJobId (Comeet position UID) per item.
for (const a of document.querySelectorAll('a.positionItem')) {
  const li = a.closest('li');
  if (!li || li.querySelector('.__ai-jobid')) continue;
  const href = a.getAttribute('href') || '';
  const clean = href.split(/[?#]/)[0].replace(/\/+$/, '');
  const seg = clean.split('/').filter(Boolean).pop() || href;
  const span = document.createElement('span');
  span.className = '__ai-jobid'; span.style.display = 'none';
  span.textContent = seg;
  li.appendChild(span);
}
// LISTING page: clean location. Comeet shows the employer name "מנועי בית שמש"
// (Bet Shemesh Engines) as the location; strip the "מנועי" company prefix so the
// stored location is the city "בית שמש".
for (const a of document.querySelectorAll('a.positionItem')) {
  const li = a.closest('li');
  if (!li || li.querySelector('.__ai-location')) continue;
  const marker = a.querySelector('.positionDetails li .fa-map-marker');
  const locLi = marker ? marker.closest('li') : a.querySelector('.positionDetails li');
  let loc = locLi ? locLi.textContent.trim() : '';
  loc = loc.replace(/^מנועי\s+/, '').trim();
  if (!loc) continue;
  const s = document.createElement('span');
  s.className = '__ai-location'; s.style.display = 'none';
  s.textContent = loc;
  li.appendChild(s);
}
// LISTING page: inject department from the group heading preceding each item.
{
  const nodes = [...document.querySelectorAll('.positionsGroupTitle, a.positionItem')];
  let curDept = '';
  for (const n of nodes) {
    if (n.classList.contains('positionsGroupTitle')) { curDept = n.textContent.trim(); continue; }
    const li = n.closest('li');
    if (!li || !curDept || li.querySelector('.__ai-department')) continue;
    const s = document.createElement('span');
    s.className = '__ai-department'; s.style.display = 'none';
    s.textContent = curDept;
    li.appendChild(s);
  }
}
// DETAIL page: merge the labeled Description + Requirements blocks into one
// description, preserving line breaks (data-qa is Comeet/Spark Hire specific).
if (!document.querySelector('.__ai-description')) {
  const secs = document.querySelectorAll('[data-qa="requirementFieldContent"]');
  if (secs.length) {
    const parts = [];
    for (const sec of secs) {
      const head = sec.parentElement && sec.parentElement.querySelector('[data-qa="requirementFieldTitle"], h3');
      const label = head ? head.textContent.trim() : '';
      const body = structuredText(sec);
      if (!body) continue;
      parts.push((/description/i.test(label) || !label) ? body : (label + ':\n' + body));
    }
    if (parts.length) {
      const d = document.createElement('div');
      d.className = '__ai-description'; d.style.display = 'none';
      d.textContent = parts.join('\n\n');
      document.body.appendChild(d);
    }
  }
}
