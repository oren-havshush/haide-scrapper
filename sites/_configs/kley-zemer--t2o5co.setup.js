// כלי זמר (kley-zemer.co.il) — listing-only mode with a per-item detail fetch.
// Injects: externalJobId (CMS numeric id), detailUrl, description (NATIVE detail
// node, so <p>/<br> survive into newlines), location (city.csv-verbatim),
// applicationInfo (Cloudflare-obfuscated apply email).
const CITY_MAP = [
  ['קריית אריה', 'פתח תקווה'], ['פרדס חנה-כרכור', 'פרדס חנה כרכור'],
  ['פרדס חנה כרכור', 'פרדס חנה כרכור'], ['מודיעין', 'מודיעין'],
  ['תל אביב-יפו', 'תל אביב-יפו'], ['תל אביב', 'תל אביב-יפו'], ['צהלה', 'תל אביב-יפו'],
  ['ראשון לציון', 'ראשון לציון'], ['פתח תקווה', 'פתח תקווה'], ['ירושלים', 'ירושלים'],
  ['באר שבע', 'באר שבע'], ['בני ברק', 'בני ברק'], ['רמת גן', 'רמת גן'],
  ['רמת השרון', 'רמת השרון'], ['בת ים', 'בת-ים'], ['בת-ים', 'בת-ים'],
  ['בית שמש', 'בית שמש'], ['בית שאן', 'בית שאן'], ['כפר סבא', 'כפר סבא'],
  ['ראש העין', 'ראש העין'], ['נס ציונה', 'נס ציונה'], ['אור יהודה', 'אור יהודה'],
  ['גני תקווה', 'גני תקווה'], ['מגדל העמק', 'מגדל העמק'], ['זכרון יעקב', 'זכרון יעקב'],
  ['מעלה אדומים', 'מעלה אדומים'], ['טירת הכרמל', 'טירת הכרמל'], ['טירת כרמל', 'טירת הכרמל'],
  ['קריית ביאליק', 'קרית ביאליק'], ['קרית ביאליק', 'קרית ביאליק'],
  ['קריית מוצקין', 'קרית מוצקין'], ['קרית מוצקין', 'קרית מוצקין'],
  ['קריית אתא', 'קרית אתא'], ['קרית אתא', 'קרית אתא'],
  ['קריית גת', 'קרית גת'], ['קרית גת', 'קרית גת'],
  ['קריית ים', 'קרית ים'], ['קרית ים', 'קרית ים'],
  ['חיפה', 'חיפה'], ['אשדוד', 'אשדוד'], ['אשקלון', 'אשקלון'], ['נתניה', 'נתניה'],
  ['חולון', 'חולון'], ['רחובות', 'רחובות'], ['חדרה', 'חדרה'], ['נצרת', 'נצרת'],
  ['רעננה', 'רעננה'], ['גבעתיים', 'גבעתיים'], ['הרצליה', 'הרצליה'], ['נהריה', 'נהריה'],
  ['אילת', 'אילת'], ['טבריה', 'טבריה'], ['עפולה', 'עפולה'], ['יבנה', 'יבנה'],
  ['כרמיאל', 'כרמיאל'], ['דימונה', 'דימונה'], ['צפת', 'צפת'], ['אריאל', 'אריאל'],
  ['אלעד', 'אלעד'], ['שדרות', 'שדרות'], ['נתיבות', 'נתיבות'], ['אופקים', 'אופקים'],
  ['ערד', 'ערד'], ['נשר', 'נשר'], ['יהוד', 'יהוד'],
];

const add = (item, cls, text) => {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  item.appendChild(s);
};

const cfDecode = (hex) => {
  const key = parseInt(hex.substr(0, 2), 16);
  let out = '';
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.substr(i, 2), 16) ^ key);
  return out;
};

