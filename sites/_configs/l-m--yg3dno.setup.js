// l-m.co.il lobby: 6 cards + "load more" (admin-ajax get_posts_ajax). The worker's click cap (100) cannot reach all,
// so this script calls the same endpoint in batches of 100 and replaces the list. All-or-nothing (LRN-CO-4).
// id lm-<data-jobId> (agency's own number; not the WP post id). Dates: job RSS feed, day as written (owner 2026-10-12).
// Locations: area tags only, by the owner's tag rule (LRN-LOC-21 draft). Apply: per-job CF7 438 copy (LRN-FORM-13).
// Untitled posts (slug ללא-כותרת): the site fills the title with the whole ad, line breaks removed; then the title is
// the ad's first line (owner 2026-10-12, lm-325751).
var BOX = document.querySelector('ul.addHere');
if (BOX && !BOX.getAttribute('data-ai')) {
  BOX.setAttribute('data-ai', '1');
  var AJ = location.origin + '/wp-admin/admin-ajax.php', PPP = 100;
  var post = function (s) {
    return fetch(AJ, { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
      body: 'action=get_posts_ajax&pt=jobs&type=jobs&clasess=x&ppp=' + PPP + '&step=' + s })
      .then(function (r) { return r.json(); }).catch(function () { return null; });
  };
  var first = await post(0), TOTAL = first && first.success ? +first.total : 0, parts = [first && first.html];
  var steps = []; for (var s = 1; s * PPP < TOTAL; s++) steps.push(s);
  var rest = await Promise.all(steps.map(post));
  rest.forEach(function (j) { parts.push(j && j.success ? j.html : null); });
  var tmp = document.createElement('ul');
  tmp.innerHTML = parts.indexOf(null) < 0 ? parts.join('') : '';
  var got = tmp.querySelectorAll('li.ajaxEl');
  BOX.querySelectorAll('li.ajaxEl').forEach(function (li) { li.remove(); });
  if (TOTAL > 0 && got.length === TOTAL) { while (tmp.firstChild) BOX.appendChild(tmp.firstChild); }
  // dates: /jobs/feed/?paged=N, 10 per page; "Sun, 11 Oct 2026 13:24:51 +0000" is local time mislabelled, take the day as written
  var MON = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
  var key = function (u) { try { u = decodeURIComponent(u); } catch (e) { } return u.replace(/\/+$/, '').toLowerCase(); };
  var DATES = {}, pages = []; for (var p = 1; p <= Math.ceil(TOTAL / 10) + 1; p++) pages.push(p);
  var worker = async function () {
    while (pages.length) {
      var n = pages.shift();
      try {
        var x = await (await fetch('/jobs/feed/?paged=' + n, { credentials: 'same-origin' })).text();
        x.split('<item>').slice(1).forEach(function (it) {
          var l = /<link>([^<]+)<\/link>/.exec(it), d = /<pubDate>\w+, (\d{1,2}) (\w{3}) (\d{4})/.exec(it);
          if (l && d && MON[d[2]]) DATES[key(l[1])] = d[3] + '-' + MON[d[2]] + '-' + ('0' + d[1]).slice(-2);
        });
      } catch (e) { }
    }
  };
  await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map(worker));
  // owner tag rule 2026-10-12; a tag not in this table is dropped, never guessed
  var TAG = {};
  ('אשקלון=אשקלון;שדרות אופקים נתיבות=שדרות|אופקים|נתיבות;אשדוד והסביבה=אשדוד;חדרה והסביבה=חדרה;נתניה=נתניה;השרון=אזור השרון;' +
   'רמלה - לוד=רמלה לוד;קריית גת והסביבה=קרית גת;ראשון לציון והסביבה=ראשון לציון;רחובות - נס ציונה=רחובות|נס ציונה;עמק חפר=עמק חפר;' +
   'עפולה והסביבה=עפולה;באר שבע והסביבה=באר שבע;תל אביב-יפו והסביבה=תל אביב-יפו;נצרת והסביבה=נצרת;כרמיאל והסביבה=כרמיאל;' +
   'פתח תקווה והסביבה=פתח תקווה;חולון- בת-ים=חולון|בת-ים;חיפה והקריות=חיפה|אזור צפון;ואדי ערה=אזור צפון;מודיעין-שוהם=מודיעין|שוהם;' +
   'הגליל=אזור צפון;יקנעם והסביבה=יוקנעם;ירושלים והסביבה=ירושלים;אור יהודה - יהוד=אור יהודה|יהוד;דימונה - ערד=דימונה|ערד;' +
   'בית שמש=בית שמש;טבריה והסביבה=טבריה;ק. שמונה והסביבה=קריית שמונה;אילת והערבה=אילת|אזור אילת;יהודה ושומרון=אזור יהודה ושומרון;' +
   'רמת הגולן=אזור רמת הגולן').split(';').forEach(function (e) { var kv = e.split('='); TAG[kv[0]] = kv[1].split('|'); });
  // body split (LRN-SETUP-18): labels dropped, דרישות sections and headless requirement lines -> requirements
  var MARK = /^[^\p{L}\p{N}]+/u;
  var REQ_H = /^(דרישות|כישורים|כישורי|ה?השכלה ו?ניסיון|מה אנחנו מחפשים|מי את\/ה|מי אתה|את\/ה)/;
  var DESC_L = /^(תיאור|תאור)\s*(ה?תפקיד|ה?משרה)?\s*[:\-–]?\s*$/;
  var OTHER = /^(מה תקבל|מה מחכה|מה מציעים|מה אנו מציעים|תנאים|תנאי|שכר|היקף|שעות|ימי עבודה|עבודה במשמרות|משמרות|הסעות|מה אנחנו מציעים|אנו מציעים|הטבות|התפקיד כולל|במסגרת התפקיד|תחומי אחריות|תיאור|תאור|מיקום|המשרה מיועדת|המשרה פונה)/;
  var WORD = /^(ניסיון|נסיון|ידע|רישיון|רשיון|תעודה|תעודת|בעל\/ת|בעל|בעלת|יכולת|נכונות|זמינות|שליטה|הכרה|הכרת|היכרות|מגורים|דובר\/ת|דובר|עדיפות|נדרש\/ת|נדרש|יוצא\/י|יוצאי|רצוי|גישה|עם ידע|עם ניסיון|ראש גדול|תואר|השכלה|אוריינטציה|יחסי אנוש|כושר|יכולות|סדר וארגון|אמינות)/;
  var HRS = /\d{1,2}[:.]\d\d/;
  var reqLike = function (t) {
    if (t.length > 150 || /דרוש/.test(t) || HRS.test(t)) return false;
    if (/מגייס|מחפש|^לחבר|^למפעל|^לרשת|^חברה|^תפקיד|^ימי עבודה|^שעות|^היקף|^עבודה במשמרות|^משמרות|^ה?משרה|אופציה|קידום|עתודה|הטב/.test(t)) return false;
    var q = t.replace(/חשב\S*\s+שכר/g, '');
    if (/^שכר|^תנאים|\+\s*תנאים|ש"ח|₪|לשעה/.test(q) || /[–\-]\s*חובה\s+\S+\s+\S+\s+\S+/.test(t)) return false;
    return /חובה|יתרון/.test(t) || WORD.test(t);
  };
  var bare = function (l) { return l.replace(MARK, '').trim(); };
  var isB = function (l) { return /^\s*[*•\-–·▪]/.test(l); };
  var split = function (lines) {
    var d = [], r = [], mode = 'd';
    lines.forEach(function (raw) {
      var t = bare(raw); if (!t) return;
      var m = /^(דרישות|כישורים)( ה?(תפקיד|משרה))?\s*[:\-–]\s*(.+)$/.exec(t);
      if (m && m[4].length > 2) { mode = 'r'; r.push(m[4]); return; }
      if (t.length <= 40 && REQ_H.test(t) && (/[:\-–]\s*$/.test(t) || /^\S+(\s\S+){0,2}$/.test(t))) { mode = 'r'; return; }
      if (DESC_L.test(t)) { mode = 'd'; return; }
      if (t.length <= 40 && OTHER.test(t)) { mode = 'd'; d.push(raw); return; }
      if (mode === 'r' && t.length <= 30 && /[:?]\s*$/.test(t) && !REQ_H.test(t) && !reqLike(t)) { mode = 'd'; d.push(raw); return; }
      if (mode === 'r') { (/^(שכר|תנאים)/.test(t) || HRS.test(t) ? d : r).push(raw); } else d.push(raw);
    });
    var d2 = [], i = 0;
    while (i < d.length) {
      if (isB(d[i])) {
        var j = i; while (j < d.length && isB(d[j])) j++;
        var run = d.slice(i, j), q = run.filter(function (l) { return reqLike(bare(l)); }).length;
        var clean = run.every(function (l) { return !/\d{1,2}[:.]\d\d|^\s*[*•\-–·▪]*\s*(שכר|תנאים|ה?משרה|נסיעות)|אופציה|קידום|עתודה|הטב|מגייס|דרוש/.test(l); });
        if (run.length >= 2 && q * 2 >= run.length && clean) r = r.concat(run);
        else run.forEach(function (l) { (reqLike(bare(l)) ? r : d2).push(l); });
        i = j; continue;
      }
      (reqLike(bare(d[i])) ? r : d2).push(d[i]); i++;
    }
    return [d2.join('\n'), r.join('\n')];
  };
  var MATH = new RegExp('[' + String.fromCodePoint(0x1D400) + '-' + String.fromCodePoint(0x1D7FF) + ']', 'gu');
  var fm = document.querySelector('#u_ResumeForm form.wpcf7-form');
  BOX.querySelectorAll('li.ajaxEl').forEach(function (li) {
    try {
      var h3 = li.querySelector('h3.title');
      var p = li.querySelector('.job_content'), lines = p ? p.textContent.split(/\r?\n/) : [];
      var title = h3 ? h3.textContent.trim() : '';
      // untitled post: the title is the whole ad with its line breaks removed -> the ad's first line
      var adLines = lines.map(function (l) { return l.trim(); }).filter(Boolean);
      // letters and digits only: WordPress texturizes the title (" - " becomes an en dash, quotes curl), not the ad
      var squash = function (s) { return s.replace(/[^\p{L}\p{N}]+/gu, ''); };
      if (adLines.length > 1 && squash(title) === squash(adLines.join(''))) title = adLines[0];
      title = title.replace(MATH, function (c) { return c.normalize('NFKC'); });
      if (!/(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u.test(title) || /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u.test(title)) { li.remove(); return; }
      if (h3) h3.textContent = title;
      var add = function (c, v) { var e = document.createElement('div'); e.className = c; e.style.display = 'none'; e.textContent = v; li.appendChild(e); };
      var btn = li.querySelector('button.ou_ResumeForm'), jid = btn ? btn.getAttribute('data-jobId') : '';
      if (jid) add('__ai-externalJobId', 'lm-' + jid);
      var loc = [], typ = '';
      li.querySelectorAll('h4').forEach(function (h) {
        var tx = h.textContent.replace(/\s+/g, ' ').trim(), v = tx.split(':').slice(1).join(':').trim();
        if (/^מיקום/.test(tx)) v.split(',').forEach(function (g) { (TAG[g.trim()] || []).forEach(function (c) { if (loc.indexOf(c) < 0) loc.push(c); }); });
        else if (/^סוג משרה/.test(tx)) typ = v;
      });
      add('__ai-location', loc.length ? loc.join(', ') : 'Unknown');
      if (typ) add('__ai-employmentType', typ);
      var sp = split(lines);
      add('__ai-description', sp[0]);
      if (sp[1]) add('__ai-requirements', sp[1]);
      var a = li.querySelector('a.openNewWin'), dt = a ? DATES[key(a.href)] : '';
      if (dt) add('__ai-publishDate', dt);
      if (fm && jid) {
        var fields = [];
        fm.querySelectorAll('input, select, textarea').forEach(function (f) {
          var ft = (f.tagName === 'INPUT' ? (f.getAttribute('type') || 'text') : f.tagName.toLowerCase()).toLowerCase();
          if (/^(submit|button|reset|image)$/.test(ft) || !f.name) return;
          var lab = f.id ? fm.querySelector('label[for="' + f.id + '"]') : null;
          var fo = { name: f.name, label: lab ? lab.textContent.replace(/[*\s]+/g, ' ').trim() || f.name : f.name, fieldType: ft, tagName: f.tagName,
            required: f.hasAttribute('required') || f.getAttribute('aria-required') === 'true' || !!f.closest('.wpcf7-validates-as-required') };
          if (f.name === 'your-jobID') fo.value = jid;
          else if (ft === 'hidden' || f.name === 'u_ResumeF_additional_email') fo.value = f.name === 'u_ResumeF_additional_email' ? (btn.getAttribute('data-additionalEmail') || '') : (f.getAttribute('value') || '');
          if (ft === 'file' && f.getAttribute('accept')) fo.accept = f.getAttribute('accept');
          fields.push(fo);
        });
        var act = new URL(fm.getAttribute('action') || location.href, location.href).href;
        var blob = JSON.stringify({ actionUrl: act, actionAttribute: act, formClass: fm.getAttribute('class') || '', formTag: 'form',
          method: (fm.getAttribute('method') || 'post').toUpperCase(), enctype: fm.getAttribute('enctype') || undefined, fields: fields });
        add('__ai-applicationInfo', blob);
        add('__ai-formData', blob);
      }
    } catch (err) { }
  });
}
