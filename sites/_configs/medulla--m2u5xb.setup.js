await (async function () {
  if (document.getElementById('haide-jobs-root') || !/\/new-jobs\//.test(location.pathname)) return;
  var hash = function (s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); };
  var parse = function (html) { return new DOMParser().parseFromString(html, 'text/html'); };
  var get = function (u) { return fetch(u, { credentials: 'omit' }).then(function (r) { return r.ok ? r.text() : ''; }).catch(function () { return ''; }); };
  // term id -> city.csv entry; anything unmapped is dropped (LRN-LOC-4).
  var LOC = { 568: 'חיפה', 572: 'בית דגן', 582: 'רמת גן', 589: 'תל אביב-יפו', 591: 'הרצליה', 596: 'נס ציונה', 599: 'נתניה', 625: 'כפר סבא', 636: 'אור יהודה', 640: 'פתח תקווה', 641: 'בית שמש', 653: 'הוד השרון', 665: 'רמלה לוד', 666: 'ראש העין', 671: 'קיסריה', 702: 'יבנה', 970: 'באר שבע', 973: 'בני ברק', 974: 'בת-ים', 975: 'חדרה', 976: 'מודיעין', 977: 'ראשון לציון', 978: 'חולון', 979: 'ירושלים', 980: 'רחובות', 1742: 'יוקנעם', 1763: 'רעננה', 1800: 'גבעתיים', 1825: 'אזור צפון', 1893: 'פריסה ארצית', 2032: 'גבעת שמואל', 2041: 'איירפורט סיטי', 2181: 'בית יהושע', 2213: 'אזור השרון', 2269: 'אזור השרון' };
  var ZW = new RegExp('[' + String.fromCharCode(0x200b) + '-' + String.fromCharCode(0x200f) + String.fromCharCode(0xfeff) + ']', 'g');

  // 1. Only the cards a visitor sees; unlinked jsf pages are hidden jobs (LRN-COV-9).
  var MATH = new RegExp('[' + String.fromCodePoint(0x1D400) + '-' + String.fromCodePoint(0x1D7FF) + ']', 'gu');
  var cards = [], seen = {};
  var take = function (doc) {
    var arts = doc.querySelectorAll('article.elementor-post.noo_job');
    for (var i = 0; i < arts.length; i++) {
      var a = arts[i], link = a.querySelector('.elementor-post__title a');
      if (!link || seen[link.href]) continue;
      seen[link.href] = 1;
      var locs = [], m, re = /\bjob_location-(\d+)\b/g;
      while ((m = re.exec(a.className))) { var v = LOC[m[1]]; if (v && locs.indexOf(v) < 0) locs.push(v); }
      // math-bold letters -> plain (LRN-LANG-2)
      var title = (link.textContent || '').trim().replace(MATH, function (ch) { return ch.normalize('NFKC'); });
      cards.push({ href: link.href, title: title, locs: locs });
    }
  };
  take(document);

  // 2. Body + date from the RSS feed.
  var feed = {}, stop = false;
  var need = function () { return cards.some(function (c) { return !feed[c.href]; }); };
  for (var fp = 1; fp <= 150 && !stop && need(); fp += 12) {
    var batch = [];
    for (var b = fp; b < fp + 12; b++) batch.push(get('/jobs/feed/?paged=' + b));
    (await Promise.all(batch)).forEach(function (x) {
      var its = x ? new DOMParser().parseFromString(x, 'text/xml').getElementsByTagName('item') : [];
      if (!its.length) { stop = true; return; }
      for (var k = 0; k < its.length; k++) {
        var tag = function (n) { var e = its[k].getElementsByTagName(n)[0]; return e ? (e.textContent || '').trim() : ''; };
        var href = tag('link');
        if (href) feed[href] = { html: tag('content:encoded'), date: tag('pubDate') };
      }
    });
  }
  // 3. Feed paging skips posts sharing a date; fetch those.
  var miss = cards.filter(function (c) { return !feed[c.href]; }).slice(0, 40);
  await Promise.all(miss.map(function (c) {
    return get(c.href).then(function (h) {
      if (!h) return;
      var d = parse(h), body = d.querySelector('.elementor-widget-theme-post-content .elementor-widget-container') || d.querySelector('.elementor-widget-theme-post-content');
      var dm = h.match(/"datePublished":"([^"]+)"/);
      if (body) feed[c.href] = { html: body.innerHTML, date: dm ? dm[1] : '' };
    });
  }));

  // 4. Body -> lines -> description / requirements.
  var lines = function (html) {
    var d = parse('<div>' + html + '</div>').body;
    d.querySelectorAll('script,style').forEach(function (n) { n.remove(); });
    d.querySelectorAll('p').forEach(function (n) { if (/appeared first on/.test(n.textContent)) n.remove(); });
    d.querySelectorAll('br').forEach(function (n) { n.replaceWith('\n'); });
    d.querySelectorAll('li').forEach(function (li) { if (!li.querySelector('ul,ol') && (li.textContent || '').trim()) li.prepend('\n• '); });
    d.querySelectorAll('p,div,li,ul,ol,h1,h2,h3,h4,h5,h6,tr,blockquote').forEach(function (n) { n.append('\n'); });
    return d.textContent.replace(ZW, '').replace(/([.!?])\s*((דרישות( התפקיד| חובה)?|Requirements)\s*:)/g, '$1\n$2').split('\n').map(function (s) { return s.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
  };
  var REQ = /^(דרישות( חובה| התפקיד| מרכזיות| עיקריות)?|requirements( \(must-have\))?|qualifications|(מה )?תביאו אתכם[.\/]?ן?)\s*[:\-–]?\s*/i;
  var ADV = /^(יתרון|יתרונות|דרישות יתרון|advantage|advantages|nice to have|advanced skills|נחמד אם|ניסיון בבאים)/i;
  var DESC = /^(על החברה|על הארגון|על התפקיד|התפקיד כולל|responsibilities|תיאור התפקיד|תנאים|המיקום שלנו|מיקום|שכר|היקף|תחילת עבודה|סוג משרה|שעות|ימי עבודה)/i;
  var APPLY = /(לשלוח|שלחו|שליחת|שולחים|אשמח לקבל|אשמח לפניות)[^.]{0,25}(קו["״']ח|קורות חיים)|(קו["״']ח|קורות חיים)[^.]{0,10}(שולחים|לשלוח|שלחו)/;
  var INREQ = /^חובה\s|[-–]\s*(חובה|יתרון)[.!]?$/;
  // Where/how the job is worked is description, not a requirement.
  var WHERE = /היבריד|מהבית|מהמשרד|המשרדים|במשרדי|ימי עבודה/, SKILL = /ניסיון|תואר|ידע|יכולת|היכרות|הכרות|נכונות/;
  var root = document.createElement('div');
  root.id = 'haide-jobs-root';
  root.style.display = 'none';
  var add = function (el, cls, text, attr) { var s = document.createElement(attr ? 'a' : 'span'); s.className = cls; s.textContent = text; if (attr) s.setAttribute('href', attr); el.appendChild(s); };
  var LANG_OK = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, LANG_BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
  cards.forEach(function (c) {
    var f = feed[c.href];
    if (!f || !c.title || !LANG_OK.test(c.title) || LANG_BAD.test(c.title)) return;
    var dl = [], rl = [], notes = [], bucket = 'd', email = '';
    lines(f.html).forEach(function (t) {
      var em = t.match(/[\w.+-]+@medulla\.co\.il/i);
      if (em) { if (!email) email = em[0]; bucket = 'd'; return; } // recruiter apply line
      if (/^(קו["״']ח|קורות חיים)\s*:?$/.test(t)) return;
      if (APPLY.test(t)) { notes.push(t); bucket = 'd'; return; }
      var n = t.replace(/^[•*\-–]\s*/, ''), short = n.length < 50;
      if (short && REQ.test(n) && !ADV.test(n)) { bucket = 'r'; t = n.replace(REQ, ''); if (!t) return; }
      else if (short && ADV.test(n)) bucket = 'r';
      else if (DESC.test(n) && (short || /^(מיקום|שכר|היקף|תחילת עבודה)/.test(n))) { bucket = 'd'; if (/^תיאור התפקיד\s*:?$/.test(n)) return; }
      else if (bucket === 'd' && INREQ.test(n)) { rl.push(t); return; }
      else if (bucket === 'r' && n.length <= 80 && WHERE.test(n) && !SKILL.test(n)) { dl.push(t); return; }
      (bucket === 'r' ? rl : dl).push(t);
    });
    if (!email) dl = dl.concat(notes);
    var job = document.createElement('div');
    job.setAttribute('data-haide-job', '1');
    add(job, '__ai-title', c.title);
    add(job, '__ai-link', c.title, c.href);
    // ASCII slug, else hash of the slug (LRN-ID-6)
    var slug = decodeURIComponent(c.href.replace(/\/$/, '').split('/').pop());
    add(job, '__ai-jobid', 'medulla-' + (/^[\x21-\x7e]+$/.test(slug) ? slug : hash(slug)));
    add(job, '__ai-location', c.locs.length ? c.locs.join(', ') : 'Unknown');
    add(job, '__ai-description', dl.join('\n'));
    if (rl.length) add(job, '__ai-requirements', rl.join('\n'));
    var dt = new Date(f.date);
    if (!isNaN(dt)) add(job, '__ai-date', dt.toISOString());
    // only "what to include" follows the address (owner)
    notes = notes.filter(function (s) { return /בצירוף|בציון|לציין|לצרף/.test(s); });
    if (email) add(job, '__ai-apply', 'mailto:' + email + (notes.length ? ' - ' + notes.join(' ') : ''));
    root.appendChild(job);
  });
  document.body.appendChild(root);
})();
