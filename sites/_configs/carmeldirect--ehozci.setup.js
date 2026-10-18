// carmeldirect.com/career: JetEngine grid of the WordPress "career" post type, one page, no pager (12 cards).
// A card prints an area tag (a link, absent on one card) and the title; the body, the date and the apply form
// are on the job page. The script reads every card, then every job page, ALL-OR-NOTHING (a failed fetch, a
// redirect or a page without the job template builds no item).
// - description / requirements: the job page's post body. Lines under a requirements heading (דרישות התפקיד,
//   דרישות המשרה, דרישות חובה, מה אנחנו מחפשים, יתרון משמעותי, פרופיל מתאים) go to requirements, except scope,
//   place, hours, apply and "המשרה מיועדת" lines, which stay in the description. A job with no requirements
//   heading moves its run of requirement lines when at least half of the run qualifies. The labels
//   תיאור/דרישות are dropped; every other line as printed. Cloudflare-hidden e-mail addresses are written back.
// - id: the page prints no job number and the addresses are date-like slugs, so no id is emitted; the worker
//   builds an h- id from title, department and url.
// - location: the card's area tag as printed, read through the config's locationMap. A work line saying the job
//   is done across the country ("בכל הארץ" / "ברחבי הארץ") adds פריסה ארצית. A card with no tag takes the
//   place from a "מיקום:" / "מיקום המשרה:" line, never from "מיקום החברה" or prose.
// - date: the job page's own datePublished (Yoast JSON-LD); the page prints no date. When the job's address
//   carries exactly 8 digits forming a valid DDMMYYYY date (no digit on either side) and that date is more than
//   7 days from the post date, the post belongs to another posting and the job stays undated (owner,
//   2026-10-18; today only /career/02072024cd/).
// - apply: the job's own Elementor form as the page has it (hidden queried_id = the job's post, referer_title,
//   the prefilled job name), one blob per job; a text box the page hides (spam trap) is left out.
if (document.getElementById('haide-carmel')) return;
var T0 = Date.now();
var NB = String.fromCharCode(160);
var WS = new RegExp('[ \\t' + NB + ']+', 'g');
var OK1 = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u, BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var MATH = new RegExp('[' + String.fromCodePoint(0x1D400) + '-' + String.fromCodePoint(0x1D7FF) + ']', 'gu');
var clean = function (s) { return String(s || '').replace(WS, ' ').replace(/\s+/g, ' ').trim(); };
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var get = async function (url) {
  for (var a = 0; a < 2; a++) {
    try {
      var r = await fetch(url, { credentials: 'include', cache: 'no-store' });
      if (r.ok && !r.redirected) return await r.text();
    } catch (e) {}
    await sleep(1500);
  }
  return null;
};
// --- the cards (wait for the grid; it is in the server HTML, so this normally passes at once) ---
var JOBURL = /\/career\/[^\/?#]+\/?$/;
var cardEls = [];
for (var t = 0; t < 20; t++) {
  cardEls = Array.prototype.filter.call(document.querySelectorAll('.jet-listing-grid__item'), function (c) {
    var w = c.querySelector('.jet-engine-listing-overlay-wrap[data-url]');
    return w && JOBURL.test(w.getAttribute('data-url'));
  });
  if (cardEls.length) break;
  await sleep(500);
}
var cards = cardEls.map(function (c) {
  var h4 = c.querySelector('h4.elementor-heading-title');
  var tagA = c.querySelector('div.elementor-heading-title a');
  var url = c.querySelector('.jet-engine-listing-overlay-wrap[data-url]').getAttribute('data-url');
  return { pid: c.getAttribute('data-post-id') || '', title: clean(h4 ? h4.textContent : ''), tag: clean(tagA ? tagA.textContent : ''),
    url: new URL(url, location.href).href };
});
if (!cards.length || cards.some(function (c) { return !c.title || !c.url; })) { console.warn('[carmel] card read failed'); return; }
// --- the job pages ---
var pages = [];
for (var i = 0; i < cards.length; i++) {
  var h = await get(cards[i].url);
  var d = h && new DOMParser().parseFromString(h, 'text/html');
  var main = d && d.querySelector('[data-elementor-type="single-post"].type-career');
  var body = main && main.querySelector('.elementor-widget-theme-post-content .elementor-widget-container');
  if (!body) { console.warn('[carmel] job page failed: ' + cards[i].url); return; }
  var date = '';
  d.querySelectorAll('script[type="application/ld+json"]').forEach(function (s) {
    try {
      var j = JSON.parse(s.textContent || '{}');
      (j['@graph'] || [j]).forEach(function (g) { if (!date && g && g['@type'] === 'WebPage' && g.datePublished) date = g.datePublished; });
    } catch (e) {}
  });
  var sm = /(?<!\d)(\d{2})(\d{2})(\d{4})(?!\d)/.exec(cards[i].url.split('/career/')[1] || '');
  if (date && sm && +sm[1] >= 1 && +sm[1] <= 31 && +sm[2] >= 1 && +sm[2] <= 12) {
    var gap = Math.abs(Date.parse(sm[3] + '-' + sm[2] + '-' + sm[1] + 'T00:00:00Z') - Date.parse(date.slice(0, 10) + 'T00:00:00Z')) / 864e5;
    if (gap > 7) {
      console.warn('[carmel] slug date ' + sm[0] + ' is ' + Math.round(gap) + ' days from post date ' + date.slice(0, 10) + ', undated: ' + cards[i].url);
      date = '';
    }
  }
  pages.push({ main: main, body: body, date: date });
}
// Cloudflare e-mail protection: the address is xor-coded in data-cfemail / the link's hash
var cfdec = function (hex) {
  var k = parseInt(hex.slice(0, 2), 16), o = '';
  for (var n = 2; n + 1 < hex.length; n += 2) o += String.fromCharCode(parseInt(hex.slice(n, n + 2), 16) ^ k);
  return o;
};
var linesOf = function (el) {
  var c = el.cloneNode(true);
  c.querySelectorAll('script, style, svg').forEach(function (e) { e.remove(); });
  c.querySelectorAll('a[href*="/cdn-cgi/l/email-protection#"]').forEach(function (a) { a.textContent = cfdec(a.getAttribute('href').split('#')[1] || ''); });
  c.querySelectorAll('[data-cfemail]').forEach(function (e) { e.replaceWith(cfdec(e.getAttribute('data-cfemail'))); });
  c.querySelectorAll('br').forEach(function (e) { e.replaceWith('\n'); });
  c.querySelectorAll('p, li, div, ul, ol, h1, h2, h3, h4, h5, h6, tr').forEach(function (e) { e.appendChild(document.createTextNode('\n')); });
  return (c.textContent || '').split('\n').map(function (l) { return l.replace(WS, ' ').trim(); }).filter(function (l) { return l; });
};
var key = function (l) { return l.replace(/[\s:?.]+$/, '').replace(/^[\s*]+/, '').trim(); };
var DROP = ['תיאור התפקיד', 'תאור התפקיד', 'תיאור המשרה', 'תאור המשרה', 'תיאור משרה', 'תאור משרה',
  'דרישות התפקיד', 'דרישות המשרה', 'דרישות', 'מה אנחנו מחפשים'];
var REQ_OPEN = ['דרישות התפקיד', 'דרישות המשרה', 'דרישות', 'מה אנחנו מחפשים', 'דרישות חובה', 'יתרון משמעותי',
  'יתרון משמעותי יינתן למועמדים עם', 'פרופיל מתאים'];
var DESC_OPEN = ['תיאור התפקיד', 'תאור התפקיד', 'תיאור המשרה', 'תאור המשרה', 'תיאור משרה', 'תאור משרה', 'מטרת התפקיד',
  'תחומי אחריות', 'תחומי אחריות מרכזיים', 'מה מחכה לכם בתפקיד', 'למה כדאי לעבוד אצלנו', 'מהות התפקיד', 'ימים ושעות עבודה',
  'ממשקי עבודה', 'מה אנחנו מציעים', 'מה התפקיד כולל', 'להגשת קו"ח במייל'];
var BUL = /^[\s•·*▪–\-]+/;
// lines that are not requirements even under a requirements heading: scope, place, days/hours, terms, apply, e-mail
var STAY = /^(היקף|מיקום|שעות|ימי |ימים |משרה |המשרה (מיועדת|פתוחה)|לפרטים|להגשת|לשליחת)|@|\d:\d\d/;
var REQW = /^(ניסיון|נסיון|ידע|רישיון|רשיון|תעודה|תעודת|בעל|בעלת|בעל\/ת|יכולת|נכונות|זמינות|שליטה|הכרה|הכרת|מגורים|דובר|דוברת|עדיפות|נדרש|נדרשת|יוצא|יוצאי|רצוי|גישה|עם ידע|עם ניסיון|ראש גדול)(?=[\s\/,.:־-]|$)|חובה|יתרון/;
var split = function (lines) {
  var D = [], R = [], sec = 'd', secNo = 0, hasReq = false;
  lines.forEach(function (l) {
    var k = key(l);
    if (REQ_OPEN.indexOf(k) >= 0) { sec = 'r'; secNo++; hasReq = true; if (DROP.indexOf(k) < 0) R.push(l); return; }
    if (DESC_OPEN.indexOf(k) >= 0) { sec = 'd'; secNo++; if (DROP.indexOf(k) < 0) D.push({ l: l, s: secNo }); return; }
    var bare = l.replace(BUL, '');
    if (sec === 'r' && !STAY.test(bare)) R.push(l); else D.push({ l: l, s: secNo });
  });
  if (!hasReq) {
    // no requirements heading: from the first requirement line to the end of its section, the run moves as one
    // block when at least half of its lines qualify; the role line, scope, hours and apply lines stay
    var cand = function (x) { var b = x.l.replace(BUL, ''); return !STAY.test(b) && !/דרוש/.test(b) && b.length <= 150; };
    var isReq = function (x) { return cand(x) && REQW.test(x.l.replace(BUL, '')); };
    var f = -1;
    for (var n = 0; n < D.length; n++) if (isReq(D[n])) { f = n; break; }
    if (f >= 0) {
      var run = D.filter(function (x, n) { return n >= f && x.s === D[f].s && cand(x); });
      if (run.filter(isReq).length * 2 >= run.length) { R = run.map(function (x) { return x.l; }); D = D.filter(function (x) { return run.indexOf(x) < 0; }); }
    }
  }
  return { d: D.map(function (x) { return x.l; }).join('\n'), r: R.join('\n') };
};
var KNOWN = ['קיבוץ גזר', 'גזר', 'הרצליה', 'ראשון לציון', 'כל הארץ', 'פריסה ארצית'];
var NATION = /(מיקום (המשרה|העבודה)|בסיס המשרה|(^|[\s•·*–\-])(עבודה|לעבודה|עובדים)\s)[^.]*(בכל הארץ|ברחבי הארץ)/;
var PLACE = /^מיקום( המשרה| העבודה)?\s*:\s*(.+)$/;
var blobOf = function (main, url) {
  var fm = main.querySelector('form.elementor-form');
  if (!fm) return '';
  var fields = [];
  fm.querySelectorAll('input, select, textarea').forEach(function (e) {
    var ft = (e.tagName === 'INPUT' ? (e.getAttribute('type') || 'text') : e.tagName.toLowerCase()).toLowerCase();
    if (/^(submit|button|reset|image)$/.test(ft) || !e.name) return;
    // a text box the page hides by its own style is a spam trap: never part of what an applicant fills
    if (ft !== 'hidden' && /display\s*:\s*none|visibility\s*:\s*hidden/i.test(e.getAttribute('style') || '')) return;
    // a checkbox has two labels (the field's and the option's, e.g. "רישיון נהיגה" + "בעל/ת רישיון נהיגה ג' (בתוקף)"): keep both
    var lbs = e.id ? Array.prototype.map.call(fm.querySelectorAll('label[for="' + e.id + '"]'), function (x) { return clean(x.textContent); }).filter(Boolean) : [];
    var o = { name: e.name, label: lbs.length ? lbs.join(': ') : clean(e.getAttribute('placeholder') || ''), fieldType: ft, tagName: e.tagName,
      required: e.hasAttribute('required') };
    if (e.hasAttribute('value') && ft !== 'file') o.value = e.getAttribute('value') || '';
    if (ft === 'file' && e.getAttribute('accept')) o.accept = e.getAttribute('accept');
    fields.push(o);
  });
  return JSON.stringify({ actionUrl: location.origin + '/wp-admin/admin-ajax.php', actionAttribute: '', formClass: fm.getAttribute('class') || '',
    formTag: 'form', method: 'POST', enctype: 'multipart/form-data', pageUrl: url, fields: fields });
};
// --- the items ---
var root = document.createElement('div');
root.id = 'haide-carmel';
root.className = 'wp-exclude-emoji';
root.style.display = 'none';
var dropped = [];
cards.forEach(function (c, k) {
  var title = c.title.replace(MATH, function (ch) { return ch.normalize('NFKC'); });
  if (!OK1.test(title) || BAD.test(title)) { dropped.push(c.pid + ':lang'); return; }
  var lines = linesOf(pages[k].body);
  var s = split(lines);
  var loc = [];
  if (c.tag) loc.push(c.tag);
  else lines.forEach(function (l) {
    var m = PLACE.exec(l);
    if (m) m[2].split(/[,|]/).forEach(function (p) { p = clean(p); if (KNOWN.indexOf(p) >= 0 && loc.indexOf(p) < 0) loc.push(p); });
  });
  if (lines.some(function (l) { return NATION.test(l); }) && loc.indexOf('פריסה ארצית') < 0) loc.push('פריסה ארצית');
  var blob = blobOf(pages[k].main, c.url);
  var it = document.createElement('div');
  it.className = 'haide-job wp-exclude-emoji';
  var add = function (cls, v) { var e = document.createElement('span'); e.className = cls + ' wp-exclude-emoji'; e.textContent = v; it.appendChild(e); };
  var a = document.createElement('a');
  a.className = 'haide-link wp-exclude-emoji'; a.href = c.url; a.textContent = title;
  it.appendChild(a);
  if (s.d) add('__ai-description', s.d);
  if (s.r) add('__ai-requirements', s.r);
  if (loc.length) add('__ai-location', loc.join(' | '));
  if (pages[k].date) add('__ai-publishDate', pages[k].date);
  if (blob) { add('__ai-applicationInfo', blob); add('__ai-formData', blob); }
  root.appendChild(it);
});
document.body.appendChild(root);
console.log('[carmel] cards ' + cards.length + ', jobs ' + root.children.length + ', dropped ' + dropped.join(' ') + ', ' + (Date.now() - T0) + ' ms');
