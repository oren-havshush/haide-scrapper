await Promise.all([...document.querySelectorAll('section#section_optional_choice .col-6.mt-3')].map(async item => {
  if (item.querySelector('.__ai-externalJobId')) return;

  const link = item.querySelector('a.link');
  const href = link ? link.getAttribute('href') : '';
  // href format: GenericGrid/item/2219
  const idMatch = href.match(/item\/(\d+)/);
  const id = idMatch ? 'sfr-' + idMatch[1] : '';

  const idSpan = document.createElement('span');
  idSpan.className = '__ai-externalJobId';
  idSpan.textContent = id;
  item.appendChild(idSpan);

  if (href) {
    const detailUrl = 'https://www.safari.co.il/' + href;
    const urlSpan = document.createElement('span');
    urlSpan.className = '__ai-detailUrl';
    urlSpan.textContent = detailUrl;
    item.appendChild(urlSpan);

    try {
      const resp = await fetch(detailUrl);
      const html = await resp.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const descSection = doc.querySelector('section#page_content');
      if (descSection) {
        const text = descSection.textContent.trim();
        if (text) {
          const descSpan = document.createElement('span');
          descSpan.className = '__ai-description';
          descSpan.textContent = text;
          item.appendChild(descSpan);
        }
      }
    } catch(e) {}
  }

  // Email apply is same for all jobs
  const appSpan = document.createElement('span');
  appSpan.className = '__ai-applicationInfo';
  appSpan.textContent = 'mailto:safari@app.civi.co.il';
  item.appendChild(appSpan);
}));
