// Pass 1: inject job IDs and detail URLs (synchronous, no network)
for (const item of document.querySelectorAll('div.flex-col.gap-6 > div.cursor-pointer')) {
  if (item.querySelector('.__ai-externalJobId')) continue;
  let numSpan = null;
  for (const s of item.querySelectorAll('span')) {
    if (s.textContent.includes('\u05de\u05e1\u05e4\u05e8')) { numSpan = s; break; }
  }
  if (!numSpan) continue;
  const m = numSpan.textContent.match(/(\d+)/);
  if (!m) continue;
  const jobId = 'fsb-' + m[1];
  const sp = document.createElement('span');
  sp.className = '__ai-externalJobId';
  sp.style.display = 'none';
  sp.textContent = jobId;
  item.appendChild(sp);
  const a = document.createElement('a');
  a.className = '__ai-detail-url';
  a.href = 'https://careers.freesbe.com/jobs/' + m[1];
  a.style.display = 'none';
  a.textContent = m[1];
  item.appendChild(a);
}

// Pass 2: fetch descriptions in parallel batches (top-level await is fine here)
const itemsNeedingDesc = Array.from(
  document.querySelectorAll('div.flex-col.gap-6 > div.cursor-pointer')
).filter(item => item.querySelector('.__ai-externalJobId') && !item.querySelector('.__ai-description'));

const BATCH = 10;
for (let i = 0; i < itemsNeedingDesc.length; i += BATCH) {
  await Promise.all(itemsNeedingDesc.slice(i, i + BATCH).map(async (item) => {
    const fullJobId = item.querySelector('.__ai-externalJobId').textContent.trim();
    const jobId = fullJobId.replace('fsb-', '');
    try {
      const resp = await fetch('https://careers.freesbe.com/jobs/' + jobId);
      const html = await resp.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const proseEl = doc.querySelector('div.prose.prose-gray');
      const desc = proseEl ? (proseEl.innerText || proseEl.textContent || '').trim() : '';
      const ds = document.createElement('span');
      ds.className = '__ai-description';
      ds.style.display = 'none';
      ds.textContent = desc;
      item.appendChild(ds);
    } catch(e) {
      const ds = document.createElement('span');
      ds.className = '__ai-description';
      ds.style.display = 'none';
      ds.textContent = '';
      item.appendChild(ds);
    }
  }));
}
