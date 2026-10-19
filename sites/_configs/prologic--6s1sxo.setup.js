// prologic.co.il/High-tech-jobs: a hub of 9 categories + ~52 subcategories (61 listing pages, no paging); each page prints
// its jobs in full, one job may sit on several pages. Over 10 pages, so this script fetches every page the hub links and
// builds one list, all-or-nothing (LRN-CO-4): any failed/redirected page, or one without the listing
// frame, empties the list -> empty_results, nothing deleted. A page with 0 jobs is normal here (ruby, php...).
// Time (2026-10-19 nightly reply): 6 fetches in flight, 60 s per attempt (a Cloudflare 524 comes at ~100 s; pages took
// up to 50 s under load on 2026-10-19), 2 attempts per page, no new attempt after 220 s, so the last one ends by 280 s,
// inside the stored 300 s limit: the script ends by itself instead of being cut off. Each page is parsed as it
// answers into a hidden box per page (#haide-jobs-staging, outside the item selector); the boxes move under
// #haide-jobs-root, in hub order (the first row per job is the one the worker keeps), only when every page answered.
// The job text comes from the category pages themselves: the script reads no job page.
// externalJobId: the CMS record id the job's own form sends (cmsId) -> prologic-<cmsId>. No id -> none (worker hashes).
// Body: after a requirements heading -> requirements; headless lines classified by LRN-SETUP-18; labels dropped.
// Location: no tags on this site, so only a work-location line in the ad (LRN-LOC-21 case 4), mapped through a closed
// city.csv-verified table; else Unknown. Recruitment agency: no office-address fallback. "באתרי הלקוחות בארץ" on that
// line adds פריסה ארצית. No date: the site prints none; a sitemap lastmod is not a publish date (LRN-AGE-5).
// Apply: the job's own CV form (POST /sendjobscv), copied per job with its hidden values (LRN-FORM-13).
var HUB = document.querySelector('a.allJobsMainCategoriesTitleA');
if (HUB && !document.getElementById('haide-jobs-root')) {
  var ROOT = document.createElement('div');
  ROOT.id = 'haide-jobs-root';
  document.body.appendChild(ROOT);
  var urls = [];
  document.querySelectorAll('a.allJobsMainCategoriesTitleA, a.allJobsSubCategoriesDIVA').forEach(function (a) {
    var u = new URL(a.getAttribute('href'), location.href).href;
    if (urls.indexOf(u) < 0) urls.push(u);
  });
  var STAGE = document.createElement('div');
  STAGE.id = 'haide-jobs-staging';
  STAGE.style.display = 'none';
  document.body.appendChild(STAGE);
  var BOX = urls.map(function () { var b = document.createElement('div'); STAGE.appendChild(b); return b; });
  var BAD = urls.length < 10, HOME = 0, ROWS = 0, T0 = Date.now();
  var IN_FLIGHT = 6, ATTEMPT_MS = 60000, ATTEMPTS = 2, LAST_START_MS = 220000;
  var fail = function (why) { if (!BAD) console.warn('[prologic] ' + why + '; list emptied, nothing written'); BAD = true; };
  var queue = urls.map(function (u, i) { return i; });
  var worker = async function () {
    while (queue.length && !BAD) {
      var i = queue.shift(), d = null, why = '';
      for (var t = 0; t < ATTEMPTS && !d && !BAD; t++) {
        if (Date.now() - T0 > LAST_START_MS) { why = 'out of time (' + LAST_START_MS / 1000 + ' s)'; break; }
        if (t) await new Promise(function (ok) { setTimeout(ok, 1000); });
        var ctl = new AbortController(), timer = setTimeout(function () { ctl.abort(); }, ATTEMPT_MS);
        try {
          // no cookies: the site's ASP.NET session lock serves one request per session at a time, so with the
          // browser's session cookie 6 parallel fetches queued behind each other (9 to 39 s; without it 4 s each,
          // 2026-10-19). The pages are the same for every visitor.
          var r = await fetch(urls[i], { credentials: 'omit', signal: ctl.signal });
          // a removed category answers 301 -> the homepage (help-desk, 2026-10-13): no jobs, not a failure,
          // unless half or more of the pages do (then the board has moved: fail, below)
          if (r.ok && r.redirected && /^\/+$/.test(new URL(r.url).pathname)) { HOME++; d = document.implementation.createHTMLDocument(''); break; }
          if (!r.ok || r.redirected) { why = 'HTTP ' + r.status + (r.redirected ? ' (redirected)' : ''); continue; }
          var x = new DOMParser().parseFromString(await r.text(), 'text/html');
          if (x.querySelector('.SubCategoriesFilterHolder')) d = x; else why = 'no listing frame';
        } catch (e) {
          why = e && e.name === 'AbortError' ? 'no answer within ' + ATTEMPT_MS / 1000 + ' s' : 'network error';
        } finally {
          clearTimeout(timer);
        }
      }
      if (BAD) return;
      if (!d) { fail('page failed (' + why + '): ' + urls[i]); return; }
      addPage(i, d);
    }
  };
  var MATH = new RegExp('[' + String.fromCodePoint(0x1D400) + '-' + String.fromCodePoint(0x1D7FF) + ']', 'gu');
  var WS = new RegExp('[ \\t' + String.fromCharCode(160) + ']+', 'g');
  var lines = function (el) {
    var c = el.cloneNode(true);
    c.querySelectorAll('br').forEach(function (b) { b.replaceWith('\n'); });
    c.querySelectorAll('p, li, div, h1, h2, h3, h4, h5, h6, tr').forEach(function (b) { b.append('\n'); });
    return c.textContent.split('\n').map(function (l) { return l.replace(WS, ' ').trim(); }).filter(function (l) { return /[\p{L}\p{N}]/u.test(l); });
  };
  var REQ_H = /^(דרישות(\s+(המשרה|התפקיד))?|requirements|qualifications?|what you need for success\??|אז מה צריך\s*\?)\s*:?\s*$/i;
  var DESC_H = /^(תיאור\s+(המשרה|התפקיד)|job description)\s*:?\s*$/i;
  var DUTY_H = /^(התפקיד כולל|במסגרת התפקיד|תחומי אחריות|אחריות|responsibilities)\s*:\s*$/i;
  var REQ_W = /^(ניסיון|נסיון|ידע|רישיון|רשיון|תעודה|תעודת|בעל|בעלת|בעל\/ת|יכולת|יכולות|נכונות|זמינות|שליטה|הכרה|הכרת|הכרות|היכרות|מגורים|דובר|דוברת|דובר\/ת|עדיפות|נדרש|נדרשת|נדרש\/ת|יוצא|יוצאי|רצוי|גישה|עם ידע|עם ניסיון|ראש גדול|תואר|בוגר|בוגרת|בוגר\/ת|אנגלית|הסמכ\S*)(?=[\s,:\-–]|$)/;
  var EN_W = /^(\d+(\s*-\s*\d+)?\+?\s+years?|at least|experience|experienced|knowledge|familiar\S*|proven|strong|excellent|good|b\.?sc|m\.?sc|ba\b|b\.?a\b|degree|bachelor|academic|proficien\S*|understanding|ability|able to|hands[- ]on|background|advantage|must)/i;
  var isPay = function (l) { var s = l.replace(/חשב\S*\s+שכר/g, ''); return /שכר/.test(s) || /^תנאים|\+\s*תנאים|תנאים\s*\+|תנאים\s+(טובים|מעולים)/.test(s) || /\d:\d\d/.test(s); };
  // stays in the description even inside a requirements run: role line, pay/terms, scope, work place
  var keep = function (l) { return /דרוש/.test(l) || isPay(l) || /^(משרה\s+מלאה|היקף\s+משרה)|work life balance/i.test(l) || /^(העבודה|המשרה)\s+(ממוקמת\s+)?ב/.test(l); };
  var isReq = function (l) {
    var s = l.replace(/^[^\p{L}\p{N}]+/u, '');
    if (s.length > 150 || /דרוש/.test(s) || isPay(s)) return false;
    if (/[–-]\s*חובה(\s+\S+){3,}/.test(s)) return false;
    return /חובה|יתרון/.test(s) || REQ_W.test(s) || EN_W.test(s);
  };
  // work-location lines only; every value is a verbatim city.csv entry
  var PLACE = { 'המרכז': 'אזור מרכז', 'מרכז': 'אזור מרכז', 'השרון': 'אזור השרון', 'הצפון': 'אזור צפון', 'צפון': 'אזור צפון',
    'נתניה': 'נתניה', 'תל אביב': 'תל אביב-יפו', 'ירושלים': 'ירושלים', 'ראש העין': 'ראש העין', 'פארק אפק': 'ראש העין', 'הרצליה': 'הרצליה' };
  var PL = '(' + Object.keys(PLACE).sort(function (a, b) { return b.length - a.length; }).join('|') + ')(?=[\\s,.!)\\-–]|$)';
  var CUES = [
    new RegExp('(?:העבודה|המשרה|משרה(?:\\s+מלאה)?)\\s+(?:ממוקמת\\s+)?ב(?:אזור\\s+)?' + PL),
    new RegExp('(?:יושבים|יושב|הממוקמת|הממוקם)\\s+ב(?:אזור\\s+)?' + PL),
    new RegExp('^ל(?:חברת|חברה|ארגון|משרד)[^,.\\n]{0,40}?\\sב(?:אזור\\s+)?' + PL)
  ];
  var TITLE_CUE = new RegExp('\\s[לב]' + PL + '\\s*$');
  // a job listed on several pages appears once per page; the worker keeps the first row per job address
  var addPage = function (i, d) {
    d.querySelectorAll('.allJobsContentHolder').forEach(function (h) {
      var a = h.querySelector('a[href]'), fm = h.querySelector('form.allJobsSendCVForm'), body = h.querySelector('.allJobsDescription');
      var url = a ? new URL(a.getAttribute('href'), location.href).href : '';
      if (!url) return;
      ROWS++;
      build({ url: url, h: h, fm: fm, body: body }, BOX[i]);
    });
  };
  var build = function (c, box) {
    var t = c.h.querySelector('.allJobsTitle');
    var title = (t ? t.textContent : '').replace(MATH, function (ch) { return ch.normalize('NFKC'); }).replace(/\s+/g, ' ').trim();
    if (!title || !/(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u.test(title) || /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u.test(title)) return;
    var item = document.createElement('div');
    item.className = 'haide-job';
    var add = function (cls, v) { var e = document.createElement('div'); e.className = cls; e.style.display = 'none'; e.textContent = v; item.appendChild(e); };
    var ln = document.createElement('a'); ln.className = 'haide-link'; ln.href = c.url; ln.textContent = title; item.appendChild(ln);
    var hv = function (n) { var f = c.fm && c.fm.querySelector('[name="' + n + '"]'); return f ? (f.getAttribute('value') || '') : ''; };
    if (/^\d+$/.test(hv('cmsId'))) add('__ai-externalJobId', 'prologic-' + hv('cmsId'));
    // sections: a requirements heading opens a requirements section; a description label or a duties lead-in
    // ("התפקיד כולל:") opens a description section. Labels are dropped, the lead-in stays.
    var L = c.body ? lines(c.body) : [], desc = [], req = [], segs = [{ req: false, l: [] }];
    L.forEach(function (l) {
      if (REQ_H.test(l)) { segs.push({ req: true, l: [] }); return; }
      if (DESC_H.test(l)) { segs.push({ req: false, l: [] }); return; }
      if (DUTY_H.test(l)) { segs.push({ req: false, l: [l] }); return; }
      segs[segs.length - 1].l.push(l);
    });
    segs.forEach(function (s) {
      // outside a requirements section: from the first requirement line on, the run moves as one block when at
      // least half of it qualifies (LRN-SETUP-18 bullet-run rule)
      var from = s.req ? 0 : s.l.findIndex(function (l) { return isReq(l) || (!/דרוש/.test(l) && REQ_W.test(l.replace(/^[^\p{L}\p{N}]+/u, ''))); });
      if (!s.req && from >= 0 && s.l.slice(from).filter(isReq).length * 2 < s.l.length - from) from = -1;
      s.l.forEach(function (l, n) { if (from >= 0 && n >= from && !keep(l)) req.push(l); else desc.push(l); });
    });
    add('__ai-description', desc.join('\n'));
    if (req.length) add('__ai-requirements', req.join('\n'));
    var loc = [];
    var push = function (p) { var v = PLACE[p]; if (v && loc.indexOf(v) < 0) loc.push(v); };
    var tm = TITLE_CUE.exec(title); if (tm) push(tm[1]);
    L.forEach(function (l) {
      if (/^מגורים/.test(l)) return;
      CUES.forEach(function (re) {
        var m = re.exec(l);
        if (!m) return;
        push(m[1]);
        // the same work-location line adds client sites across the country (prologic-750)
        if (/באתרי\s+ה?לקוחות\s+ב(כל\s+)?ה?ארץ|ברחבי\s+הארץ/.test(l) && loc.indexOf('פריסה ארצית') < 0) loc.push('פריסה ארצית');
      });
    });
    add('__ai-location', loc.length ? loc.join(', ') : 'Unknown');
    if (c.fm) {
      var fields = [];
      c.fm.querySelectorAll('input, select, textarea').forEach(function (f) {
        var ft = (f.tagName === 'INPUT' ? (f.getAttribute('type') || 'text') : f.tagName.toLowerCase()).toLowerCase();
        if (/^(submit|button|reset|image)$/.test(ft) || !f.name) return;
        var fo = { name: f.name, label: f.name === 'file' ? 'קורות חיים' : f.name, fieldType: ft, tagName: f.tagName, required: f.hasAttribute('required') };
        if (ft === 'hidden') fo.value = f.getAttribute('value') || '';
        if (ft === 'file' && f.getAttribute('accept')) fo.accept = f.getAttribute('accept');
        fields.push(fo);
      });
      var act = new URL(c.fm.getAttribute('action') || '/sendjobscv', location.href).href;
      var blob = JSON.stringify({ actionUrl: act, actionAttribute: act, formClass: 'allJobsSendCVForm', formTag: 'form',
        method: (c.fm.getAttribute('method') || 'post').toUpperCase(), enctype: c.fm.getAttribute('enctype') || undefined, fields: fields });
      add('__ai-applicationInfo', blob);
      add('__ai-formData', blob);
    }
    box.appendChild(item);
  };
  await Promise.all(BOX.slice(0, IN_FLIGHT).map(worker));
  if (!BAD && HOME * 2 >= urls.length) fail(HOME + ' of ' + urls.length + ' pages redirect home');
  if (!BAD && !ROWS) fail('no job on any page');
  // one row per job: the first in hub order, the row the worker kept when every copy was emitted (298 rows for 97 jobs
  // made the listing_vs_saved_gap check fire on every run, 2026-10-19)
  var SEEN = {};
  if (!BAD) BOX.forEach(function (b) {
    Array.prototype.slice.call(b.children).forEach(function (item) {
      var k = item.querySelector('a.haide-link').href;
      if (!SEEN[k]) { SEEN[k] = 1; ROOT.appendChild(item); }
    });
  });
  else ROOT.innerHTML = '';
}
