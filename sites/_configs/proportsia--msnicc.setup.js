
function structuredText(el) {
  if (!el) return '';
  const c = el.cloneNode(true);
  c.querySelectorAll('style,script,link,meta,svg').forEach(n => n.remove());
  c.querySelectorAll('p,div,ul,ol,li,br,h1,h2,h3,h4,h5,h6,tr').forEach(e => e.insertAdjacentText('afterend', '\n'));
  return c.textContent.replace(/[ \t]+/g,' ').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
function mk(item, cls, val) {
  if (!val || item.querySelector('.' + cls)) return;
  const s = document.createElement('span');
  s.className = cls;
  s.style.display = 'none';
  s.textContent = val;
  item.appendChild(s);
}
for (const item of document.querySelectorAll('div.jet-listing-grid__item')) {
  const dynFields = item.querySelectorAll('.jet-listing-dynamic-field__content');
  const jobNumText = dynFields[0]?.textContent?.trim() || '';
  const numMatch = jobNumText.match(/(\d+)/);
  mk(item, '__ai-job-id', numMatch ? 'prop-' + numMatch[1] : null);
  const loc = dynFields[1]?.textContent?.trim() || '';
  mk(item, '__ai-location', loc || null);
  const link = item.querySelector('a');
  mk(item, '__ai-detail-url', link?.href || null);
}
for (const item of document.querySelectorAll('div.jet-listing-grid__item')) {
  if (item.querySelector('.__ai-description')) continue;
  const href = item.querySelector('.__ai-detail-url')?.textContent?.trim() || item.querySelector('a')?.href;
  if (!href) continue;
  try {
    const html = await fetch(href).then(r => r.text());
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const h2s = [...doc.querySelectorAll('h2.elementor-heading-title')];
    const descH = h2s.find(h => (h.textContent||'').includes('\u05ea\u05d9\u05d0\u05d5\u05e8'));
    const reqH = h2s.find(h => (h.textContent||'').includes('\u05d3\u05e8\u05d9\u05e9\u05d5\u05ea'));
    const descWidget = descH?.closest('.elementor-widget');
    const reqWidget = reqH?.closest('.elementor-widget');
    const descText = descWidget?.nextElementSibling ? structuredText(descWidget.nextElementSibling) : '';
    const reqSib = reqWidget?.nextElementSibling;
    const reqText = (reqSib && !reqSib.querySelector('a')) ? structuredText(reqSib) : '';
    mk(item, '__ai-description', descText || null);
    mk(item, '__ai-requirements', reqText || null);
    const applyInfo = JSON.stringify({
      actionUrl: href,
      method: 'POST',
      fields: [
        { name: 'post_id', label: 'post id', fieldType: 'hidden', required: false, tagName: 'input' },
        { name: 'form_id', label: 'form id', fieldType: 'hidden', required: false, tagName: 'input' },
        { name: 'referer_title', label: 'referer title', fieldType: 'hidden', required: false, tagName: 'input' },
        { name: 'queried_id', label: 'queried id', fieldType: 'hidden', required: false, tagName: 'input' },
        { name: 'form_fields[name]', label: '\u05e9\u05dd \u05de\u05dc\u05d0', fieldType: 'text', required: true, tagName: 'input' },
        { name: 'form_fields[field_15a24ef]', label: '\u05d8\u05dc\u05e4\u05d5\u05df', fieldType: 'tel', required: true, tagName: 'input' },
        { name: 'form_fields[email]', label: '\u05d0\u05d9\u05de\u05d9\u05d9\u05dc', fieldType: 'email', required: false, tagName: 'input' },
        { name: 'form_fields[field_52e2f25]', label: '\u05d4\u05e2\u05dc\u05d5 \u05e7\u05d5\u05d1\u05e5 \u05e7\u05d5\u05e8\u05d5\u05ea \u05d7\u05d9\u05d9\u05dd', fieldType: 'file', required: false, tagName: 'input' }
      ]
    });
    mk(item, '__ai-apply-info', applyInfo);
  } catch(e) { /* skip */ }
}
