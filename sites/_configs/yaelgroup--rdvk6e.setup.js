document.querySelectorAll('.job_item').forEach(item => {
  const content = item.querySelector('.job_content');
  if (content) content.style.display = 'block';
  if (!item.querySelector('.__ai-id')) {
    const fbLink = item.querySelector('.facebook_link');
    if (fbLink) {
      const match = fbLink.href.match(/order%2F(\d+)/);
      if (match) {
        const s = document.createElement('span');
        s.className = '__ai-id'; s.style.display = 'none';
        s.textContent = match[1];
        item.appendChild(s);
        const du = document.createElement('span');
        du.className = '__ai-detailurl'; du.style.display = 'none';
        du.textContent = 'https://yaelgroup.com/jobs/order/' + match[1] + '/';
        item.appendChild(du);
      }
    }
  }
  if (!item.querySelector('.__ai-location')) {
    const info = item.querySelector('.more_info');
    if (info) {
      const spans = Array.from(info.querySelectorAll('span'));
      const grab = (labels) => {
        for (const label of labels) {
          const lc = label.toLowerCase();
          const sp = spans.find(s => (s.textContent || '').trim().toLowerCase().indexOf(lc) === 0);
          if (!sp) continue;
          return (sp.textContent || '').trim().slice(label.length).replace(/^\s*[:\uFF1A]\s*/, '').trim();
        }
        return '';
      };
      const mk = (cls, val) => {
        if (!val) return;
        const el = document.createElement('span');
        el.className = cls; el.style.display = 'none'; el.textContent = val;
        item.appendChild(el);
      };
      let loc = grab(['\u05DE\u05D9\u05E7\u05D5\u05DD', 'Location']);
      if (!loc) loc = grab(['\u05D0\u05D6\u05D5\u05E8', 'Area']);
      if (loc) loc = loc.replace(/\s*\/\s*/g, ' ').trim();
      mk('__ai-location', loc);
      mk('__ai-department', grab(['\u05EA\u05D7\u05D5\u05DD', 'Domain']));
      mk('__ai-publishdate', grab(['\u05EA\u05D0\u05E8\u05D9\u05DA \u05E4\u05E8\u05E1\u05D5\u05DD', 'Date published']));
    }
  }
  if (!item.querySelector('.__ai-requirements')) {
    const desc = item.querySelector('.job_description');
    if (desc) {
      const structuredText = (node) => {
        if (!node) return '';
        const c = node.cloneNode(true);
        c.querySelectorAll('p,div,ul,ol,li,br,h1,h2,h3,h4,h5,h6,tr').forEach(e => e.insertAdjacentText('afterend', '\n'));
        return c.textContent.replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
      };
      const blocks = Array.from(desc.querySelectorAll('p,h1,h2,h3,h4,h5,h6,ul,ol'));
      const reqEls = [];
      let inReq = false;
      for (const el of blocks) {
        const t = (el.textContent || '').trim();
        if (!inReq) {
          if (t.length < 60 && /\u05D3\u05E8\u05D9\u05E9\u05D5\u05EA/.test(t)) inReq = true;
          continue;
        }
        if (el.closest('ul,ol') && el.tagName === 'LI') continue;
        reqEls.push(el);
      }
      if (reqEls.length) {
        const wrap = document.createElement('div');
        reqEls.forEach(e => wrap.appendChild(e.cloneNode(true)));
        const span = document.createElement('span');
        span.className = '__ai-requirements'; span.style.display = 'none';
        span.textContent = structuredText(wrap);
        item.appendChild(span);
      }
    }
  }
});
