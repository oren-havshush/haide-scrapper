// Guard against re-run
if (document.getElementById('__imj-jobs')) return;

const mk = (cls, val) => { const s = document.createElement('span'); s.className = cls; s.textContent = val; return s; };

const hashStr = (str) => {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h) + str.charCodeAt(i);
  return 'h' + Math.abs(h).toString(16);
};

// Today as YYYY-MM-DD, used to drop jobs whose application deadline has passed.
const _now = new Date();
const todayISO = _now.getFullYear() + '-' + String(_now.getMonth() + 1).padStart(2, '0') + '-' + String(_now.getDate()).padStart(2, '0');

// Find all H1 elements with dir=RTL in the page (job titles)
const h1Els = [...document.querySelectorAll('h1[dir="RTL"]')].filter(h => {
  const txt = (h.textContent || '').trim();
  return txt.length > 5 && !txt.includes('&nbsp;');
});

if (h1Els.length === 0) return;

const container = document.createElement('div');
container.id = '__imj-jobs';
container.style.display = 'none';

for (const h1 of h1Els) {
  const title = (h1.textContent || '').trim();
  if (!title || title.length < 5) continue;

  // Collect content: walk siblings after h1 until next h1 or end
  const descParts = [];
  let applicationInfo = '';
  let sibling = h1.nextElementSibling;

  while (sibling && sibling.tagName !== 'H1') {
    const tag = sibling.tagName;
    // Look for niloos or mailto links
    const link = sibling.querySelector && sibling.querySelector('a[href*="niloos"], a[href*="vacancy"]');
    if (link) {
      applicationInfo = link.getAttribute('href') || '';
    }
    const mailtoLink = sibling.querySelector && sibling.querySelector('a[href^="mailto:"]');
    if (mailtoLink && !applicationInfo) {
      applicationInfo = mailtoLink.getAttribute('href') || '';
    }
    // Get description text (skip apply links and blank lines)
    const txt = (sibling.textContent || '').replace(/\s+/g, ' ').trim();
    if (txt && !txt.includes('להגשת מועמדות') && !txt.includes('Click here') && txt !== '&nbsp;') {
      descParts.push(txt);
    }
    sibling = sibling.nextElementSibling;
  }

  // EMAIL-ONLY GATE: keep only jobs whose apply path is an email (mailto).
  // Jobs with an online apply form (Niloos, reCAPTCHA-gated) are intentionally
  // NOT scraped — they cannot be auto-applied. See site adminNote.
  if (!/^mailto:/i.test(applicationInfo)) continue;

  const description = descParts.filter(t => t.length > 2).join('\n').trim();

  // Parse application deadline: "ניתן להגיש מועמדות עד לתאריך D.M.YYYY" → YYYY-MM-DD
  let deadlineISO = '';
  const dm = description.match(/עד\s*לתאריך\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (dm) {
    const dd = String(parseInt(dm[1], 10)).padStart(2, '0');
    const mm = String(parseInt(dm[2], 10)).padStart(2, '0');
    deadlineISO = dm[3] + '-' + mm + '-' + dd;
  }

  // DROP jobs whose deadline is already in the past (deadline today still kept).
  if (deadlineISO && deadlineISO < todayISO) continue;

  // Email-apply jobs key off the title hash (no niloos vacancy id present).
  const externalJobId = 'imj-' + hashStr(title);

  const item = document.createElement('div');
  item.className = 'imj-job-item';
  item.appendChild(mk('__ai-title', title));
  item.appendChild(mk('__ai-externalJobId', externalJobId));
  // Location is hardcoded — the museum is in Jerusalem; the page rarely prints it.
  item.appendChild(mk('__ai-location', 'ירושלים'));
  if (description) item.appendChild(mk('__ai-description', description));
  if (deadlineISO) item.appendChild(mk('__ai-deadline', deadlineISO));
  if (applicationInfo) item.appendChild(mk('__ai-applicationInfo', applicationInfo));
  container.appendChild(item);
}

document.body.prepend(container);
