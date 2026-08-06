[...document.querySelectorAll('div.row.job-box')].forEach(item => {
  if (item.querySelector('.__ai-externalJobId')) return;

  const titleEl = item.querySelector('.job-title');
  if (!titleEl) return;

  // Clean title: remove the + span and trim
  const beforeSpan = titleEl.querySelector('.job-title-before');
  const rawTitle = titleEl.textContent || '';
  const cleanTitle = rawTitle.replace(beforeSpan ? beforeSpan.textContent : '+', '').trim();

  const titleSpan = document.createElement('span');
  titleSpan.className = '__ai-title';
  titleSpan.textContent = cleanTitle;
  item.appendChild(titleSpan);

  // Extract JB-XX id from title
  const idMatch = cleanTitle.match(/JB-\d+/);
  const jobId = idMatch ? idMatch[0] : '';

  const idSpan = document.createElement('span');
  idSpan.className = '__ai-externalJobId';
  idSpan.textContent = jobId;
  item.appendChild(idSpan);
});
