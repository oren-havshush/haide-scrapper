const items = [...document.querySelectorAll('.proflist .thumb')];
const txt = (el) => el ? (el.innerText || el.textContent || '').trim() : '';
const mk = (cls, val) => { const s = document.createElement('span'); s.className = cls; s.textContent = val; return s; };
// Civi's uploader posts the file async and writes the id into a hidden input[name=cv];
// the visible file picker carries no name. We advertise `cv` as the file field because
// that is what the applicant actually supplies.
const applyFields = [
  {name:'Form_submitted',label:'',tagName:'INPUT',required:false,fieldType:'hidden'},
  {name:'name',label:'שם מלא',tagName:'INPUT',required:true,fieldType:'text'},
  {name:'phone',label:'טלפון',tagName:'INPUT',required:true,fieldType:'tel'},
  {name:'email',label:'דוא"ל',tagName:'INPUT',required:true,fieldType:'email'},
  {name:'cv',label:'קורות חיים',tagName:'INPUT',required:true,fieldType:'file'}
];
// "Send us your CV" catch-all rows are not jobs — drop them rather than save them.
const CATCHALL = /(משרה\s*כללית|פני[יה]ה\s*כללית|מאגר\s*(ה?מועמדים|קורות)|לא\s*מצאת[םן]?\s*משרה|שלח[וי]?\s*(לנו\s*)?קורות\s*חיים|הצטרפ[וי]\s*למאגר)/;
// Only some postings fill #je-details; the rest headline their requirements inside the
// body instead. Both spellings of the heading are in use on this board.
const REQ_WORDS = 'דרישות(?:\\s+(?:התפקיד|המשרה))?|מה\\s+אנחנו\\s+מחפשים|יש\\s+לכם|אתם\\s+מתאימים\\s+אם|כישורים|הכישורים\\s+שלך|מה\\s+נדרש|תנאי\\s+סף';
const OTHER_WORDS = 'מה\\s+תקבלו|מה\\s+תעשו\\s+אצלנו|מה\\s+מחכה\\s+לכם|היקף\\s+המשרה|סביבת\\s+עבודה|מיקום|תנאים|שעות\\s+עבודה|על\\s+החברה|עלינו|למה\\s+דווקא\\s+אצלנו|למה\\s+כדאי|תחומי\\s+ה?אחריות|במסגרת\\s+התפקיד|התפקיד\\s+כולל|מה\\s+כולל\\s+התפקיד|אנחנו\\s+מגייסים';
const REQ_HEAD = new RegExp('^(?:' + REQ_WORDS + ')\\s*[:?!.]*$');
const ANY_HEAD = new RegExp('^(?:' + REQ_WORDS + '|' + OTHER_WORDS + ')\\s*[:?!.]*$');
// strip bullets/emoji so a decorated heading ("✨ מה מחכה לכם?") still reads as one
const norm = (l) => l.replace(/^[^֐-׿a-zA-Z0-9]+/, '').trim();
const splitReq = (text) => {
  const lines = text.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) { if (REQ_HEAD.test(norm(lines[i]))) { start = i; break; } }
  if (start < 0) return null;
  let i = start + 1;
  while (i < lines.length && !lines[i].trim()) i++;   // heading may be followed by a blank line
  const contentStart = i;
  let end = lines.length;
  for (; i < lines.length; i++) {
    if (!lines[i].trim()) { end = i; break; }          // blank line closes the block
    if (ANY_HEAD.test(norm(lines[i]))) { end = i; break; }  // next section starts
  }
  if (end <= contentStart) return null;
  return {
    req: lines.slice(start, end).join('\n').trim(),
    descr: lines.slice(0, start).concat(lines.slice(end)).join('\n').replace(/\n{3,}/g, '\n\n').trim()
  };
};
await Promise.all(items.map(async (item) => {
  if (item.querySelector('.__ai-jobid')) return;
  const tc = item.querySelector('.thumb-content');
  if (!tc) return;
  const m = (tc.getAttribute('onclick') || '').match(/openPromo\(event,(\d+),(\d+)/);
  if (!m) return;
  const jobId = m[1], srcId = m[2];
  const detailUrl = 'https://app.civi.co.il/promo/id=' + jobId + '&src=' + srcId;
  const listingTitle = txt(tc.querySelector('.title'));
  const listingDescr = txt(item.querySelector('.descr'));
  let title = listingTitle, descr = '', req = '';
  try {
    const r = await fetch(detailUrl);
    const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
    const t = txt(doc.querySelector('#je-title'));
    if (t) title = t;
    descr = txt(doc.querySelector('#je-descr'));
    req = txt(doc.querySelector('#je-details'));
  } catch (e) {}
  // promo/id=777931 returns 200 with an empty body — the listing card still carries
  // the full text, so fall back to it rather than shipping an empty description.
  if (!descr) descr = listingDescr;
  if (CATCHALL.test(title)) { item.remove(); return; }
  // Some postings repeat "<title> (<id>)" as the first line of the body.
  if (title) {
    const lead = new RegExp('^' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*(\\(\\s*' + jobId + '\\s*\\))?\\s*\\n+');
    descr = descr.replace(lead, '').trim();
  }
  // No #je-details: lift the requirements section out of the body so the two fields
  // stay distinct instead of the requirements hiding inside the description.
  if (!req && descr) {
    const split = splitReq(descr);
    if (split) { req = split.req; descr = split.descr; }
  }
  // requirements must not restate the description (and vice versa)
  if (req && descr && (descr.includes(req) || req.includes(descr))) req = '';
  if (!title || !descr) return;   // never ship a row without a title and a body
  item.appendChild(mk('__ai-jobid', jobId));
  item.appendChild(mk('__ai-title', title));
  item.appendChild(mk('__ai-location', 'רמת גן'));
  item.appendChild(mk('__ai-description', descr));
  if (req) item.appendChild(mk('__ai-requirements', req));
  item.appendChild(mk('__ai-applicationInfo',
    JSON.stringify({actionUrl: detailUrl, method: 'POST', fields: applyFields})));
  const a = document.createElement('a');
  a.className = '__ai-detailurl';
  a.href = detailUrl;
  item.appendChild(a);
}));
