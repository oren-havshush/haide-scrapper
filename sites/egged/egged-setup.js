(async () => {
  try {
    if (document.getElementById('haide-egged-injected')) return;
    const apiUrl = 'https://apb.egged.co.il/api/career/allHeadquartersJobs';
    const listResp = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify({ searchTerm: '', filters: [], requestPage: 0, pageSize: 200 }),
    });
    if (!listResp.ok) throw new Error('list api ' + listResp.status);
    const listData = await listResp.json();
    const jobs = (listData && listData.body && listData.body.items) ? listData.body.items : [];
    if (!jobs.length) throw new Error('no jobs returned by API');

    async function pMapBatched(arr, mapper, batchSize) {
      const out = new Array(arr.length);
      for (let i = 0; i < arr.length; i += batchSize) {
        const slice = arr.slice(i, i + batchSize);
        const r = await Promise.all(slice.map((x, j) => mapper(x, i + j)));
        for (let k = 0; k < r.length; k++) out[i + k] = r[k];
      }
      return out;
    }
    const detailHtmls = await pMapBatched(jobs, async (j) => {
      try {
        const r = await fetch('/career/headquarters/' + j.jobId, { credentials: 'omit' });
        if (!r.ok) return '';
        return await r.text();
      } catch (e) { return ''; }
    }, 8);

    const container = document.createElement('div');
    container.id = 'haide-egged-injected';
    container.style.display = 'none';

    const parser = new DOMParser();
    function addChild(parent, tag, cls, text) {
      const e = document.createElement(tag);
      e.className = cls;
      e.textContent = text || '';
      parent.appendChild(e);
      return e;
    }
    // Find a section by its header text. The detail page layout is:
    //   <p>תיאור המשרה</p>
    //   <div>...body...</div>
    //   <p>דרישות התפקיד</p>
    //   <div>...body...</div>
    //   <p>מיומניות</p>
    //   <div>...body...</div>
    // We locate the <p>/<h*> whose trimmed text equals the header, then take its
    // nextElementSibling. Robust to section reordering / missing sections.
    function sectionByHeader(doc, headerText) {
      const candidates = doc.querySelectorAll('p, h2, h3, h4, h5');
      for (let k = 0; k < candidates.length; k++) {
        const el = candidates[k];
        const t = (el.textContent || '').trim();
        if (t === headerText) {
          const sib = el.nextElementSibling;
          if (sib) return (sib.textContent || '').trim();
        }
      }
      return '';
    }
    jobs.forEach((j, i) => {
      const html = detailHtmls[i] || '';
      let description = '', requirements = '', skills = '';
      if (html) {
        try {
          const doc = parser.parseFromString(html, 'text/html');
          description  = sectionByHeader(doc, 'תיאור המשרה');
          requirements = sectionByHeader(doc, 'דרישות התפקיד');
          skills       = sectionByHeader(doc, 'מיומניות');
          // Fallbacks if header text changed: use the legacy class.
          if (!description || !requirements) {
            const blocks = doc.querySelectorAll('.muirtl-1ght444-SingleJob-StyledDescription');
            if (!description && blocks.length >= 1) description = (blocks[0].textContent || '').trim();
            if (!requirements && blocks.length >= 2) requirements = (blocks[1].textContent || '').trim();
          }
          if (!description) {
            const wrapper = doc.querySelector('.muirtl-1gfy7g8-SingleJob-StyledTextContent');
            if (wrapper) description = (wrapper.textContent || '').trim();
          }
        } catch (e) {}
      }

      const row = document.createElement('div');
      row.className = 'haide-egged-job';
      addChild(row, 'span', 'haide-jobid',        String(j.jobId));
      addChild(row, 'h3',   'haide-title',        String(j.jobTitle || ''));
      addChild(row, 'span', 'haide-category',     String((j.categoryName || '').trim()));
      const a = addChild(row, 'a', 'haide-url',   'apply');
      a.setAttribute('href', 'https://www.egged.co.il/career/headquarters/' + j.jobId);
      addChild(row, 'div',  'haide-description',  description);
      addChild(row, 'div',  'haide-requirements', requirements);
      addChild(row, 'div',  'haide-skills',       skills);
      container.appendChild(row);
    });

    document.body.appendChild(container);
  } catch (e) {
    console.error('haide egged setup failed:', e);
  }
})();
