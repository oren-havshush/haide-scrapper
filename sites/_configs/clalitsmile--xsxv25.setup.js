
  const mk = (cls, val) => {
    if (!val) return null;
    const s = document.createElement('span');
    s.className = cls;
    s.style.display = 'none';
    s.textContent = val;
    return s;
  };
  function structuredText(node){
    if (!node) return '';
    const c = node.cloneNode(true);
    c.querySelectorAll('style,script,link,meta').forEach(n => n.remove());
    c.querySelectorAll('p,div,ul,ol,li,br,h1,h2,h3,h4,h5,h6,tr')
      .forEach(e => e.insertAdjacentText('afterend', '\n'));
    return c.textContent
      .replace(/[ \t]+/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  document.querySelectorAll('a.single_job_row').forEach(a => {
    if (a.querySelector('.injected-job-id')) return;
    try {
      const url = new URL(a.href);
      const jobId = url.searchParams.get('jobID');
      if (jobId) a.appendChild(mk('injected-job-id', 'slh-' + jobId));
      a.appendChild(mk('injected-detail-url', a.href));
    } catch(e) {}
  });

  const items = Array.from(document.querySelectorAll('a.single_job_row'));
  for (const item of items) {
    if (item.querySelector('.__ai-description')) continue;
    const href = item.href;
    if (!href) continue;
    try {
      const html = await fetch(href).then(r => r.text());
      const doc = new DOMParser().parseFromString(html, 'text/html');

      const locEl = doc.querySelector('.order_location');
      if (locEl) {
        const city = locEl.textContent.trim().replace(/^מיקום:?\s*/u, '').trim();
        if (city) item.appendChild(mk('__ai-location', city));
      }

      const body = structuredText(doc.querySelector('.job_desc'));
      if (body) {
        const reqHeadingRe = /(מה נדרש כדי לעבוד איתנו|דרישות התפקיד|דרישות המשרה|דרישות:)/u;
        const m = body.match(reqHeadingRe);
        if (m && m.index > 0) {
          const desc = body.slice(0, m.index).trim();
          const req  = body.slice(m.index).trim();
          item.appendChild(mk('__ai-description', desc || body));
          if (req) item.appendChild(mk('__ai-requirements', req));
        } else {
          item.appendChild(mk('__ai-description', body));
        }
      }
    } catch(e) {}
  }
