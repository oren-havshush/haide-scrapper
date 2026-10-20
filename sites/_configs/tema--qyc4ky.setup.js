/* TEMA מכון תימה (tema.co.il), a recruiter: every job is a Wix Blog post on /דרושים (infinite scroll, 20 per
   feed page). Published under Tema's own name; the client is never named. Listing-only.
   - Jobs: the blog feed exactly as the listing pages it, read from the server-rendered feed pages /דרושים and
     /דרושים/page/N (the same pages the infinite scroll loads, 20 per page; wix-warmup-data JSON), until a page
     has no next cursor. Then each job's own post page (/post/<slug>) for the full text, 4 at a time.
   - Id: the printed job number "JB-<n>" of the title -> tema-<n> (addsite3 id rule, LRN-ID-11). A title with no
     number falls back to the body's "מספר המשרה <n>"; neither -> no id (the worker builds h-<hash>).
   - Title: the post title without its "JB-<n>" (rule 7). Department: the post's blog categories, as printed.
   - Body: "תיאור התפקיד:" label dropped; "דרישות התפקיד:" opens requirements (label dropped): list items and
     bullet lines stay requirements, the first plain line after them returns to description. The apply line
     ("*להגשת מועמדות נא להעתיק את מספר המשרה <n> ...") and the "שלח קורות חיים" link line are dropped: the
     form blob below carries the number in the form's own job-number field.
   - Location: a raw place label (" | " between several), read only from work-location cue lines: the line after
     "מיקום והיקף משרה:", then a line about where the work/job is ("העבודה ב", "המשרה ב", "במשרדי החברה ב"),
     then the hiring-company intro line ("ל... ב<place> דרוש", "לסניף ..."; for a recruiter it says where the
     job is, owner 2026-10-20), then a city named in the title (a region word in the title does not count).
     The config locationMap turns each label into a city.csv row; a label it lacks is dropped and the job is
     Unknown. Never the recruiter's own office (Netanya).
   - Date: the post's firstPublishedDate as an Israel date, only when the post slug ends with this job's
     number (LRN-AGE-6: a re-titled older post carries the old post's date) -> else undated.
   - Apply: the site's one CV form at /cv-send (Wix Forms), read from that page's form schema each run, as a
     per-job blob with the job number filled into the form's "מס' משרה אם ידוע" field. No consent box is
     pre-checked; the consent group (3 boxes, one marketing) is required. Wix submits through its own
     form-submission API and can open a captcha challenge on submit (spamFilterProtectionLevel ADVANCED).
   - Language gate: Hebrew, English or Arabic titles only.
   ALL-OR-NOTHING: every fetch is credentials:'omit' with a 20 s limit; a failed, timed-out, non-2xx or
   unparsable feed page, post page or form page builds no row at all. */

var NL = String.fromCharCode(10);
/* fromCharCode, never escapes in this file (CLAUDE.md). */
var ZW = new RegExp('[' + String.fromCharCode(0xFEFF, 0x200B, 0x200C, 0x200D, 0x2060, 0x200E, 0x200F) + ']', 'g');
var NBSP = new RegExp(String.fromCharCode(0x00A0), 'g');
var GERSH = new RegExp('[' + String.fromCharCode(0x05F4, 0x201D, 0x201C) + ']', 'g');
var BULLET = new RegExp('^[' + String.fromCharCode(0x2022, 0x00B7, 0x25CF) + ']');
var OK = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}]/u;
var BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var HEB = /\p{sc=Hebrew}/u;
var BLOG = '14bcded7-0066-7c35-14d7-466cb3f09103';
var FORMS = '225dd912-7dea-4738-8688-4b8c6955ffc2';
var LIST = location.origin + '/%D7%93%D7%A8%D7%95%D7%A9%D7%99%D7%9D';
var CV = location.origin + '/cv-send';
var PAGE_SIZE = 20;
var DESC_LABEL = /^תיאור התפקיד\s*:?$/;
var REQ_HEAD = /^דרישות(\s+(התפקיד|הפקיד|המשרה))?\s*:?$/;
var LOC_HEAD = /^(מיקום והיקף (ה)?משרה|היקף ומיקום (ה)?משרה|מיקום (ה)?משרה|מקום העבודה|מיקום)\s*:?$/;
var APPLY_LINE = /^\*?\s*להגשת מועמדות/;
/* Place labels the cue lines may name, longest first. The config locationMap holds the same labels. */
var PLACES = ['פריסה ארצית', 'כל הארץ', 'מישור אדומים', 'קריית שמונה', 'פתח תקווה', 'באר יעקב', 'נווה אילן', 'תל אביב',
  'ירושלים', 'מודיעין', 'בת ים', 'חולון', 'חדרה', 'חיפה', 'שלומי', 'ת"א', 'המרכז', 'השפלה', 'מרכז', 'שפלה', 'צפון', 'דרום'];
