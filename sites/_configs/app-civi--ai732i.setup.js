const items = [...document.querySelectorAll('.proflist .thumb')];
const txt = (el) => el ? (el.innerText || el.textContent || '').trim() : '';
const mk = (cls, val) => { const s = document.createElement('span'); s.className = cls; s.textContent = val; return s; };
// Civi uploads the file async into a hidden input[name=cv]; the picker has no name.
const applyFields = [
  {name:'Form_submitted',label:'',tagName:'INPUT',required:false,fieldType:'hidden'},
  {name:'name',label:'שם מלא',tagName:'INPUT',required:true,fieldType:'text'},
  {name:'phone',label:'טלפון',tagName:'INPUT',required:true,fieldType:'tel'},
  {name:'email',label:'דוא"ל',tagName:'INPUT',required:true,fieldType:'email'},
  {name:'cv',label:'קורות חיים',tagName:'INPUT',required:true,fieldType:'file'}
];
// "Send us your CV" catch-all rows are not jobs — drop them.
const CATCHALL = /(משרה\s*כללית|פני[יה]ה\s*כללית|מאגר\s*(ה?מועמדים|קורות)|לא\s*מצאת[םן]?\s*משרה|שלח[וי]?\s*(לנו\s*)?קורות\s*חיים|הצטרפ[וי]\s*למאגר)/;
// Only some postings fill #je-details; others headline requirements inside the body.
const REQ_WORDS = 'דרישות(?:\\s+(?:התפקיד|המשרה))?|מה\\s+אנחנו\\s+מחפשים|יש\\s+לכם|אתם\\s+מתאימים\\s+אם|כישורים|הכישורים\\s+שלך|מה\\s+נדרש|תנאי\\s+סף';
const OTHER_WORDS = 'מה\\s+תקבלו|מה\\s+תעשו\\s+אצלנו|מה\\s+מחכה\\s+לכם|היקף\\s+המשרה|סביבת\\s+עבודה|מיקום|תנאים|שעות\\s+עבודה|על\\s+החברה|עלינו|למה\\s+דווקא\\s+אצלנו|למה\\s+כדאי|תחומי\\s+ה?אחריות|במסגרת\\s+התפקיד|התפקיד\\s+כולל|מה\\s+כולל\\s+התפקיד|אנחנו\\s+מגייסים';
const REQ_HEAD = new RegExp('^(?:' + REQ_WORDS + ')\\s*[:?!.]*$');
const ANY_HEAD = new RegExp('^(?:' + REQ_WORDS + '|' + OTHER_WORDS + ')\\s*[:?!.]*$');
// strip bullets/emoji so "✨ מה מחכה לכם?" still reads as a heading
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
// Civi has no per-job location field, but נטלי postings name their branch in the body
// ("בורסה רמת גן", 'ממוקם בר"ג'). Mine that explicitly: a blind gazetteer scan of this
// text hits מתן / מלאה / משמרות / רווחה — real city.csv rows that here are plain words.
// "alias|alias=canonical"; every canonical is verbatim in "CSV files/city.csv".
const CITY_RULES = (`
  ראשון לציון|ראשל"צ=ראשון לציון;תל אביב-יפו|תל אביב|תל-אביב|ת"א=תל אביב-יפו;
  רמת גן|רמת-גן|ר"ג=רמת גן;ירושלים=ירושלים;פתח תקווה|פתח תקוה|פ"ת=פתח תקווה;
  באר שבע|ב"ש=באר שבע;חיפה=חיפה;נתניה=נתניה;חולון=חולון;בת ים|בת-ים=בת-ים;
  בני ברק=בני ברק;גבעתיים=גבעתיים;אשדוד=אשדוד;אשקלון=אשקלון;רחובות=רחובות;
  נס ציונה=נס ציונה;כפר סבא=כפר סבא;הרצליה=הרצליה;רעננה=רעננה;הוד השרון=הוד השרון;
  ראש העין=ראש העין;אור יהודה=אור יהודה;קריית אונו|קרית אונו=קריית אונו;
  רמת השרון=רמת השרון;גבעת שמואל=גבעת שמואל;בית שמש=בית שמש;מודיעין=מודיעין;
  רמלה|לוד=רמלה לוד;גדרה=גדרה;חדרה=חדרה;כרמיאל=כרמיאל;עפולה=עפולה;טבריה=טבריה;
  צפת=צפת;נצרת=נצרת;עכו=עכו;קריית שמונה|קרית שמונה=קריית שמונה;אילת=אילת;
  דימונה=דימונה;קריית גת|קרית גת=קריית גת;אופקים=אופקים;נתיבות=נתיבות`
).split(';').flatMap((row) => { const [a, c] = row.trim().split('='); return a.split('|').map((n) => [n, c]); })
  .sort((x, y) => y[0].length - x[0].length);
