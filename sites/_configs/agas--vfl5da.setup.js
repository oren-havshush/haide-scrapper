await Promise.all([...document.querySelectorAll('article.list-article')].map(async item => {
  if (item.querySelector('.__ai-externalJobId')) return;
  const articleId = item.getAttribute('id') || '';
  const postNum = articleId.replace('post-', '');
  const link = item.querySelector('.entry-title a, h2 a');
  if (!link) return;
  const detailUrl = link.href || '';

  const mk = (cls, val) => { const s = document.createElement('span'); s.className = cls; s.textContent = val; return s; };
  item.appendChild(mk('__ai-externalJobId', 'agas-' + (postNum || detailUrl.split('/').filter(Boolean).pop())));

  try {
    const resp = await fetch(detailUrl);
    const html = await resp.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const entryContent = doc.querySelector('.entry-content');
    if (entryContent) {
      const text = (entryContent.innerText || entryContent.textContent || '').trim();
      if (text) item.appendChild(mk('__ai-description', text));
    }
  } catch(e) {}
}));
