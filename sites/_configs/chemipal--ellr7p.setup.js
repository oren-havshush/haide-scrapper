
const sections = Array.from(document.querySelectorAll('section.elementor-top-section'));
sections.forEach(section => {
  if (section.querySelector('.__ai-job-item')) return;
  const h3 = section.querySelector('h3.elementor-heading-title');
  if (!h3) return;
  const title = h3.textContent.trim();
  if (!title || title.includes('?') || title.length < 5) return;

  // Clone section to safely extract text without links
  const clone = section.cloneNode(true);
  clone.querySelectorAll('a, nav, .elementor-widget-nav-menu').forEach(el => el.remove());
  const h3Clone = clone.querySelector('h3.elementor-heading-title');
  if (h3Clone) h3Clone.remove();
  let desc = clone.innerText.trim().replace(/\n{3,}/g, '\n\n').trim();
  if (!desc || desc.length < 20) return;

  const jbMatch = title.match(/JB-\d+/);
  const jobId = jbMatch ? jbMatch[0] : 'cp-' + Array.from(title).reduce((h, c) => (((h << 5) - h) + c.charCodeAt(0)) | 0, 0).toString(16).replace('-','n');

  const emailLink = section.querySelector('a[href^="mailto:"]');
  const applyEmail = emailLink ? emailLink.href.replace('mailto:', '') : 'Liad@chemipal.co.il';

  const item = document.createElement('div');
  item.className = '__ai-job-item';
  item.innerHTML = '<span class="__ai-title">' + title.replace(/</g,'&lt;') + '</span>' +
    '<span class="__ai-description">' + desc.replace(/</g,'&lt;') + '</span>' +
    '<span class="__ai-jobid">' + jobId + '</span>' +
    '<span class="__ai-apply">' + applyEmail + '</span>';
  section.appendChild(item);
});
