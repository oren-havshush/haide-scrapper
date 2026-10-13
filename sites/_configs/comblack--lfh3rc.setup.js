// comblack.co.il (Comblack, IT recruiter for unnamed clients). LISTING-ONLY (owner 2026-10-13: the detail walk
// over 293 pages ran out of the 15-min budget). Listing /categories/all/ (all jobs, one page, div.misratestall).
// Each card's body, area tag and date come from the WordPress REST endpoint /wp-json/wp/v2/careers (100 a call)
// and /wp-json/wp/v2/area, all-or-nothing: an error, X-WP-Total unequal to the rows fetched or to the listing's
// card count, or a card with no REST post leaves NO card marked __ai-row (itemSelector), so no rows at all.
// Card: id comblack-N (N = the job's own number: slug, form courceid, printed in some titles) and the title
// without its own trailing number. Body (the post content, laid out the way the detail page's wpautop does:
// blank line = paragraph, line break = <br>) split into description and requirements, apply lines dropped
// (a body with no real text, e.g. just "k", ships empty); publish date = the post's date_gmt (= the detail
// page's JSON-LD datePublished); location (site rule, owner 2026-10-13): the ad's own "ל<org> ב<place>" line
// wins over the area tag only when it names a city; otherwise the tag. Apply: this job's blob, the way the
// detail page's own send_api_data_theme() sends it (multipart POST to admin-ajax.php,
// action=review_vote_ajax_request, courceid = N, havercv = no), pageUrl = the job's own detail page.
// Every injected element carries "wp-exclude-emoji": WordPress's wp-emoji runs asynchronously and would
// otherwise turn emoji inside our spans into <img>, which a text read drops (a random loss of the marks).
var EX = ' wp-exclude-emoji';
var txt = function (el) { // text with wp-emoji images read back as their alt
  var c = el.cloneNode(true);
  c.querySelectorAll('img[alt]').forEach(function (e) { e.replaceWith(e.getAttribute('alt')); });
  return c.textContent || '';
};
if (!document.getElementById('__ai-rest')) {
  var mark = document.createElement('div');
  mark.id = '__ai-rest'; mark.className = EX.trim(); mark.style.display = 'none';
  document.body.appendChild(mark);
  var cards = [].filter.call(document.querySelectorAll('div.misratestall'), function (it) {
    var a = it.querySelector('h2 a');
    return a && /\/careers\/position-(\d+)\/?$/.test(a.getAttribute('href') || '');
  });
  var API = location.origin + '/wp-json/wp/v2/';
  var getJ = function (u) {
    return fetch(API + u).then(function (r) {
      if (!r.ok) throw 0;
      var t = +(r.headers.get('X-WP-Total') || 0);
      return r.json().then(function (j) { if (!Array.isArray(j)) throw 0; return { j: j, t: t }; });
    });
  };
  var POSTS = null, AREAS = null;
  for (var at = 0; at < 2 && !POSTS; at++) {
    try {
      var FL = '&_fields=id,slug,date_gmt,content,area';
      var r1 = await getJ('careers?per_page=100&page=1' + FL), tot = r1.t, more = [];
      for (var pg = 2; (pg - 1) * 100 < tot; pg++) more.push(getJ('careers?per_page=100&page=' + pg + FL));
      more.push(getJ('area?per_page=100&_fields=id,slug'));
      var rs = await Promise.all(more);
      var ar = rs.pop().j;
      var all = r1.j.concat.apply(r1.j, rs.map(function (x) { return x.j; }));
      if (tot > 0 && all.length === tot && tot === cards.length) { POSTS = all; AREAS = ar; }
    } catch (e) { POSTS = null; }
  }
  var BYN = {}, ASLUG = {};
  (POSTS || []).forEach(function (p) { var m = String(p.slug || '').match(/^position-(\d+)$/); if (m) BYN[m[1]] = p; });
  (AREAS || []).forEach(function (a) { ASLUG[a.id] = a.slug; });
  // wpautop, as the detail page renders the post content: blank line(s) = new paragraph, a single line break = <br />
  var autop = function (s) {
    s = String(s || '').replace(/\r\n?/g, '\n').replace(/^\s+|\s+$/g, '');
    if (!s) return '';
    return s.split(/\n\s*\n/).map(function (p) { return '<p>' + p.replace(/^\s+|\s+$/g, '').replace(/[^\S\n]*\n/g, '<br />\n') + '</p>'; }).join('\n');
  };
  var build = function (post, holder) {
    var add = function (cls, v) { if (!v) return; var s = document.createElement('span'); s.className = cls + EX; s.textContent = v; holder.appendChild(s); };
    // The REST content is wptexturize'd and the detail page's body is not: there an ASCII "-" between spaces is
    // the entity &#8211; (a dash typed as "–" stays a raw character). Turned back so the text is the page's.
    var raw = String((post.content && post.content.rendered) || '').split('&#8211;').join('-');
    var c = new DOMParser().parseFromString(autop(raw), 'text/html').body;
    c.querySelectorAll('.sharewhatsapp,script,style').forEach(function (e) { e.remove(); });
    c.querySelectorAll('input').forEach(function (e) { e.replaceWith(' ' + (e.getAttribute('value') || '')); });
    c.querySelectorAll('img[alt]').forEach(function (e) { e.replaceWith(e.getAttribute('alt')); });
    c.querySelectorAll('br').forEach(function (e) { e.replaceWith('\n'); });
    c.querySelectorAll('p,div,ul,ol,li,h1,h2,h3,h4,h5,h6').forEach(function (e) { e.insertAdjacentText('afterend', '\n\n'); });
    var NB = String.fromCharCode(160);
    var lines = c.textContent.split(NB).join(' ').split('\n').map(function (s) { return s.trim(); });
    var REQH = /^[^\p{L}\d]*(\d+\.?\s*)?(מה אנחנו מחפשים|דרישות(\s+(חובה|מרכזיות|התפקיד))?|מה חשוב לנו|מה נדרש|יתרון(\s+משמעותי)?|יתרונות|השכלה והסמכות)\s*[?:!]?\s*(\(([^)]*)\))?\s*$/u;
    var DESCH = /^[^\p{L}\d]*(התפקיד כולל|מה בתפקיד|מה כולל התפקיד|מה התפקיד כולל|התפקיד משלב|תיאור (ה)?תפקיד|תחומי אחריות עיקריים|במסגרת התפקיד|מה עושים בתפקיד|מה עושים אצלנו|מה אנחנו מציעים)\s*[?:!]?\s*$/u;
    var CTA = /^[^\p{L}\d]*(מעוניינ|מעוניין\/ת|מתאימים\?|נשמע (מתאים|מעניין)\?|שלחו|מוזמנים לשלוח|חושבים שאתם מתאימים|נשמח לקבל קורות)/u;
    var REQW = /^[^\p{L}\d]*(יתרון|ניסיון|תואר|ידע|היכרות|הכרות|שליטה|יכולת|נכונות|הסמכ|השכלה|מחפשים מועמד|נדרש|לפחות|\d[\d–+-]*\s*שנ|רקע|אנגלית|רישיון|זמינות|בעל)/u;
    var BUL = /^[^\p{L}\d]/u, PITCH = /^(אם |מחפש\/ת )/u;
    var hasH = lines.some(function (l) { return l.length < 80 && REQH.test(l); });
    var mv = {};
    if (!hasH) {
      for (var x = 0; x < lines.length;) {
        if (lines[x] && BUL.test(lines[x])) {
          var k = x, e2 = x;
          while (k < lines.length && (!lines[k] || BUL.test(lines[k]))) { if (lines[k]) e2 = k + 1; k++; }
          k = e2;
          var run = lines.slice(x, k).filter(function (s) { return s; });
          if (run.length >= 2 && run.filter(function (s) { return REQW.test(s); }).length * 2 >= run.length) for (var q = x; q < k; q++) mv[q] = 1;
          x = k;
        } else x++;
      }
    }
    var d = [], r = [], st = 'd', gap = false;
    lines.forEach(function (l, n) {
      if (!l) { (st === 'r' ? r : d).push(''); gap = true; return; }
      if (l.length < 100 && CTA.test(l)) return;
      var h = l.length < 80 && l.match(REQH);
      if (h) { st = 'r'; gap = false; if (h[6]) r.push(h[6]); return; }
      if (l.length < 60 && DESCH.test(l)) { st = 'd'; gap = false; if (/^[^\p{L}\d]*תיאור/u.test(l)) return; }
      else if (st === 'r' && (PITCH.test(l) || (gap && r.some(function (s) { return s; }) && !BUL.test(l) && !REQW.test(l)))) st = 'd';
      gap = false;
      if (mv[n]) { r.push(l); return; }
      (st === 'r' ? r : d).push(l);
    });
    var join = function (arr) { return arr.join('\n').replace(/\n{3,}/g, '\n\n').trim(); };
    var desc = join(d), req = join(r);
    if (desc.replace(/[^\p{L}]/gu, '').length < 3) desc = '';

    // location (site rule, owner 2026-10-13): the ad's own placing line wins over the tag (area term slug)
    // ONLY when it names a city (PL rows marked 1); a region word alone ("במרכז", "בצפון", "באיו"ש") keeps
    // the tag, and is used only when there is no tag. Values verbatim city.csv rows.
    // The tag "ירושלים יו"ש" is a region: אזור ירושלים (owner 2026-10-13).
    var TAG = { 'gush-dan': ['אזור מרכז'], 'hashfela': ['אזור שפלה'], 'hasharon': ['אזור השרון'], 'north': ['אזור צפון'], 'south': ['אזור דרום'], 'haifa': ['חיפה', 'אזור צפון'], 'jerusalem': ['אזור ירושלים'] };
    var PL = [
      [/(^|\s)ב(אזור |איזור )?חיפה והקריות/, ['חיפה', 'אזור צפון'], 1],
      [/(^|\s)ב(אזור |איזור )?ירושלים|(^|\s)בירשלים|(^|\s)ב[^\s/]+( [^\s/]+)?\/ירושלים/, ['ירושלים'], 1],
      [/(^|\s)בתל אביב/, ['תל אביב-יפו'], 1],
      [/(^|\s)בבני ברק/, ['בני ברק'], 1],
      [/(^|\s)ב(אזור |איזור )?ראשון לציון/, ['ראשון לציון'], 1],
      [/(^|\s)באזור חדרה/, ['חדרה'], 1],
      [/(^|\s)באיו"ש/, ['אזור יהודה ושומרון']],
      [/(^|\s)ב(אזור |איזור )?(ה)?מרכז( הארץ)?([\s!.,]|$)/, ['אזור מרכז']],
      [/(^|\s)(ב|ל)(אזור |איזור )?(ה)?צפון( הארץ)?([\s!.,]|$)/, ['אזור צפון']],
      [/(^|\s)ב(אזור |איזור )?(ה)?דרום([\s!.,]|$)/, ['אזור דרום']],
      [/(^|\s)ב(אזור |איזור )?(ה)?שפלה([\s!.,]|$)/, ['אזור שפלה']],
      [/(^|\s)ב(אזור |איזור )?(ה)?שרון([\s!.,]|$)/, ['אזור השרון']]
    ];
    var slug = (post.area || []).length ? ASLUG[post.area[0]] : null; // the detail page's first "אזור:" link
    var tag = (slug && TAG[slug]) || [];
    var cue = lines.filter(function (l) { return l; }).slice(0, 3).filter(function (l) { return /(ל|ב)(ארגון|חברת|חברה|משרד|תעשי|בנק)/.test(l) && !/שטח|ברחבי הארץ|פריסה ארצית/.test(l); })[0] || '';
    var P = [], R = [];
    PL.forEach(function (p) { var to = p[2] ? P : R; if (p[0].test(cue)) p[1].forEach(function (v) { if (to.indexOf(v) < 0) to.push(v); }); });
    var loc = P.length ? P : tag.length ? tag : R.length ? R : ['Unknown'];
    add('__ai-description', desc);
    add('__ai-requirements', req);
    add('__ai-location', loc.join(', '));
    add('__ai-publishDate', post.date_gmt ? post.date_gmt + '+00:00' : '');
    return add;
  };

  // apply: the detail page's "שלח" runs send_api_data_theme(), which renames the form's fields and posts them
  // by AJAX (the form's own action is never used), in this order. Required as the page validates (.must1).
  var fld = function (name, label, type, req, value) {
    var o = { name: name, label: label, tagName: 'INPUT', required: req, fieldType: type };
    if (value !== undefined) o.value = value;
    return o;
  };
  var ajax = location.origin + '/wp-admin/admin-ajax.php';
  var done = [];
  try {
    if (!POSTS) throw 0;
    cards.forEach(function (it) {
      var a = it.querySelector('h2 a');
      var m = (a.getAttribute('href') || '').match(/\/careers\/position-(\d+)\/?$/);
      var post = BYN[m[1]];
      if (!post || done.some(function (x) { return x[2] === m[1]; })) throw 0;
      var box = document.createElement('div');
      box.className = '__ai-card' + EX; box.style.display = 'none';
      var sp = document.createElement('span');
      sp.className = '__ai-id' + EX; sp.textContent = 'comblack-' + m[1];
      box.appendChild(sp);
      var t = document.createElement('span');
      t.className = '__ai-title' + EX;
      t.textContent = txt(a).trim().replace(new RegExp('\\s*[-–]?\\s*' + m[1] + '\\s*$'), '').trim();
      box.appendChild(t);
      var add = build(post, box);
      add('__ai-formData', JSON.stringify({ actionUrl: ajax, actionAttribute: ajax, pageUrl: new URL(a.getAttribute('href'), location.href).href, method: 'POST', enctype: 'multipart/form-data', fields: [
        fld('file', 'קובץ קורות חיים', 'file', false),
        fld('action', '', 'hidden', false, 'review_vote_ajax_request'),
        fld('fname', 'שם', 'text', true),
        fld('email', 'אימייל', 'email', true),
        fld('phone', 'טלפון', 'tel', true),
        fld('courceid', '', 'hidden', false, m[1]),
        fld('havercv', '', 'hidden', false, 'no')
      ] }));
      done.push([it, box, m[1]]);
    });
  } catch (e) { done = []; }
  done.forEach(function (x) { x[0].appendChild(x[1]); x[0].classList.add('__ai-row'); });
}
