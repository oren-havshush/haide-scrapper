await Promise.all([...document.querySelectorAll('div.item.row')].map(async item => {
  if (item.querySelector('.__ai-externalJobId')) return;

  const link = item.querySelector('a.link-to-page');
  const href = link ? link.getAttribute('href') : '';
  const slug = href.replace(/[^\w\u0590-\u05FF-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/, '');
  
  const idSpan = document.createElement('span');
  idSpan.className = '__ai-externalJobId';
  idSpan.textContent = 'kz-' + slug;
  item.appendChild(idSpan);

  if (href) {
    const detailUrl = 'https://www.kley-zemer.co.il/' + href;
    const urlSpan = document.createElement('span');
    urlSpan.className = '__ai-detailUrl';
    urlSpan.textContent = detailUrl;
    item.appendChild(urlSpan);

    try {
      const resp = await fetch(detailUrl);
      const html = await resp.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Description from editor_text on detail page
      const descEl = doc.querySelector('.editor_text');
      if (descEl) {
        const text = descEl.textContent.trim();
        if (text) {
          const descSpan = document.createElement('span');
          descSpan.className = '__ai-description';
          descSpan.textContent = text;
          item.appendChild(descSpan);
        }
      }

      // Decode CF-obfuscated email from data-cfemail attribute
      const cfEl = doc.querySelector('[data-cfemail]');
      if (cfEl) {
        const encoded = cfEl.getAttribute('data-cfemail');
        const key = parseInt(encoded.slice(0, 2), 16);
        let email = '';
        for (let i = 2; i < encoded.length; i += 2) {
          email += String.fromCharCode(parseInt(encoded.slice(i, i + 2), 16) ^ key);
        }
        const appSpan = document.createElement('span');
        appSpan.className = '__ai-applicationInfo';
        appSpan.textContent = 'mailto:' + email;
        item.appendChild(appSpan);
      }
    } catch(e) {}
  }
}));
