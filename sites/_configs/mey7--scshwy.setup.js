const items = document.querySelectorAll('div.job-item');
for (const item of items) {
  if (item.querySelector('.__ai-externalJobId')) continue;

  // externalJobId from TenderPageId hidden input
  const tid = item.querySelector('input[name="TenderPageId"]');
  if (tid && tid.value) {
    const s = document.createElement('span');
    s.className = '__ai-externalJobId';
    s.textContent = 'mey7-' + tid.value;
    item.appendChild(s);
  }

  // Location (single office: Beer Sheva)
  if (!item.querySelector('.__ai-location')) {
    const loc = document.createElement('span');
    loc.className = '__ai-location';
    loc.textContent = 'באר שבע';
    item.appendChild(loc);
  }

  // Full description: short summary + full requirements block
  if (!item.querySelector('.__ai-description')) {
    const summary = item.querySelector('.job-item__text');
    const reqBlock = item.querySelector('.requirements-block');
    let text = '';
    if (summary) text += summary.innerText.trim();
    if (reqBlock) text += '\n\n' + reqBlock.innerText.trim();
    if (text) {
      const d = document.createElement('span');
      d.className = '__ai-description';
      d.textContent = text.substring(0, 3000);
      item.appendChild(d);
    }
  }

  // Application deadline from <time> element inside the button
  if (!item.querySelector('.__ai-deadline')) {
    const timeEl = item.querySelector('button.job-button time[datetime]');
    if (timeEl) {
      const dt = timeEl.getAttribute('datetime');
      const dl = document.createElement('span');
      dl.className = '__ai-deadline';
      dl.textContent = dt;
      item.appendChild(dl);
    }
  }
}