await Promise.all([...document.querySelectorAll('div.item.row')].map(async (item) => {
  if (item.querySelector('.__ai-externalJobId')) return;

  const link = item.querySelector('a.link-to-page');
  const href = link ? link.getAttribute('href') : '';
  if (!href) return;

  // CMS content key: the card image carries id="BSUniqueID_<num>_<n>_BSIMAGE";
  // the detail page's body div is id="BSText<num>_<n>_BSTEXT" — same key.
  const keyed = item.querySelector('[id^="BSUniqueID_"]');
  const km = keyed ? (keyed.id.match(/BSUniqueID_(\d+_\d+)_/) || [])[1] : null;
  let id = km ? 'kz-' + km : null;
  if (!id) {
    let h = 0;
    for (const ch of href) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    id = 'kz-h' + h.toString(36);
  }
  add(item, '__ai-externalJobId', id);

  const detailUrl = new URL(href, location.origin + '/').href;
  add(item, '__ai-detailUrl', detailUrl);

  let bodyText = '';
  try {
    const html = await (await fetch(detailUrl)).text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    let descEl = km ? doc.querySelector('[id="BSText' + km + '_BSTEXT"]') : null;
    if (!descEl) {
      descEl = [...doc.querySelectorAll('.page-content .editor_text, main .editor_text')]
        .find((el) => (el.textContent || '').trim().length > 60) || null;
    }
    if (descEl) {
      // Import the real node — domFieldExtract turns <p>/<br>/<li> into newlines
      // and bullets. Never flatten with textContent (that is what blobbed this site).
      const node = document.importNode(descEl, true);
      node.className = '__ai-description';

      // The apply CTA ("שלחו קורות חיים למייל: x@y") belongs in applicationInfo,
      // not in the job description. Drop the address element, then the CTA words
      // around it, then any block left empty by the removal.
      node.querySelectorAll('[data-cfemail], .__cf_email__, a[href^="mailto:"], a[href*="email-protection"]')
        .forEach((n) => n.remove());
      const CTA = /(?:שליחת\s+|נא\s+|יש\s+|ניתן\s+)?(?:ל?שלוח|שלחו|שלח\/י|להעביר|לשלוח)?\s*(?:את\s+)?(?:קורות\s*ה?חיים|קו"ח|קו״ח)(?:\s*(?:או|ו)\s*פרטים)?\s*(?:ל?מייל|ל?דוא"ל|ל?דוא״ל|ל?אימייל|ל?כתובת(?:\s*המייל)?)?\s*:?\s*/g;
      const EMAIL = /[\w.+-]+@[\w.-]+\.\w+/g;
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const texts = [];
      while (walker.nextNode()) texts.push(walker.currentNode);
      texts.forEach((t) => { t.nodeValue = (t.nodeValue || '').replace(EMAIL, '').replace(CTA, ''); });
      node.querySelectorAll('p, div, strong, span, em, b').forEach((el) => {
        if (!(el.textContent || '').trim() && !el.querySelector('img, br')) el.remove();
      });
      while (node.lastElementChild && node.lastElementChild.tagName === 'BR') node.lastElementChild.remove();

      item.appendChild(node);
      bodyText = node.textContent || '';
    }

    const cfEl = doc.querySelector('[data-cfemail]');
    if (cfEl) {
      const email = cfDecode(cfEl.getAttribute('data-cfemail'));
      if (email.includes('@')) add(item, '__ai-applicationInfo', 'mailto:' + email);
    }
  } catch (e) { /* detail fetch failed — listing fields still ship */ }

  // Location: the branch city is written into the ad prose, never its own node.
  // Match city.csv-verbatim names only; the gazetteer otherwise mis-reads phrases
  // like "משמרות בוקר" as the moshav משמרות (LRN-LOC-1).
  const hay = (item.textContent || '') + ' ' + bodyText;
  const hits = [];
  for (const [needle, canon] of CITY_MAP) {
    if (hay.includes(needle) && !hits.includes(canon)) hits.push(canon);
  }
  add(item, '__ai-location', hits.length ? hits.join(' / ') : 'פריסה ארצית');
}));
