// Inject externalJobId as hash of title for each accordion item
for (const item of document.querySelectorAll('div.elementor-accordion-item')) {
  if (item.querySelector('.__ai-externalJobId')) continue;
  const titleEl = item.querySelector('a.elementor-accordion-title');
  if (!titleEl) continue;
  const title = titleEl.textContent.trim();
  // Simple hash: sum of char codes, base36
  let hash = 0;
  for (let i = 0; i < title.length; i++) hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  const jobId = 'gck-' + hash.toString(36);
  const sp = document.createElement('span');
  sp.className = '__ai-externalJobId';
  sp.style.display = 'none';
  sp.textContent = jobId;
  item.appendChild(sp);
}
