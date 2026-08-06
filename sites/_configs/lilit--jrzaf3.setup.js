for (const item of document.querySelectorAll('li.job')) {
  if (item.querySelector('.__ai-externalJobId')) continue;
  const form = item.querySelector('[data-form-id]');
  const formId = form ? form.getAttribute('data-form-id') : '';
  const span1 = document.createElement('span');
  span1.className = '__ai-externalJobId';
  span1.style.display = 'none';
  span1.textContent = formId || ('h-' + Math.abs(Array.from((item.querySelector('div.title span') || {}).textContent || '').reduce((h,c)=>Math.imul(31,h)+c.charCodeAt(0)|0,0)).toString(16));
  item.appendChild(span1);
  const city = item.getAttribute('data-city') || '';
  const span2 = document.createElement('span');
  span2.className = '__ai-location';
  span2.style.display = 'none';
  span2.textContent = city;
  item.appendChild(span2);
  const titleEl = item.querySelector('div[data-role="trigger"] > span:first-child');
  const span3 = document.createElement('span');
  span3.className = '__ai-title';
  span3.style.display = 'none';
  span3.textContent = titleEl ? titleEl.textContent.trim() : '';
  item.appendChild(span3);
}
