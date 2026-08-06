for (const item of document.querySelectorAll('.card')) {
  if (item.querySelector('.__ai-externalJobId')) continue;
  const header = item.querySelector('.card-header');
  const headingId = header ? header.id : '';
  const span = document.createElement('span');
  span.className = '__ai-externalJobId';
  span.textContent = 'ksh-' + headingId;
  item.appendChild(span);
}
