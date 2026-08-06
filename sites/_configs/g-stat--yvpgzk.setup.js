
for (const jobData of document.querySelectorAll('.job-data')) {
  if (jobData.querySelector('.__ai-jobid')) continue;
  const jobTitleEl = jobData.previousElementSibling;
  const titleText = (jobTitleEl && jobTitleEl.classList.contains('job-title'))
    ? jobTitleEl.textContent.trim()
    : '';

  // externalJobId: the printed JB-#### code in the title (preferred — what the
  // company actually uses), falling back to the hidden job-number input value.
  let jobCode = '';
  const codeMatch = titleText.match(/\(?\s*(JB-\d+)\s*\)?/i);
  if (codeMatch) jobCode = codeMatch[1].toUpperCase();
  if (!jobCode) {
    const numInput = jobData.querySelector('input[name="job-number"]');
    if (numInput && numInput.value) jobCode = numInput.value.trim().toUpperCase();
  }

  // Clean title: drop the trailing " - (JB-####)" so the displayed title is tidy.
  const cleanTitle = titleText.replace(/\s*[-\u2013]\s*\(?\s*JB-\d+\s*\)?\s*$/i, '').trim();

  // detailUrl from the LinkedIn share anchor's url param.
  let detailUrl = '';
  const li = jobData.querySelector('a.linkedin.customer.share');
  if (li) { try { detailUrl = new URL(li.href).searchParams.get('url') || ''; } catch (e) {} }

  const mk = (cls, val) => {
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = val;
    s.style.display = 'none';
    return s;
  };
  if (cleanTitle) jobData.appendChild(mk('__ai-title', cleanTitle));
  if (jobCode) jobData.appendChild(mk('__ai-jobid', jobCode));
  if (detailUrl) {
    const a = document.createElement('a');
    a.className = '__ai-detailurl';
    a.href = detailUrl;
    a.style.display = 'none';
    jobData.appendChild(a);
  }
}
