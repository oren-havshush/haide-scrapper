// safari.co.il — ids, detail URLs, descriptions and the apply email per card.
//
// 2026-09-30: a card whose a.link has no href made getAttribute return null,
// null.match threw inside Promise.all, the whole script rejected, and only the
// detail fetches already finished wrote a description (5 of 9). Now a card with
// no href is skipped, fetches run one at a time (the worker spaces them further
// when the site has browserOverrides.requestDelayMs), and a failed fetch is
// logged instead of swallowed.
const cards = [...document.querySelectorAll('section#section_optional_choice .col-6.mt-3')];
for (const item of cards) {
  if (item.querySelector('.__ai-externalJobId')) continue;

  const link = item.querySelector('a.link');
  const href = (link && link.getAttribute('href')) || '';
  if (!href) continue; // an empty card: no job to describe

  // href format: GenericGrid/item/2219
  const idMatch = href.match(/item\/(\d+)/);
  const id = idMatch ? 'sfr-' + idMatch[1] : '';

  const idSpan = document.createElement('span');
  idSpan.className = '__ai-externalJobId';
  idSpan.textContent = id;
  item.appendChild(idSpan);

  const detailUrl = 'https://www.safari.co.il/' + href;
  const urlSpan = document.createElement('span');
  urlSpan.className = '__ai-detailUrl';
  urlSpan.textContent = detailUrl;
  item.appendChild(urlSpan);

  try {
    const resp = await fetch(detailUrl);
    if (!resp.ok) {
      console.warn('safari: detail ' + resp.status + ' ' + detailUrl);
    } else {
      const html = await resp.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const descSection = doc.querySelector('section#page_content');
      const text = descSection ? descSection.textContent.trim() : '';
      if (text) {
        const descSpan = document.createElement('span');
        descSpan.className = '__ai-description';
        descSpan.textContent = text;
        item.appendChild(descSpan);
      } else {
        console.warn('safari: no section#page_content text on ' + detailUrl);
      }
    }
  } catch (e) {
    console.warn('safari: detail fetch failed ' + detailUrl + ' ' + (e && e.message));
  }

  // Email apply is the same for all jobs
  const appSpan = document.createElement('span');
  appSpan.className = '__ai-applicationInfo';
  appSpan.textContent = 'mailto:safari@app.civi.co.il';
  item.appendChild(appSpan);
}
