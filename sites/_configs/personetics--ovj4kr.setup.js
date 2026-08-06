await Promise.all([...document.querySelectorAll('div.career-listings > a.active')].map(async item => {
  if (item.querySelector('.__ai-externalJobId')) return;

  const href = item.getAttribute('href') || '';
  // href format: //personetics.com/us/careers-4/co/{location}/{uid}/{slug}/all
  const parts = href.split('/');
  const uid = parts[7] || '';

  const idSpan = document.createElement('span');
  idSpan.className = '__ai-externalJobId';
  idSpan.textContent = uid;
  item.appendChild(idSpan);

  const detailUrl = href.startsWith('//') ? 'https:' + href : href;
  const urlSpan = document.createElement('span');
  urlSpan.className = '__ai-detailUrl';
  urlSpan.textContent = detailUrl;
  item.appendChild(urlSpan);

  try {
    const resp = await fetch(detailUrl);
    const html = await resp.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    let text = '';
    doc.querySelectorAll('.comeet-position-info h4').forEach(h4 => {
      const next = h4.nextElementSibling;
      if (next && next.classList.contains('comeet-user-text')) {
        text += h4.textContent.trim() + '\n' + next.textContent.trim() + '\n\n';
      }
    });

    if (text.trim()) {
      const descSpan = document.createElement('span');
      descSpan.className = '__ai-description';
      descSpan.textContent = text.trim();
      item.appendChild(descSpan);
    }
  } catch(e) {}
}));
