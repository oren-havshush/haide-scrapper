// inManage (inmanage.co.il) — listing-only site; the detail pages render the
// same .job-item card, so everything is extracted from the listing.
// Runs on listing and detail pages alike; guarded against re-run duplication.
const CITY = 'תל אביב-יפו';

// The requirements list is authored three different ways across the 17 cards:
//   a) "line \n<br>\n line"  — the common case. The stray text-node newlines on
//      either side of the <br> make domFieldExtract emit \n\n\n -> a blank line
//      between every item.
//   b) literal "\n" in one text node, no <br> at all (id 18). HTML collapses
//      those to spaces, so the card renders as one run-on line.
//   c) one text node whose items are separated by runs of 2+ spaces (id 16),
//      plus a trailing off-site SEO anchor that is not job content.
// Normalise all three to one item per line, in the site's own order.
function imLines(el) {
  const clone = el.cloneNode(true);
  // Drop anchors that leave the site (id 16 trails a sweethome.co.il link).
  clone.querySelectorAll('a[href]').forEach((a) => {
    try { if (new URL(a.href, location.href).hostname !== location.hostname) a.remove(); }
    catch (e) { /* malformed href: leave it alone */ }
  });
  clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));

  let lines = (clone.textContent || '')
    .replace(/ /g, ' ')     // nbsp -> space
    .split('\n')
    .map((s) => s.replace(/[\t\r]+/g, ' ').trim())
    .filter((s) => s.length > 0);

  // Case (c): only split a line on 2+ spaces when it carries at least three
  // such runs. A single double-space is a typo ("תואר ראשון BSc  במדעי המחשב")
  // and must NOT become two requirements. This runs BEFORE whitespace is
  // collapsed — those space runs are the only separator the line has left.
  lines = lines
    .flatMap((line) =>
      (line.match(/ {2,}/g) || []).length >= 3
        ? line.split(/ {2,}/).map((s) => s.trim()).filter(Boolean)
        : [line],
    )
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  // Deliberately NO marker rewriting: the job text is reproduced verbatim, in the
  // site's own order. Where the ad itself prints a "*" the "*" is kept as-is. An
  // earlier build prefixed "• " to every line; it matched the pipeline's bullet
  // convention but did not match the page, and a leading neutral glyph on an RTL
  // line is exactly what a bidi-unaware renderer reorders. Structure only.
  return lines;
}

document.querySelectorAll('.job-item').forEach((item) => {
  // 1) Location. The site prints no location on any job, but inManage is a
  // single-office employer (רח' השפלה 3, תל אביב). Inject it rather than using
  // _meta.locationFallback: the fallback only fills an EMPTY location, so it
  // cannot correct a wrong gazetteer guess drawn from the job text. Value must
  // match "CSV files/city.csv" verbatim -> "תל אביב-יפו", not "תל אביב".
  if (!item.querySelector('.__ai-location')) {
    const loc = document.createElement('span');
    loc.className = '__ai-location';
    loc.textContent = CITY;
    item.appendChild(loc);
  }

  // 2) Description: the cleaned-up requirements list, one item per line.
  if (!item.querySelector('.__ai-description')) {
    const src = item.querySelector('.js_job_require');
    if (src) {
      const div = document.createElement('div');
      div.className = '__ai-description';
      div.textContent = imLines(src).join('\n');
      item.appendChild(div);
    }
  }

  // 3) externalJobId. a.js-apply-job[data-job-id] holds the CMS's real per-job
  // record id (8, 14, 16, 23 ... 44 — non-contiguous, so not a row index), but
  // verify-jobids hard-fails any all-integer id set as "index-based". Prefix it
  // so the gate can tell a record id from an index. Derived from the native id,
  // so it still survives a re-scrape unchanged.
  if (!item.querySelector('.__ai-jobid')) {
    const apply = item.querySelector('a.js-apply-job');
    const native = apply && apply.getAttribute('data-job-id');
    if (native && native.trim()) {
      const jid = document.createElement('span');
      jid.className = '__ai-jobid';
      jid.textContent = 'im-' + native.trim();
      item.appendChild(jid);
    }
  }
});
