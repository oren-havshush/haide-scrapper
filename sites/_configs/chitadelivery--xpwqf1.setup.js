for (const item of document.querySelectorAll('article.elementor-post')) {
  if (item.querySelector('.__ai-job-id')) continue;
  const m = item.className.match(/\bpost-(\d+)\b/);
  if (m) {
    const s = document.createElement('span');
    s.className = '__ai-job-id';
    s.textContent = 'wp-' + m[1];
    item.appendChild(s);
  }
}
