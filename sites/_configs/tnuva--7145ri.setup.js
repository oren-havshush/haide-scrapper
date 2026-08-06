// Tnuva jobs listing: scroll to load all cards, then enrich each card.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let prev = 0;
let noGrowth = 0;
for (let i = 0; i < 40 && noGrowth < 3; i++) {
  window.scrollTo(0, document.body.scrollHeight);
  await sleep(800);
  const n = document.querySelectorAll('.post-block.jobItem.card').length;
  if (n <= prev) noGrowth++;
  else noGrowth = 0;
  prev = n;
  if (prev >= 200) break;
}
window.scrollTo(0, 0);

const locFromTitle = (t) => {
  const m = (t || '').match(/\sב([\u0590-\u05FF][\u0590-\u05FF\s\-\"'״]*)\s*$/);
  return m ? m[1].trim() : '';
};

const mk = (cls, val) => {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = val;
  return s;
};

await Promise.all(
  [...document.querySelectorAll('.post-block.jobItem.card')].map(async (item) => {
    if (item.querySelector('.__ai-externalJobId')) return;
    const link = item.querySelector('.job-title');
    if (!link) return;
    const url = link.href || '';
    const slug = url.split('/').filter(Boolean).pop() || '';
    const decoded = decodeURIComponent(slug);
    const title = (link.textContent || '').trim();
    const cardLoc = (item.querySelector('.location')?.textContent || '').trim();
    const loc = locFromTitle(title) || cardLoc;
    if (loc) item.appendChild(mk('__ai-location', loc));

    try {
      const resp = await fetch(url);
      const html = await resp.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const jobId = doc.querySelector('.jobIdNum')?.textContent?.trim() || '';
      item.appendChild(mk('__ai-externalJobId', jobId || 'tnuva-' + decoded));
      const free = doc.querySelector('.job-content section.free-content');
      if (free) {
        const text = (free.innerText || free.textContent || '').trim();
        if (text) item.appendChild(mk('__ai-description', text));
      }
    } catch (e) {}
  }),
);
