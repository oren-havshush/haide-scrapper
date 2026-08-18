/* fibi.co.il — jobs accordion on a single page.
   Each job is a <section id="section_<uuid>"> with an <h2> title, prose,
   a qualifications list, employment-terms trailer lines and a mailto apply.
   Section ids are CMS slot ids and get RECYCLED when an editor replaces the
   content of an old slot, so externalJobId is a hash of the title instead.
   The accordion also carries one non-job row (the candidate privacy notice);
   it is removed here by title so the itemSelector can stay broad — a vacancy
   that ever ships without the CV email must still be scraped, not dropped. */
const SECTIONS = document.querySelectorAll('section[id^="section"]');
const EMIT_AS = { 'רמלה': 'רמלה לוד', 'לוד': 'רמלה לוד' };
const NATIONWIDE = 'פריסה ארצית';
const REQ_HEAD = /^(הכישורים\s+הנדרשים|דרישות\s+התפקיד|דרישות\s+המשרה|כישורים\s|כישורים:)/;
const TRAILER = /^(היקף\s+משרה|הקליטה\s+כעובדי|תנאים\s+מעולים)/;
const APPLY = /קורות\s+חיים\s+יש\s+לשלוח|jobs@fibi\.co\.il/;
const EEO = /הבנק\s+מעודד\s+ומקדם/;
const PRIVACY = /מדיניות\s+הפרטיות|מדיניות\s+פרטיות/;
const NON_JOB = /^\s*מדיניות\s+(ה)?פרטיות/;

function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const APPLY_EMAIL = 'jobs@fibi.co.il';   // printed at the top of the listing page
let before = 0, dropped = 0, kept = 0;

for (const sec of SECTIONS) {
  before++;
  if (sec.querySelector('.__ai-box')) { kept++; continue; }  // re-run guard
  const h2 = sec.querySelector('h2');
  if (!h2) { sec.remove(); dropped++; continue; }
  const title = (h2.textContent || '').replace(/\s+/g, ' ').trim();
  if (!title) { sec.remove(); dropped++; continue; }
  // The one non-job row: a candidate privacy notice, no role and no apply path.
  if (NON_JOB.test(title)) { sec.remove(); dropped++; continue; }
  kept++;

  // ---- collect visible lines after the title, in document order ----
  const lines = [];
  for (const el of Array.from(sec.children)) {
    if (el === h2 || el.classList.contains('__ai-box')) continue;
    if (el.tagName === 'UL' || el.tagName === 'OL') {
      for (const li of Array.from(el.querySelectorAll('li'))) {
        const t = (li.innerText || '').replace(/[^\S\n]+/g, ' ').trim();
        if (t) lines.push({ t: t, li: true });
      }
      continue;
    }
    const raw = (el.innerText || '').split('\n');
    for (const r of raw) {
      const t = r.replace(/[^\S\n]+/g, ' ').trim();
      if (t) lines.push({ t: t, li: false });
    }
  }

  // ---- route each line: description prose / requirements / dropped ----
  const desc = [];
  const req = [];
  let inReq = false;
  for (const ln of lines) {
    if (APPLY.test(ln.t) || EEO.test(ln.t) || PRIVACY.test(ln.t)) continue;
    if (REQ_HEAD.test(ln.t)) { inReq = true; continue; }   // heading itself is dropped
    if (TRAILER.test(ln.t)) { desc.push(ln); continue; }   // terms belong to description
    (inReq ? req : desc).push(ln);
  }

  // ---- location: only ever emit a value that exists in "CSV files/city.csv" ----
  let loc = '';
  const m = title.match(/מיקום\s+המשרה\s+הינו\s+ב?([^\)\,]+)/);
  if (m) {
    const raw = m[1].replace(/\s+/g, ' ').trim();
    loc = EMIT_AS[raw] || '';
  }
  if (!loc && /ברחבי\s+הארץ|פריסה\s+ארצית|ארצי(ת)?\b/.test(title)) loc = NATIONWIDE;

  // ---- inject ----
  const box = document.createElement('div');
  box.className = '__ai-box';
  box.style.display = 'none';

  const dbox = document.createElement('div');
  dbox.className = '__ai-desc';
  for (const ln of desc) {
    const d = document.createElement('div');
    d.textContent = ln.t;
    dbox.appendChild(d);
  }
  if (desc.length) box.appendChild(dbox);

  if (req.length) {
    const rbox = document.createElement('ul');
    rbox.className = '__ai-req';
    for (const ln of req) {
      const li = document.createElement('li');
      li.textContent = ln.t;
      rbox.appendChild(li);
    }
    box.appendChild(rbox);
  }

  if (loc) {
    const l = document.createElement('span');
    l.className = '__ai-loc';
    l.textContent = loc;
    box.appendChild(l);
  }

  const idEl = document.createElement('span');
  idEl.className = '__ai-jobid';
  idEl.textContent = 'fibi-' + hash(title);
  box.appendChild(idEl);

  const ap = document.createElement('span');
  ap.className = '__ai-apply';
  ap.textContent = 'mailto:' + APPLY_EMAIL;
  box.appendChild(ap);

  sec.appendChild(box);
}

console.info('[fibi] items before -> after: ' + before + ' -> ' + kept + ' (dropped ' + dropped + ' non-job row(s))');
