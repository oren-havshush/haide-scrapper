return (async function () {
  // tigbur.co.il — WP board, panels from POST admin-ajax (tb_get_jobs). No
  // Tier-A field is selectable; all rebuilt into the panel ROOT (LRN-SETUP-1).
  var CITIES = 'איירפורט סיטי|אזור ירושלים|מעלה אדומים|פריסה ארצית|קריית שמונה|ראשון לציון|תל אביב-יפו|אזור השרון|מזכרת בתיה|נצרת עילית|קרית מלאכי|אור יהודה|אזור מרכז|אזור שפלה|כפר יאסיף|מגדל העמק|נוף הגליל|פתח תקווה|רמת השרון|אזור צפון|אזור דרום|אזור אילת|באר יעקב|נס ציונה|פסגת זאב|קרית אתא|ראש העין|רמלה לוד|שער הנגב|באר שבע|בית שאן|בית שמש|בני ברק|ירושלים|כפר סבא|מודיעין|קרית גת|אופקים|אשקלון|דימונה|הרצליה|כרמיאל|נתיבות|עזריאל|ציפורי|רחובות|רמת גן|אשדוד|גדרות|דלתון|חולון|טבריה|טייבה|ירוחם|כישור|נהריה|נתניה|עילית|עמיעד|עפולה|קטורה|קצרין|רכסים|רעננה|שדרות|שלומי|אורה|אילת|אלעד|אפיק|אפרת|בטחה|גדרה|גורן|גלגל|חדרה|חורה|חיפה|חרות|יבנה|יהוד|ינון|מאור|מיטב|מישר|מצפה|נגבה|נצרת|ספיר|עגור|עינת|רועי|שובה|שמיר|טירה|שוהם|עכו|ערד|צפת|רהט'.split('|');
  var NB = '(?<![֐-׿])', NA = '(?![֐-׿])';
  var ALIAS = {}; // ad spelling -> city.csv value
  'תל אביב,תל-אביב,ת"א>תל אביב-יפו|ראשון,ראשל"צ,ראשון-לציון>ראשון לציון|פ"ת,פתח תקוה>פתח תקווה|רמלה,לוד>רמלה לוד|המרכז,גוש דן>אזור מרכז|הדרום,הנגב>אזור דרום|ב"ש>באר שבע|ר"ג>רמת גן|הצפון>אזור צפון|השפלה>אזור שפלה|השרון>אזור השרון|עכו>עכו|צפת>צפת|ערד>ערד|רהט>רהט|נשר>נשר'
    .split('|').forEach(function (p) { var a = p.split('>'); a[0].split(',').forEach(function (k) { ALIAS[k] = a[1]; }); });
  CITIES.forEach(function (n) { if (n.indexOf('קרית ') == 0) ALIAS['קריית ' + n.slice(5)] = n; });
  var KEYS = Object.keys(ALIAS);
  function canon(v) { return ALIAS[v] || v; }
  var SORTED = CITIES.concat(KEYS).sort(function (a, b) { return b.length - a.length; });
  var ALL = SORTED.join('|');
  var LOOSE = SORTED.filter(function (n) { return n.indexOf(' ') > 0 || n.length > 5; }).join('|');
  var C = '\\s*[:\\-]?\\s*' + NB + '(?:ב|ל)?(' + ALL + ')' + NA, D = '(?:צפון|דרום|מרכז|מזרח|מערב)';
  // Region on the board, city in the ad (LRN-LOC-6). Passes: מיקום:, cue, place
  // line, bare ב/ל, long name. EXACT city.csv match, else region.
  var RE_LBL = new RegExp('(?:מיקום(?:\\s+המשרה)?|כתובת)' + C, 'g');
  var RE_CUE = new RegExp('(?:העיר|בעיר|באזור|באיזור|לאזור|בסניף|לסניף|בקריית|בקרית|ב' + D + '|ל' + D + ')' + C, 'g');
  var RE_LINE = new RegExp('(?:^|\\n)[ \\t]*(' + ALL + ')[ \\t]*(?=\\n|$)', 'g');
  var RE_BARE = new RegExp(NB + '(?:ב|ל)(' + ALL + ')' + NA, 'g');
  var RE_LOOSE = new RegExp(NB + '(' + LOOSE + ')' + NA, 'g');
  function squash(t) { return t.replace(/[״”“]/g, '"').replace(/[׳’‘]/g, "'"); }
  function mineCities(text) {
    var t = squash(text), out = [], ps = [RE_LBL, RE_CUE, RE_LINE, RE_BARE, RE_LOOSE], i, re, m, v;
    for (i = 0; i < ps.length; i++) {
      re = ps[i]; re.lastIndex = 0;
      while ((m = re.exec(t)) && out.length < 3) { v = canon(m[1]); if (out.indexOf(v) === -1) out.push(v); }
      if (out.length) break;
    }
    return out;
  }
  // LRN-SETUP-10 — two buckets, not "everything after דרישות": 135 ads print a
  // description heading after it.
  var RQ = /^(?:דרישות|כישורים|תנאי\s*סף|מה\s+אנחנו\s+מחפשים|מי\s+מתאים)(?:(?:\s+\S{1,12}){1,2}\s*[:\-–—]|\s*[:\-–—]?)\s*/;
  // Only a DESCRIPTION label switches back, else req sub-heads leak.
  var DH = /(תיאור|התפקיד|המשרה|שעות|ימי עבודה|היקף|תנאים|שכר|מציע|מיקום|פרטים)/;
  var RQIN = /\s(?:דרישות|כישורים(?:\s+נדרשים)?|תנאי\s*סף)(?:\s+\S{1,12})?\s*[:\-–—]\s*/;
  function J(a) { return a.join('\n').replace(/\n{3,}/g, '\n\n').trim(); }
  function splitBody(txt) {
    var lines = txt.split('\n'), d = [], r = [], b = d, i, t, rest, m;
    for (i = 0; i < lines.length; i++) {
      t = lines[i].trim();
      if (RQ.test(t)) {
        rest = t.replace(RQ, '');
        if (t.length < 40 && rest.length < 14 && !/[:\-–—]/.test(t)) rest = '';
        b = r; if (rest) r.push(rest); continue;
      }
      m = RQIN.exec(t); // mid-line label: head stays, tail is req
      if (m) { if (m.index) b.push(t.slice(0, m.index)); b = r; r.push(t.slice(m.index + m[0].length)); continue; }
      if (t && DH.test(t.slice(0, 22)) && (/:/.test(t.slice(0, 24)) || (t.length < 60 && /[:?\-–—]$/.test(t)))) { b = d; d.push(t); continue; }
      b.push(t);
    }
    var ds = d.map(function (x) { return x.trim(); }); // board repeats lines
    return [J(d), J(r.filter(function (x) { return x.trim().length < 25 || ds.indexOf(x.trim()) < 0; }))];
  }
  function decodeEntities(s) {
    if (!s || s.indexOf('&') === -1) return s;
    var t = document.createElement('textarea');
    t.innerHTML = s; return t.value;
  }
  // LRN-SETUP-7/9 — keep line breaks; no added glyphs.
  function stripHtml(html) {
    if (!html) return '';
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    tmp.querySelectorAll('br').forEach(function (n) { n.replaceWith('\n'); });
    tmp.querySelectorAll('p,div,li,tr').forEach(function (n) { n.prepend('\n'); });
    return decodeEntities(tmp.textContent || '')
      .replace(/[ \t]+/g, ' ').replace(/\n[ \t]*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  function mk(cls, text) {
    var e = document.createElement('div');
    e.className = cls; e.style.display = 'none'; e.textContent = text; return e;
  }
  var panels = document.querySelectorAll('.panel.panel-default');
  if (!panels.length) return 0;
  var jobs = []; // the feed sometimes answers HTML; fall back to DOM
  try {
    var resp = await fetch('/wp-admin/admin-ajax.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'action=tb_get_jobs&search=&job_region=&job_code='
    });
    var parsed = await resp.json();
    if (Array.isArray(parsed)) jobs = parsed;
  } catch (e) { jobs = []; }
  var byId = {};
  jobs.forEach(function (j) { if (j && j.id) byId[String(j.id)] = j; });
  var n = 0;
  panels.forEach(function (panel) {
    if (panel.querySelector('.__ai-title')) return; // re-run guard
    var id = null, cb = panel.querySelector('input.form-check-input[value]');
    if (cb) id = (cb.getAttribute('value') || '').trim();
    if (!id) {
      var a = panel.querySelector('.panel-heading a[href*="id="]');
      var mm = a && /[?&]id=(\d+)/.exec(a.getAttribute('href') || '');
      if (mm) id = mm[1];
    }
    if (!id) {
      var hd0 = panel.querySelector('.panel-heading');
      var m2 = hd0 && /-\s*(\d{4,})\s*$/.exec((hd0.textContent || '').trim());
      if (m2) id = m2[1];
    }
    if (!id) return;
    var job = byId[id];
    if (!job) { // heading "title - id", region = 1st text node, body dir=rtl
      var hd = panel.querySelector('.panel-heading'), body = panel.querySelector('.panel-body');
      var rtl = body && body.querySelector('div[dir="rtl"]'), reg = '', nd;
      if (body) for (var k = 0; k < body.childNodes.length; k++) {
        nd = body.childNodes[k];
        if (nd.nodeType == 3 && (nd.textContent || '').trim()) { reg = nd.textContent.trim(); break; }
      }
      job = { header: hd ? (hd.textContent||'').trim().replace(/\s*-\s*\d{4,}\s*$/,'') : '',
        region: reg, category: '', date: '', description: rtl ? rtl.innerHTML : '' };
    }
    var title = (job.header || '').trim();
    if (!title) return;
    var parts = splitBody(stripHtml(job.description || ''));
    var desc = parts[0], req = parts[1];
    var cities = mineCities(title + '\n' + desc + '\n' + req);
    var loc = cities.length ? cities.join(', ') : String(job.region || '').trim();
    panel.appendChild(mk('__ai-title', title));
    panel.appendChild(mk('__ai-jobid', 'tgbr-' + id));
    if (loc) panel.appendChild(mk('__ai-location', loc));
    if (job.category) panel.appendChild(mk('__ai-department', String(job.category).trim()));
    if (desc) panel.appendChild(mk('__ai-description', desc));
    if (req) panel.appendChild(mk('__ai-requirements', req));
    if (job.date) panel.appendChild(mk('__ai-date', String(job.date).slice(0, 10)));
    panel.appendChild(mk('__ai-apply', 'https://tigbur.co.il/new-offer-item/?id=' + id));
    n++;
  });
  return n;
})();
