const items = Array.from(document.querySelectorAll('li.career-lobby-row'));

// Hardcoded location map for jobs with no region tag
const LOCATION_MAP = {
  'JB-804': 'עכו',
  'JB-845': 'עכו',
  'JB-846': 'קריות, עכו, חיפה, יוקנעם, נשר, טבעון, רמת ישאי, טירת הכרמל',
  'JB-767': 'עכו',
  'JB-768': 'עכו',
  'JB-877': 'עכו'
};

await Promise.all(items.map(async item => {
  if (item.querySelector('.__ai-description') && item.querySelector('.__ai-location')) return;

  const link = item.querySelector('a.career-lobby-row__link');
  if (!link || !link.href) return;

  // Determine location: (1) data-region attr, (2) hardcoded map, (3) detail page tags
  let loc = '';
  const region = decodeURIComponent(item.getAttribute('data-region') || '');
  if (region === 'דרום') loc = 'אשקלון';
  else if (region === 'צפון') loc = 'עכו';

  if (!loc) {
    const codeEl = item.querySelector('span.career-lobby-row__badge--code');
    const code = codeEl ? codeEl.textContent.trim() : '';
    if (LOCATION_MAP[code]) loc = LOCATION_MAP[code];
  }

  if (!item.querySelector('.__ai-location') && loc) {
    const s = document.createElement('span');
    s.className = '__ai-location';
    s.style.display = 'none';
    s.textContent = loc;
    item.appendChild(s);
  }

  const needDesc = !item.querySelector('.__ai-description');
  const needLoc = !item.querySelector('.__ai-location');
  if (!needDesc && !needLoc) return;

  try {
    const resp = await fetch(link.href);
    const html = await resp.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    if (needDesc) {
      const desc = doc.querySelector('.description.wysiwyg');
      const req = doc.querySelector('.paragraph-description.wysiwyg');
      const combined = [desc, req].filter(Boolean).map(el => el.innerText || el.textContent).join('\n\n');
      if (combined) {
        const d = document.createElement('span');
        d.className = '__ai-description';
        d.textContent = combined;
        item.appendChild(d);
      }
    }

    if (needLoc) {
      const tags = doc.querySelectorAll('span.career-tags__tag:not(.career-tags__tag--job-id)');
      for (const tag of tags) {
        const t = tag.textContent.trim();
        if (t === 'דרום') { loc = 'אשקלון'; break; }
        if (t === 'צפון') { loc = 'עכו'; break; }
      }
      if (loc) {
        const s = document.createElement('span');
        s.className = '__ai-location';
        s.style.display = 'none';
        s.textContent = loc;
        item.appendChild(s);
      }
    }
  } catch(e) {}
}));
