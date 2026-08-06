const content = document.querySelector('main.content');
if (!content || content.querySelector('.__ai-job-item')) return;
// Filter real job h2s (not the page title h1 or "Send to" h2)
const h2s = Array.from(content.querySelectorAll('h2')).filter(h2 => {
  const t = h2.innerText.trim();
  return t && !t.includes('jobs@alyn.org') && t.length > 3;
});
for (const h2 of h2s) {
  const title = h2.innerText.trim();
  if (!title) continue;
  const wrapper = document.createElement('div');
  wrapper.className = '__ai-job-item';
  // Hash title for externalJobId
  let hash = 0;
  for (let i = 0; i < title.length; i++) { hash = ((hash << 5) - hash) + title.charCodeAt(i); hash |= 0; }
  const idSpan = document.createElement('span');
  idSpan.className = '__ai-id';
  idSpan.textContent = 'h-' + Math.abs(hash).toString(16);
  // Collect description: all siblings until next h2 or end
  const descParts = [];
  let sib = h2.nextElementSibling;
  while (sib && sib.tagName !== 'H2') {
    const t = (sib.innerText || sib.textContent).trim();
    if (t && !t.match(/^-{5,}$/)) descParts.push(t);
    sib = sib.nextElementSibling;
  }
  const descSpan = document.createElement('span');
  descSpan.className = '__ai-desc';
  descSpan.textContent = descParts.join('\n');
  const emailSpan = document.createElement('span');
  emailSpan.className = '__ai-email';
  emailSpan.textContent = 'mailto:jobs@alyn.org';
  wrapper.appendChild(h2.cloneNode(true));
  wrapper.appendChild(idSpan);
  wrapper.appendChild(descSpan);
  wrapper.appendChild(emailSpan);
  content.appendChild(wrapper);
}
