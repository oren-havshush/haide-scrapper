const items = document.querySelectorAll('article.ee-post');
for (const item of items) {
  if (item.querySelector('.__ai-job-id')) continue;
  const m = item.className.match(/\bpost-(\d+)\b/);
  if (m) { const s = document.createElement('span'); s.className = '__ai-job-id'; s.textContent = m[1]; item.appendChild(s); }
  const e = document.createElement('span'); e.className = '__ai-applyemail'; e.textContent = 'mailto:drushim@tiecom.co.il'; item.appendChild(e);
}
// Fetch description from detail pages
await Promise.all(Array.from(items).map(async item => {
  if (item.querySelector('.__ai-description')) return;
  const link = item.querySelector('.ee-post__read-more a, .ee-post__body a');
  if (!link || !link.href) return;
  try {
    const resp = await fetch(link.href);
    const html = await resp.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    // Elementor-based page: job content is in the section containing h1
    const h1 = doc.querySelector('h1');
    const body = h1 ? h1.closest('section') : null;
    const text = body ? (body.innerText || body.textContent).trim() : '';
    if (text) {
      const d = document.createElement('span');
      d.className = '__ai-description';
      d.textContent = text.substring(0, 2000);
      item.appendChild(d);
    }
  } catch(e) {}
}))
