for (const item of document.querySelectorAll('details.e-n-accordion-item')) {
  if (item.querySelector('.__ai-externalJobId')) continue;
  const id = item.id || '';
  const span = document.createElement('span');
  span.className = '__ai-externalJobId';
  span.textContent = 'poly-' + id;
  item.appendChild(span);
}
