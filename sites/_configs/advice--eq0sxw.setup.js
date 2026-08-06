function haideHash(s){var h=5381,i=s.length;while(i){h=(h*33)^s.charCodeAt(--i);}return (h>>>0).toString(36);}
function buildAppInfo(iframeSrc){
  var actionUrl = iframeSrc.startsWith('http') ? iframeSrc : new URL(iframeSrc, 'https://cv.magicnet.co.il').href;
  return JSON.stringify({
    actionUrl: actionUrl,
    method: 'POST',
    enctype: 'multipart/form-data',
    fields: [
      { name: 'FileUpload1', label: 'קורות חיים', tagName: 'INPUT', required: true, fieldType: 'file' },
      { name: '__VIEWSTATE', label: '', tagName: 'INPUT', required: false, fieldType: 'hidden' },
      { name: '__VIEWSTATEGENERATOR', label: '', tagName: 'INPUT', required: false, fieldType: 'hidden' },
      { name: '__EVENTVALIDATION', label: '', tagName: 'INPUT', required: false, fieldType: 'hidden' }
    ]
  });
}
await Promise.all([...document.querySelectorAll('div.article-card-wrapper')].map(async item => {
  if (item.querySelector('.__ai-externalJobId')) return;
  const link = item.querySelector('a.article-card__title');
  if (!link) return;
  const href = link.getAttribute('href') || '';
  const slug = href.split('/').filter(Boolean).pop() || '';
  const title = (link.textContent || link.innerText || '').trim();
  const key = slug || title.toLowerCase().replace(/\s+/g, ' ').trim();
  const fullUrl = href.startsWith('http') ? href : (location.origin + href);

  const mk = (cls, val) => { const s = document.createElement('span'); s.className = cls; s.textContent = val; return s; };
  item.appendChild(mk('__ai-externalJobId', 'h-' + haideHash(key)));

  try {
    const resp = await fetch(fullUrl);
    const html = await resp.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const contentEl = doc.querySelector('.article-template__content');
    if (contentEl) {
      const text = (contentEl.innerText || contentEl.textContent || '').trim();
      if (text) item.appendChild(mk('__ai-description', text));
    }

    const iframe = doc.querySelector('iframe[src*="cv.magicnet.co.il"]');
    const iframeSrc = iframe ? (iframe.getAttribute('src') || '') : '';
    if (!iframeSrc) return;
    const appJson = buildAppInfo(iframeSrc);
    item.appendChild(mk('__ai-applicationInfo', appJson));
    item.appendChild(mk('__ai-formData', appJson));
  } catch(e) {}
}));
