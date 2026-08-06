
  // Only run on the listing page
  const listingItems = document.querySelectorAll('div.jobsListItem');
  if (listingItems.length === 0) return;

  // haideHash (djb2) — short, ASCII-safe, stable id (same pattern as qasisrael)
  function haideHash(s){var h=5381,i=s.length;while(i){h=(h*33)^s.charCodeAt(--i);}return (h>>>0).toString(36);}

  // structuredText: collapse inline whitespace but preserve block line breaks
  function structuredText(node) {
    if (!node) return '';
    const clone = node.cloneNode(true);
    clone.querySelectorAll('style,script,link,meta').forEach(n => n.remove());
    clone.querySelectorAll('li').forEach(li => { li.prepend('\n'); });
    clone.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,ul,ol,br').forEach(n => {
      if (n.tagName === 'BR') n.replaceWith('\n'); else n.prepend('\n');
    });
    return (clone.textContent || '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n[ \t]*/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  for (const item of listingItems) {
    if (item.querySelector('.injected-job-id')) continue;

    const a = item.querySelector('h3 a');
    if (!a) continue;

    try {
      const url = new URL(a.href);
      const parts = url.pathname.replace(/\/+$/, '').split('/');
      const slug = parts[parts.length - 1]; // unique per-job URL segment

      const idSpan = document.createElement('span');
      idSpan.className = 'injected-job-id';
      idSpan.textContent = 'madanes-' + haideHash(slug); // short ASCII hash of the unique slug
      item.appendChild(idSpan);

      const urlSpan = document.createElement('span');
      urlSpan.className = 'injected-detail-url';
      urlSpan.textContent = a.href;
      item.appendChild(urlSpan);

      try {
        const resp = await fetch(a.href);
        const html = await resp.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const jobContent = doc.querySelector('.jobItemRight');
        if (!jobContent) continue;

        function mk(cls, val) {
          if (!val) return;
          const s = document.createElement('span');
          s.className = cls; s.textContent = val; item.appendChild(s);
        }

        // --- Typed meta block (.jobTags) ---
        const tags = jobContent.querySelector('.jobTags');
        const locText   = tags && tags.querySelector('.location') ? tags.querySelector('.location').textContent.trim() : '';
        const scopeText = tags && tags.querySelector('.scope')    ? tags.querySelector('.scope').textContent.trim()    : '';
        const typeText  = tags && tags.querySelector('.type')     ? tags.querySelector('.type').textContent.trim()     : '';
        mk('__ai-location', locText);
        mk('__ai-department', typeText); // "חטיבת פרט" = division

        // --- Build description + requirements from the FULL body ---
        // Walk ALL block descendants of jobItemRight in document order (NOT just
        // direct children — the markup nests differently across jobs). Everything
        // that is NOT the title, the jobTags block, the share/apply footer, or a
        // nested list is job content. The "דרישות" heading splits desc from reqs.
        const reqHeadingText = "דרישות";
        const descParts = [];
        const reqParts = [];
        let inReq = false;
        // employment type + hours go at the top of the description so nothing is lost
        if (scopeText) descParts.push(scopeText);

        const blocks = jobContent.querySelectorAll('h2,h3,h4,p,ul,ol');
        for (const el of blocks) {
          if (el.closest('.jobTags')) continue;           // typed meta → own fields
          if (el.parentElement && el.parentElement.closest('ul,ol')) continue; // nested list (avoid dup)
          const raw = (el.textContent || '').trim();
          if (!raw) continue;

          const isHeading = /^H[2-6]$/.test(el.tagName);
          if (isHeading && raw.indexOf(reqHeadingText) !== -1) {
            inReq = true;
            continue; // skip the "דרישות" label itself
          }

          const text = structuredText(el);
          if (!text) continue;
          if (inReq) reqParts.push(text);
          else descParts.push(text);
        }

        mk('__ai-description', descParts.join('\n').trim());
        mk('__ai-requirements', reqParts.join('\n').trim());
      } catch (fetchErr) {}
    } catch (e) {}
  }
