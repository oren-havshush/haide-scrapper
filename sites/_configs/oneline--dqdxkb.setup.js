
Array.from(document.querySelectorAll('details.job-item')).forEach(item => {
  if (item.querySelector('.__ai-jobid')) return;
  const wpId = item.querySelector('input[name="target_job_id"]')?.value;
  const jobId = wpId ? 'ol-' + wpId : null;
  if (!jobId) return;
  const textDiv = item.querySelector('.job-details-text');
  const pEls = textDiv ? Array.from(textDiv.querySelectorAll('p')) : [];
  const descText = pEls.slice(1).map(p => p.textContent.replace(/\s+/g, ' ').trim()).filter(t => t.length > 5).join('\n\n');
  const idSpan = document.createElement('span');
  idSpan.className = '__ai-jobid';
  idSpan.textContent = jobId;
  item.appendChild(idSpan);
  if (descText) {
    const descSpan = document.createElement('span');
    descSpan.className = '__ai-description';
    descSpan.textContent = descText;
    item.appendChild(descSpan);
  }
});