var REGIONS = ['המרכז', 'השפלה', 'מרכז', 'שפלה', 'צפון', 'דרום', 'פריסה ארצית', 'כל הארץ'];

function clean(t) { return String(t || '').replace(ZW, '').replace(NBSP, ' ').replace(/[ \t]+/g, ' ').trim(); }

async function get(url) {
  var ac = new AbortController();
  var timer = setTimeout(function () { ac.abort(); }, 20000);
  try {
    var r = await fetch(url, { credentials: 'omit', cache: 'no-store', signal: ac.signal });
    if (!r.ok) throw new Error(r.status + ' ' + url);
    var h = await r.text();
    if (h.length < 5000) throw new Error('short page ' + url);
    return new DOMParser().parseFromString(h, 'text/html');
  } finally { clearTimeout(timer); }
}

function warm(doc, app) {
  var s = doc.getElementById('wix-warmup-data');
  if (!s) throw new Error('no warmup data');
  var a = JSON.parse(s.textContent).appsWarmupData[app];
  if (!a) throw new Error('no app data ' + app);
  return a;
}

/* The place label(s) right after "ב" (or "באזור "/"באיזור ") in a line, from PLACES only. */
function placesAfterBet(line, allowNation) {
  var t = ' ' + line.replace(GERSH, '"') + ' ', out = [];
  for (var i = 1; i < t.length; i++) {
    if (t.charAt(i) !== 'ב' || HEB.test(t.charAt(i - 1))) continue;
    var rest = t.slice(i + 1).replace(/^(אזור|איזור)\s+/, '');
    for (var k = 0; k < PLACES.length; k++) {
      var p = PLACES[k];
      if (rest.indexOf(p) !== 0 || HEB.test(rest.charAt(p.length))) continue;
      if (!allowNation && (p === 'פריסה ארצית' || p === 'כל הארץ')) break;
      out.push(p);
      var more = rest.slice(p.length).match(/^\s*-\s*(\S+(\s\S+)?)/);
      if (more) for (var m = 0; m < PLACES.length; m++) if (more[1].indexOf(PLACES[m]) === 0 && !HEB.test(more[1].charAt(PLACES[m].length))) { out.push(PLACES[m]); break; }
      break;
    }
    if (out.length) return out;
  }
  return out;
}

