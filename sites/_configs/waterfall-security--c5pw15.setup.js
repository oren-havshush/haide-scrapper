await Promise.all([...document.querySelectorAll('ul.comeet-positions-list > li')].map(async item => {
  if (item.querySelector('.__ai-externalJobId')) return;

  const link = item.querySelector('a.comeet-position');
  const href = link ? link.getAttribute('href') : '';
  
  // Extract Comeet UID from href: /co/<region>/<UID>/
  const uidMatch = href.match(/\/co\/[^\/]+\/([A-Z0-9]+\.[A-Z0-9]+)\//i);
  const uid = uidMatch ? uidMatch[1] : '';
  
  const idSpan = document.createElement('span');
  idSpan.className = '__ai-externalJobId';
  idSpan.textContent = uid;
  item.appendChild(idSpan);

  // Extract location from href: /co/<region>/
  const regionMatch = href.match(/\/co\/([^\/]+)\//);
  const region = regionMatch ? regionMatch[1] : '';
  if (region) {
    const locSpan = document.createElement('span');
    locSpan.className = '__ai-location';
    locSpan.textContent = region.charAt(0).toUpperCase() + region.slice(1);
    item.appendChild(locSpan);
  }

  // Normalize detailUrl to https
  const detailUrl = 'https:' + href.replace(/^https?:/, '').replace(/\?.*$/, '') + '/';
  const urlSpan = document.createElement('span');
  urlSpan.className = '__ai-detailUrl';
  urlSpan.textContent = detailUrl;
  item.appendChild(urlSpan);

  // applicationInfo: Comeet apply URL
  const appSpan = document.createElement('span');
  appSpan.className = '__ai-applicationInfo';
  appSpan.textContent = 'https://www.comeet.co/jobs/C7.009/' + uid + '/apply';
  item.appendChild(appSpan);

  // Fetch description from detail page
  if (detailUrl && uid) {
    try {
      const resp = await fetch(detailUrl);
      const html = await resp.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const descEl = doc.querySelector('.comeet-position-description');
      if (descEl) {
        const text = descEl.textContent.replace(descEl.querySelector('h2')?.textContent || '', '').trim();
        if (text) {
          const descSpan = document.createElement('span');
          descSpan.className = '__ai-description';
          descSpan.textContent = text;
          item.appendChild(descSpan);
        }
      }
    } catch(e) {}
  }
}));
