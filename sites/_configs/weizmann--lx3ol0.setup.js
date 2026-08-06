const rows = document.querySelectorAll('.views-row');
for (const row of rows) {
  if (row.querySelector('.__ai-id')) continue;
  const link = row.querySelector('a[href*="/career/jobs/"]');
  if (!link) continue;
  const jobId = link.href.match(/\/jobs\/(\d+)/)?.[1];
  if (jobId) {
    const s = document.createElement('span');
    s.className = '__ai-id';
    s.textContent = jobId;
    row.appendChild(s);
  }
  // Hardcode location — Weizmann is a single campus in Rehovot
  const loc = document.createElement('span');
  loc.className = '__ai-location';
  loc.textContent = 'רחובות';
  row.appendChild(loc);
  try {
    const resp = await fetch(link.href);
    const html = await resp.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const main = doc.querySelector('article, main .node__content, .node__content');
    if (main) {
      // Drop the "משרות נוספות" related-jobs block (Drupal "jobs by category"
      // view) so other openings don't bleed into this job's description.
      main.querySelectorAll('[class*="block-views-blockjobs-by-category"]').forEach(el => el.remove());
    }
    let bodyText = main ? (main.innerText || main.textContent).trim() : '';
    // Fallback: if the block survived, cut the text at the "משרות נוספות" marker.
    const moreIdx = bodyText.indexOf('משרות נוספות');
    if (moreIdx > 0) bodyText = bodyText.slice(0, moreIdx).trim();
    if (bodyText) {
      const d = document.createElement('span');
      d.className = '__ai-description';
      d.textContent = bodyText.substring(0, 3000);
      row.appendChild(d);
    }
    const applyLink = doc.querySelector('a[href*="job-application"]');
    if (applyLink) {
      const a = document.createElement('span');
      a.className = '__ai-apply';
      a.textContent = applyLink.href;
      row.appendChild(a);
    }
  } catch(e) {}
}