function findLocation(lines, title) {
  /* 1) the line under a location heading: its text up to the first comma or bracket */
  for (var i = 0; i < lines.length - 1; i++) {
    if (LOC_HEAD.test(lines[i].t)) return [clean(lines[i + 1].t.split(/[,(]/)[0]).replace(GERSH, '"')];
  }
  /* 2) a line about where the work is */
  for (var j = 0; j < lines.length; j++) {
    if (!/(^|\s)(העבודה|המשרה|במשרדי החברה)(\s|$)/.test(lines[j].t)) continue;
    var w = placesAfterBet(lines[j].t, true);
    if (w.length) return w;
  }
  /* 3) the hiring-company intro line: the first line that starts with "ל" and says "דרוש". For a recruiter it
     says where the job is (owner, 2026-10-20). */
  for (var n = 0; n < lines.length; n++) {
    var L = lines[n].t;
    if (L.charAt(0) !== 'ל' || !/דרוש/.test(L)) continue;
    /* a branch named in the line ("לסניף דרום", "לסניף בשפלה") places the job, not the company's spread */
    var br = L.match(/(^|\s)לסניף\s+(צפון|דרום|מרכז|שפלה|המרכז|השפלה)(?!\p{sc=Hebrew})/u);
    if (br) return [br[2]];
    var bi = L.indexOf('לסניף');
    if (bi >= 0) { var sb = placesAfterBet(L.slice(bi), false); if (sb.length) return sb; }
    var ip = placesAfterBet(L, false);
    if (ip.length) return ip;
    break;
  }
  /* 4) a city named in the title ("ב<city>"); a region word in the title is not a cue (owner, 2026-10-20) */
  return placesAfterBet(title, false).filter(function (p) { return REGIONS.indexOf(p) < 0; });
}

function blockLines(root) {
  var out = [], blocks = root.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li');
  for (var i = 0; i < blocks.length; i++) {
    var b = blocks[i];
    if (b.tagName === 'P' && b.closest('li')) continue;
    var a = b.querySelector('a[href*="/cv-send"]');
    if (a && clean(a.textContent) === clean(b.textContent)) continue;
    var c = b.cloneNode(true), brs = c.querySelectorAll('br');
    for (var k = 0; k < brs.length; k++) brs[k].replaceWith(NL);
    var parts = c.textContent.split(NL);
    for (var j = 0; j < parts.length; j++) {
      var t = clean(parts[j]);
      if (t) out.push({ t: t, li: b.tagName === 'LI' || BULLET.test(t) });
    }
  }
  return out;
}

if (!document.getElementById('haide-tema')) {
  var built = [];
  try {
    /* 1) the feed, page by page, as the listing's infinite scroll loads it */
    var posts = [], cats = {};
    for (var pg = 1; ; pg++) {
      if (pg > 10) throw new Error('more than 10 feed pages');
      var fd = await get(pg === 1 ? LIST : LIST + '/page/' + pg);
      var bw = warm(fd, BLOG), key = Object.keys(bw)[0];
      var fp = JSON.parse(bw[key]).feedResponse.postFeedPage;
      var pp = fp.posts.posts || [], meta = fp.posts.pagingMetaData || {};
      var cl = fp.categories || [];
      for (var c = 0; c < cl.length; c++) cats[cl[c].id] = clean(cl[c].label);
      if (!pp.length || pp.length !== meta.count) throw new Error('feed page ' + pg + ': ' + pp.length + ' posts, count ' + meta.count);
      posts = posts.concat(pp);
      if (!(meta.cursors && meta.cursors.next)) break;
      if (pp.length !== PAGE_SIZE) throw new Error('feed page ' + pg + ' is short but has a next page');
    }
    console.log('[tema] feed: ' + posts.length + ' posts');

    /* 2) the apply form, from /cv-send's own form schema */
    var fw = warm(await get(CV), FORMS), form = null;
    for (var fk in fw) { var fb = fw[fk] && fw[fk].formsById; if (fb) { var ids = Object.keys(fb); if (ids.length === 1) form = fb[ids[0]]; } }
    if (!form || !form.fields) throw new Error('no form schema on /cv-send');
    var FT = { CONTACTS_FIRST_NAME: 'text', CONTACTS_EMAIL: 'email', CONTACTS_PHONE: 'tel', DROPDOWN: 'select', NUMBER_INPUT: 'number', FILE_UPLOAD: 'file', CHECKBOX_GROUP: 'checkbox', TEXT_INPUT: 'text', CONTACTS_LAST_NAME: 'text', PARAGRAPH: 'textarea' };
    var fields = [], numField = '', hasFile = false;
    for (var q = 0; q < form.fields.length; q++) {
      var F = form.fields[q], v = F.view || {};
      if (!F.target || !v.fieldType || F.hidden) continue;
      var ty = FT[v.fieldType];
      if (!ty) throw new Error('unknown form field type ' + v.fieldType);
      var fo = { name: F.target, label: clean(v.label), fieldType: ty, required: !!(F.validation && F.validation.required), tagName: ty === 'select' ? 'SELECT' : ty === 'textarea' ? 'TEXTAREA' : 'INPUT' };
      if (v.options && v.options.length) fo.options = v.options.map(function (o) { return { value: String(o.value), label: clean(o.label) }; });
      if (ty === 'number' && /משרה/.test(fo.label)) numField = F.target;
      if (ty === 'file') hasFile = true;
      fields.push(fo);
    }
    if (!numField || !hasFile) throw new Error('the CV form has no job-number field or no file field');

    /* 3) each post's own page, 4 at a time */
    var pages = [];
    for (var g = 0; g < posts.length; g += 4) {
      pages = pages.concat(await Promise.all(posts.slice(g, g + 4).map(function (p) {
        return get(new URL(p.url.path, location.origin).href);
      })));
    }

    for (var x = 0; x < posts.length; x++) {
      var P = posts[x], raw = clean(P.title);
      if (!raw || !OK.test(raw) || BAD.test(raw)) { console.log('[tema] language gate drops ' + raw); continue; }
      var root = pages[x].querySelector('[data-hook="post-description"]');
      if (!root) throw new Error('no post body ' + P.slug);
      var lines = blockLines(root);
      if (!lines.length) throw new Error('empty post body ' + P.slug);
      var tm = raw.match(/JB\s*-?\s*(\d{3,})/i), num = tm ? tm[1] : '';
      var title = clean(raw.replace(/\s*[-–]?\s*\(?\s*JB\s*-?\s*\d{3,}\s*\)?\s*$/i, ''));
      var desc = [], req = [], mode = 'd', bodyNum = '';
      for (var y = 0; y < lines.length; y++) {
        var Ln = lines[y];
        if (APPLY_LINE.test(Ln.t)) { var bm = Ln.t.match(/(\d{3,})/); if (bm) bodyNum = bm[1]; continue; }
        if (DESC_LABEL.test(Ln.t)) continue;
        if (REQ_HEAD.test(Ln.t)) { mode = 'r'; continue; }
        if (mode === 'r' && !Ln.li) mode = 'd';
        (mode === 'r' ? req : desc).push(Ln.t);
      }
      if (!num) num = bodyNum;
      if (num && bodyNum && num !== bodyNum) console.log('[tema] ' + P.slug + ': title number ' + num + ', body number ' + bodyNum);
      var date = '', slug = decodeURIComponent(String(P.slug || '')).toLowerCase();
      if (num && new RegExp('(^|-)jb-' + num + '$').test(slug) && P.firstPublishedDate) {
        date = new Date(P.firstPublishedDate).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
      } else console.log('[tema] ' + (num || P.slug) + ': slug does not end with its number, left undated');
      var loc = findLocation(lines, raw);
      var dept = (P.categoryIds || []).map(function (id) { return cats[id] || ''; }).filter(Boolean).join(', ');
      var jf = fields.map(function (f) {
        var o = JSON.parse(JSON.stringify(f));
        if (f.name === numField && num) { o.value = num; o.prefilled = true; }
        return o;
      });
      built.push({
        id: num ? 'tema-' + num : '', title: title, href: new URL(P.url.path, location.origin).href, date: date, dept: dept,
        loc: loc.join(' | '), desc: desc.join(NL), req: req.join(NL),
        blob: JSON.stringify({ actionUrl: CV, actionAttribute: '', method: 'POST', enctype: 'application/json', fields: jf })
      });
    }
    if (!built.length) throw new Error('no job kept');
  } catch (err) {
    console.log('[tema] no rows: ' + err);
    built = [];
  }

  var box = document.createElement('div');
  box.id = 'haide-tema';
  box.style.display = 'none';
  for (var r = 0; r < built.length; r++) {
    var J = built[r], row = document.createElement('div');
    row.className = 'haide-job';
    var a1 = document.createElement('a');
    a1.className = 'haide-link';
    a1.href = J.href;
    a1.textContent = J.title;
    row.appendChild(a1);
    var put = function (cls, val, tag) { if (!val) return; var s = document.createElement(tag || 'span'); s.className = cls; s.textContent = val; row.appendChild(s); };
    put('__ai-externalJobId', J.id);
    put('__ai-department', J.dept);
    put('__ai-location', J.loc);
    put('__ai-publishDate', J.date);
    put('__ai-description', J.desc, 'div');
    put('__ai-requirements', J.req, 'div');
    put('__ai-applicationInfo', J.blob, 'div');
    put('__ai-formData', J.blob, 'div');
    box.appendChild(row);
  }
  document.body.appendChild(box);
}