// Region wording, only when no city is named ("עבודה במרכז").
const REGION_RULES = [
  [/מרכז\s+הארץ|באזור\s+המרכז|אזור\s+המרכז|עבודה\s+במרכז|שטח[^\n]{0,20}במרכז/, 'אזור מרכז'],
  [/דרום\s+הארץ|באזור\s+הדרום|אזור\s+הדרום/, 'אזור דרום'],
  [/צפון\s+הארץ|באזור\s+הצפון|אזור\s+הצפון/, 'אזור צפון'],
  [/בשרון|אזור\s+השרון/, 'אזור השרון'],
  [/בשפלה|אזור\s+השפלה/, 'אזור שפלה'],
  [/בכל\s+רחבי\s+הארץ|פריסה\s+ארצית|כל\s+הארץ/, 'פריסה ארצית']
];
const HEB = (c) => c >= 'א' && c <= 'ת';
// Attached one-letter prefixes. ה is excluded on purpose: it turns גדרה into הגדרה.
const PREFIX = 'בלמושכ';            // ברמת גן / מרמת גן / לרמת גן …
const findCities = (raw) => {
  const t = raw.replace(/[״“”]/g, '"').replace(/[‐-―]/g, '-').replace(/\s+/g, ' ');
  const out = [];
  for (const [needle, canonical] of CITY_RULES) {
    if (out.includes(canonical)) continue;
    let from = 0;
    for (;;) {
      const at = t.indexOf(needle, from);
      if (at === -1) break;
      from = at + 1;
      const end = at + needle.length;
      const before = at > 0 ? t[at - 1] : ' ';
      const before2 = at > 1 ? t[at - 2] : ' ';
      const after = end < t.length ? t[end] : ' ';
      if (HEB(before) && !(PREFIX.indexOf(before) >= 0 && !HEB(before2))) continue;
      if (HEB(after)) continue;
      out.push(canonical);
      break;
    }
  }
  return out;
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
  // A promo can answer 200 with an empty body — fall back to the card text.
  if (!descr) descr = listingDescr;
  if (CATCHALL.test(title)) { item.remove(); return; }
  // Some postings repeat "<title> (<id>)" as the first line of the body.
  if (title) {
    const lead = new RegExp('^' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*(\\(\\s*' + jobId + '\\s*\\))?\\s*\\n+');
    descr = descr.replace(lead, '').trim();
  }
  // No #je-details: lift the requirements section out of the body so both stay distinct.
  if (!req && descr) {
    const split = splitReq(descr);
    if (split) { req = split.req; descr = split.descr; }
  }
  // requirements must not restate the description (and vice versa)
  if (req && descr && (descr.includes(req) || req.includes(descr))) req = '';
  if (!title || !descr) return;   // never ship a row without a title and a body
  let cities = findCities(title + '\n' + descr + '\n' + req);
  if (!cities.length) {
    const blob = title + '\n' + descr + '\n' + req;
    for (const [re, canonical] of REGION_RULES) { if (re.test(blob)) { cities = [canonical]; break; } }
  }
  item.appendChild(mk('__ai-jobid', jobId));
  item.appendChild(mk('__ai-title', title));
  // Nothing named → the Unknown sentinel, never a guess at the HQ. Emit it explicitly:
  // an empty value lets the worker's labeled scan lift a "מיקום: <landmark>" line out
  // of the body, and a landmark is not a city.csv place.
  item.appendChild(mk('__ai-location', cities.join(', ') || 'Unknown'));
  item.appendChild(mk('__ai-description', descr));
  if (req) item.appendChild(mk('__ai-requirements', req));
  item.appendChild(mk('__ai-applicationInfo',
    JSON.stringify({actionUrl: detailUrl, method: 'POST', fields: applyFields})));
  const a = document.createElement('a');
  a.className = '__ai-detailurl';
  a.href = detailUrl;
  item.appendChild(a);
}));
