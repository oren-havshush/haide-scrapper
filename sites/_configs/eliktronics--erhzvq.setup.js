const items = document.querySelectorAll('article.iconbox');
for (const item of items) {
  if (item.querySelector('.__ai-id')) continue;
  const title = item.querySelector('h3')?.innerText?.trim() || '';
  if (!title) continue;
  let hash = 0;
  for (let i = 0; i < title.length; i++) { hash = ((hash << 5) - hash) + title.charCodeAt(i); hash |= 0; }
  const idSpan = document.createElement('span');
  idSpan.className = '__ai-id';
  idSpan.textContent = 'h-' + Math.abs(hash).toString(16);
  item.appendChild(idSpan);
  // Location appears in description text: ברחובות
  const locSpan = document.createElement('span');
  locSpan.className = '__ai-location';
  locSpan.textContent = 'רחובות';
  item.appendChild(locSpan);
}
