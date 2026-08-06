
// ===== LISTING PAGE: item-scoped fields (id / location / department) =====
Array.from(document.querySelectorAll('li')).forEach(item => {
  if (!item.querySelector('.jobDetails')) return;
  if (item.closest('.jobPosition')) return; // never the detail-page meta block

  const btn = item.querySelector('.btnCV');
  const pos = btn ? btn.getAttribute('data-position') : null;
  const jobId = pos ? ('cal-' + pos) : null;

  const locDiv = item.querySelector('[id^="jobDetails"]');
  let loc = '';
  let department = '';
  if (locDiv) {
    const lines = (locDiv.innerText || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
    if (lines.length) loc = lines[0];
    const depLine = lines.find(l => l.includes(':'));
    if (depLine) department = depLine.split(':').slice(1).join(':').trim();
  }

  const upsert = (cls, value) => {
    if (!value) return;
    let el = item.querySelector('.' + cls);
    if (!el) { el = document.createElement('span'); el.className = cls; el.style.display = 'none'; item.appendChild(el); }
    el.textContent = value;
  };
  upsert('__ai-jobid', jobId);
  upsert('__ai-location', loc);
  upsert('__ai-department', department);
});

// ===== DETAIL PAGE: full description + requirements section + real publish date =====
const jobPos = document.querySelector('.jobPosition');
if (jobPos && !document.querySelector('.__ai-description')) {
  const structuredText = (el) => {
    if (!el) return '';
    const c = el.cloneNode(true);
    c.querySelectorAll('style,meta,script,link').forEach(n => n.remove());
    c.querySelectorAll('br').forEach(n => n.replaceWith('\n'));
    c.querySelectorAll('p,div,li,tr,ul,ol,h1,h2,h3,h4,h5,h6').forEach(b => b.append('\n'));
    return (c.textContent || '')
      .replace(/[^\S\n]+/g, ' ')        // collapse spaces/tabs (keep newlines)
      .replace(/[ \t]*\n[ \t]*/g, '\n') // strip whitespace around each newline
      .replace(/\n{3,}/g, '\n\n')       // at most one blank line between blocks
      .trim();
  };

  // Distinctive requirement-style bullet markers (check/star emoji format).
  // Plain bullets (\u2022 = •, \u25CF = ●) are excluded — Calanit uses them
  // for ALL content sections, not just requirements.
  const bulletRe = /[\u2705\u2B50\u2714\u2713\u2611\u2756\u2726\u27A4]/;
  // Apply-CTA paragraph: a SHORT line that asks the reader to send a CV /
  // apply ("\u05E9\u05DC\u05D7 \u05E7\u05D5\u05E8\u05D5\u05EA \u05D7\u05D9\u05D9\u05DD", "\u05E7\u05D5"\u05D7", apply, cv, resume). We key off apply intent
  // + brevity rather than decorative emoji \u2014 some real job bodies use \uD83D\uDD25/\uD83D\uDE80/\uD83D\uDCB0
  // as bullets, and stripping every emoji line would wipe the description.
  const applyCtaRe = /(\u05E7\u05D5\u05E8\u05D5\u05EA \u05D7\u05D9\u05D9\u05DD|\u05E7\u05D5"\u05D7|\u05DE\u05D5\u05E2\u05DE\u05D3\u05D5\u05EA|\u05E9\u05DC\u05D7\u05D5?|\u05D4\u05D2\u05D9\u05E9\u05D5?|\bcv\b|\bapply\b|resume)/i;
  // Requirements-section heading labels: EN (requirement/qualif/advantage/must)
  // + HE (\u05D3\u05E8\u05D9\u05E9\u05D5\u05EA=requirements, \u05DB\u05D9\u05E9\u05D5\u05E8=skills, \u05D9\u05EA\u05E8\u05D5\u05DF=advantage).
  const reqKw = /(requirement|qualif|advantage|\u05D3\u05E8\u05D9\u05E9\u05D5\u05EA|\u05DB\u05D9\u05E9\u05D5\u05E8|\u05D9\u05EA\u05E8\u05D5\u05DF|\bmust\b)/i;

  // ----- REQUIREMENTS: identify requirement nodes FIRST so we can exclude
  // them from the description (prevents duplication). -----
  const reqParts = [];
  const reqNodeIndices = new Set();
  const kids = Array.from(jobPos.children).filter(n => !n.classList.contains('jobDetails'));
  for (let i = 0; i < kids.length; i++) {
    const node = kids[i];
    if (node.querySelector('button, .btnCV')) continue;
    const txt = structuredText(node);
    if (!txt) continue;
    // Format A: a block rendered with check/star bullets.
    if (bulletRe.test(txt)) { reqParts.push(txt); reqNodeIndices.add(i); continue; }
    // Format B: a SHORT heading labelled "Requirements/Advantages/\u05D3\u05E8\u05D9\u05E9\u05D5\u05EA..." followed by a list.
    // Must be an H-tag OR a short line ending with ':' (max 120 chars to avoid
    // matching long paragraphs that incidentally contain the word \u05D3\u05E8\u05D9\u05E9\u05D5\u05EA).
    const rawTxt = (node.textContent || '').trim();
    const isHeading = /^H[1-6]$/.test(node.tagName) || (/:\s*$/.test(rawTxt) && rawTxt.length < 120);
    if (isHeading && reqKw.test(txt)) {
      const sect = [txt];
      reqNodeIndices.add(i);
      for (let j = i + 1; j < kids.length; j++) {
        const nx = kids[j];
        if (/^H[1-6]$/.test(nx.tagName)) break;
        if (nx.querySelector('button, .btnCV')) break;
        const nxTxt = structuredText(nx);
        if (nxTxt) { sect.push(nxTxt); reqNodeIndices.add(j); }
      }
      reqParts.push(sect.join('\n'));
    }
  }
  let requirements = reqParts.join('\n\n');

  // ----- DESCRIPTION: the job body EXCLUDING the requirements section -----
  const clone = jobPos.cloneNode(true);
  clone.querySelectorAll('.jobDetails').forEach(n => n.remove());
  clone.querySelectorAll('button, .btnCV').forEach(n => { const p = n.closest('p'); (p || n).remove(); });
  Array.from(clone.children).forEach(n => { const t = (n.textContent || '').trim(); if (applyCtaRe.test(t) && t.length < 200) n.remove(); });
  // Remove nodes that were classified as requirements to avoid duplication.
  const cloneKids = Array.from(clone.children).filter(n => !n.classList.contains('jobDetails'));
  for (let i = 0; i < cloneKids.length; i++) {
    if (reqNodeIndices.has(i)) cloneKids[i].remove();
  }
  let description = structuredText(clone);
  // Fallback: if removing req nodes left description empty or trivially
  // short (< 40 chars, e.g. just a closing disclaimer), use the full body.
  if ((!description || (description.length < 40 && requirements.length > 100)) && requirements) {
    clone.remove;
    const fallback = jobPos.cloneNode(true);
    fallback.querySelectorAll('.jobDetails').forEach(n => n.remove());
    fallback.querySelectorAll('style,meta,script,link').forEach(n => n.remove());
    fallback.querySelectorAll('button, .btnCV').forEach(n => { const p = n.closest('p'); (p || n).remove(); });
    Array.from(fallback.children).forEach(n => { const t = (n.textContent || '').trim(); if (applyCtaRe.test(t) && t.length < 200) n.remove(); });
    description = structuredText(fallback);
  }

  // Real publish date lives in the detail-page meta block (dd.mm.yy).
  const metaTxt = (jobPos.querySelector('.jobDetails') ? jobPos.querySelector('.jobDetails').innerText : '') || '';
  const dm = metaTxt.match(/\b(\d{2})\.(\d{2})\.(\d{2,4})\b/);
  let pub = '';
  if (dm) { const yy = dm[3].length === 2 ? ('20' + dm[3]) : dm[3]; pub = yy + '-' + dm[2] + '-' + dm[1]; }
  if (!pub) pub = new Date().toISOString().slice(0, 10);

  const mkHidden = (cls, value) => {
    if (!value) return;
    const d = document.createElement('div');
    d.className = cls;
    d.style.display = 'none';
    d.textContent = value;
    document.body.appendChild(d);
  };
  // If fallback made desc identical to req, clear req to avoid full duplication.
  if (description && requirements && description === requirements) requirements = '';
  mkHidden('__ai-description', description);
  mkHidden('__ai-requirements', requirements);
  mkHidden('__ai-publish-date', pub);
}
