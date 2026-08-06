const items = document.querySelectorAll('.proflist .thumb');
for (const item of items) {
  if (item.querySelector('.__ai-jobid')) continue;
  const tc = item.querySelector('.thumb-content');
  if (!tc) continue;
  const onclick = tc.getAttribute('onclick') || '';
  const m = onclick.match(/openPromo\(event,(\d+),(\d+)/);
  if (!m) continue;
  const jobId = m[1];
  const srcId = m[2];
  const mk = (cls, val) => { const s = document.createElement('span'); s.className = cls; s.textContent = val; return s; };
  item.appendChild(mk('__ai-jobid', jobId));
  item.appendChild(mk('__ai-location', 'שוהם'));
  const a = document.createElement('a');
  a.className = '__ai-detailurl';
  a.href = 'https://app.civi.co.il/promo/id=' + jobId + '&src=' + srcId;
  item.appendChild(a);
}
