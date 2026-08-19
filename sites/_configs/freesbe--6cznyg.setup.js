const CARDS = document.querySelectorAll('div.flex-col.gap-6 > div.cursor-pointer');
if (CARDS.length && !document.querySelector('.__ai-jobid')) {
  const BASE = 'https://careers.freesbe.com/jobs/';
  // The board publishes regions, never cities. Map each to the canonical
  // region vocabulary that already exists in CSV files/city.csv.
  const REG = {
    'השפלה': ['אזור שפלה'], 'השרון': ['אזור השרון'], 'גוש דן': ['אזור מרכז'],
    'דרום': ['אזור דרום'], 'צפון': ['אזור צפון'], 'חיפה והקריות': ['אזור צפון'],
    'ירושלים יו"ש': ['אזור ירושלים', 'אזור יהודה ושומרון'],
  };
  // Branch city named in the title. Matched by SEGMENT EQUALITY against a
  // verified city.csv allowlist, never substring: that rejects "מודיעין אזרחי"
  // (a security firm) and "תדהר" (a contractor) which a substring match reads
  // as the cities מודיעין / תדהר. Emitted alongside the region, city first.
  const BRANCH = ['חצור הגלילית','ראשון לציון','תל אביב-יפו','כוכב יאיר','נוף הגליל','פתח תקווה','בני עי"ש','באר שבע','כפר סבא','בני ברק','ירושלים','אשקלון','כרמיאל','אשדוד','רעננה','נתניה','חולון','חדרה','חיפה','יהוד','אילת','נשר'];
  // Title-only branch aliases. כפ"ס is written in the live DOM with an ASCII
  // quote (U+0022); the geresh/gershayim fold below also covers כפ״ס / כפ׳ס.
  const ALIAS = [['תל אביב', 'תל אביב-יפו'], ['כפ"ס', 'כפר סבא'], ["כפ'ס", 'כפר סבא'], ['כפס', 'כפר סבא']];
  const DROP = /מקדמת גיוון|מזמינה מועמדים/;
  const REQH = /דריש|כישור|מה את.{0,3}ה מביא/;

  function clean(t) { return String(t).replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/^[·•●▪‣◦∙*–—-]+\s*/, '').trim(); }
  // Whole-token match, optionally behind a ב/ל prefix (בחולון, ביהוד, בתל אביב).
  // Every name is verified present in CSV files/city.csv. A title naming several
  // branches yields several cities, which the multi-location pipeline supports.
  const PATS = [];
  BRANCH.forEach(function (c) { PATS.push([c, c]); });
  ALIAS.forEach(function (a) { PATS.push([a[0], a[1]]); });
  function branchCity(title) {
    // city.csv writes בני עי"ש with an ASCII quote; titles use the Hebrew
    // gershayim ״ (U+05F4). Fold it before matching, or the name never matches.
    const t = ' ' + String(title).replace(/\u05f4/g, '"').replace(/[\u05f3\u2019]/g, "'") + ' ';
    const out = [];
    PATS.forEach(function (pc) {
      const re = new RegExp('[\\s\\-\u2013\u2014,("|\u05f4]' + '(?:\u05d1|\u05dc)?' + pc[0].replace(/[-]/g, '\\-') + '[\\s\\-\u2013\u2014,)."|\u05f4]');
      if (re.test(t) && out.indexOf(pc[1]) < 0) out.push(pc[1]);
    });
    return out.join(', ');
  }
  function mapLoc(raw) {
    const out = [];
    String(raw).split(',').forEach(function (p) {
      const k = clean(p); if (!k) return;
      const v = REG[k];
      if (!v) { console.warn('[freesbe] unmapped region "' + k + '"'); return; }
      v.forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); });
    });
    if (out.length >= 5) return 'פריסה ארצית';
    return out.join(', ');
  }
  function render(item, cls, lines) {
    if (!lines.length) return;
    const box = document.createElement('div');
    box.className = cls; box.style.display = 'none';
    let ul = null;
    lines.forEach(function (l) {
      if (l.li) {
        if (!ul) { ul = document.createElement('ul'); box.appendChild(ul); }
        const li = document.createElement('li'); li.textContent = l.t; ul.appendChild(li);
      } else {
        ul = null;
        const d = document.createElement('div'); d.textContent = l.t; box.appendChild(d);
      }
    });
    item.appendChild(box);
  }
  function span(item, cls, val) {
    if (!val) return;
    const s = document.createElement('span');
    s.className = cls; s.style.display = 'none'; s.textContent = val;
    item.appendChild(s);
  }

  const cand = [];
  for (let i = 0; i < CARDS.length; i++) {
    const item = CARDS[i];
    let num = '';
    const sp = item.querySelectorAll('span');
    for (let k = 0; k < sp.length; k++) {
      const t = sp[k].textContent || '';
      if (t.indexOf('מספר משרה') >= 0) { num = (t.match(/(\d+)/) || [])[1] || ''; break; }
    }
    const title = clean((item.querySelector('h3') || {}).textContent || '');
    if (!num || !title) { item.remove(); continue; }
    cand.push({ item: item, num: num, title: title, url: BASE + num });
  }
  const before = cand.length;

  const BATCH = 12;
  for (let i = 0; i < cand.length; i += BATCH) {
    await Promise.all(cand.slice(i, i + BATCH).map(async function (j) {
      try { j.html = await (await fetch(j.url, { credentials: 'omit' })).text(); } catch (e) { j.html = ''; }
    }));
  }

  let noDesc = 0;
  for (const j of cand) {
    span(j.item, '__ai-jobid', 'fsb-' + j.num);
    span(j.item, '__ai-detailUrl', j.url);
    span(j.item, '__ai-apply', j.url);
    if (!j.html) { noDesc++; continue; }
    const doc = new DOMParser().parseFromString(j.html, 'text/html');
    // meta spans: "משרה : N" / "תחום : X" / "מיקום : R1, R2"
    let dept = '', rawLoc = '';
    doc.querySelectorAll('span').forEach(function (s) {
      const t = clean(s.textContent);
      if (!dept && t.indexOf('תחום') === 0) dept = clean(t.replace(/^תחום\s*:?/, ''));
      if (!rawLoc && t.indexOf('מיקום') === 0) rawLoc = clean(t.replace(/^מיקום\s*:?/, ''));
    });
    span(j.item, '__ai-dept', dept);
    // A named branch city wins outright over the board's region tag: the tags
    // are inconsistent with their own titles ("DACIA - נתניה" is tagged צפון,
    // "לסניף ירושלים" is tagged גוש דן), and the branch is where the job is.
    const city = branchCity(j.title);
    span(j.item, '__ai-loc', city || mapLoc(rawLoc));
    const prose = doc.querySelector('div.prose');
    if (!prose) { noDesc++; continue; }
    const desc = [], req = [];
    const kids = prose.children;
    for (let k = 0; k < kids.length; k++) {
      const el = kids[k];
      if (el.tagName === 'P') {
        const t = clean(el.textContent);
        if (t && !DROP.test(t)) desc.push({ t: t, li: false });
        continue;
      }
      const h = el.querySelector('h3');
      const tgt = REQH.test(h ? clean(h.textContent) : '') ? req : desc;
      el.querySelectorAll('span').forEach(function (s) {
        const t = clean(s.textContent);
        if (t && !DROP.test(t)) tgt.push({ t: t, li: true });
      });
    }
    render(j.item, '__ai-desc', desc);
    render(j.item, '__ai-req', req);
    if (!desc.length) noDesc++;
  }
  console.info('[freesbe] items before -> after: ' + before + ' -> ' + cand.length + ' (no description: ' + noDesc + ')');
}
