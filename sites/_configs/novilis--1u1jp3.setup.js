const items = document.querySelectorAll('.wixui-column-strip__column:has(h2):not(:has(section))');
for (const item of items) {
  if (item.querySelector('.__ai-id')) continue;
  const title = item.querySelector('h2')?.innerText?.trim() || '';
  if (!title) continue;
  let hash = 0;
  for (let i = 0; i < title.length; i++) { hash = ((hash << 5) - hash) + title.charCodeAt(i); hash |= 0; }
  const id = document.createElement('span');
  id.className = '__ai-id';
  id.textContent = 'h-' + Math.abs(hash).toString(16);
  item.appendChild(id);
  const richTexts = item.querySelectorAll('.wixui-rich-text');
  const descEl = richTexts.length >= 2 ? richTexts[richTexts.length - 1] : richTexts[0];
  if (descEl && !item.querySelector('.__ai-desc')) {
    const d = document.createElement('span');
    d.className = '__ai-desc';
    d.textContent = descEl.innerText?.trim() || '';
    item.appendChild(d);
  }
}
