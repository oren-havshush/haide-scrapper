await (async () => {
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
    function structuredText(el) {
      if (!el) return '';
      var c = el.cloneNode(true);
      c.querySelectorAll('style, script, noscript, svg, iframe').forEach(function (n) { n.remove(); });
      c.querySelectorAll('br').forEach(function (n) { n.replaceWith('\n'); });
      c.querySelectorAll('li').forEach(function (li) {
        var t = (li.textContent || '').replace(/^\s+/, '');
        if (t && !/^[\u2022\u25CF\u25AA*-]/.test(t)) li.prepend('\u2022 ');
      });
      c.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, h5, h6, section, article, blockquote')
       .forEach(function (b) { b.append('\n'); });
      return (c.textContent || '')
        .replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n')
        .replace(/ \n/g, '\n').replace(/\n /g, '\n').trim();
    }

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
          if (sib) return structuredText(sib);
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
            if (!description && blocks.length >= 1) description = structuredText(blocks[0]);
            if (!requirements && blocks.length >= 2) requirements = structuredText(blocks[1]);
          }
          if (!description) {
            const wrapper = doc.querySelector('.muirtl-1gfy7g8-SingleJob-StyledTextContent');
            if (wrapper) description = structuredText(wrapper);
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

    // Fail-safe: detail fetches all failed -> render nothing so the scrape
    // reports empty_results and the worker returns before deleteMany.
    var withDesc = Array.prototype.slice.call(container.querySelectorAll('.haide-description'))
      .filter(function (d) { return (d.textContent || '').trim().length > 0; }).length;
    if (!withDesc) return;
    document.body.appendChild(container);
  } catch (e) {
    console.error('haide egged setup failed:', e);
  }
})();
