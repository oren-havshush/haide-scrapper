for (const item of document.querySelectorAll('div.question')) {
  if (item.querySelector('.__ai-externalJobId')) continue;
  const titleEl = item.querySelector('div.title');
  if (!titleEl) continue;
  const title = titleEl.textContent.trim();
  let hash = 0;
  for (let i = 0; i < title.length; i++) hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  const sp = document.createElement('span');
  sp.className = '__ai-externalJobId';
  sp.style.display = 'none';
  sp.textContent = 'msf-' + hash.toString(36);
  item.appendChild(sp);
}
