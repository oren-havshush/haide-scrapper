// iscar.com/marcom/iscar-career-job-list: WordPress + Elementor posts grid, 7 cards a page, page links 1..N.
// GETs only, credentials omit, 20 s per fetch, 4 in flight. ALL-OR-NOTHING: a failed/redirected fetch, a page
// with no card, a card with no REST record, or a job page with no apply form for that post -> no row at all.
// - coverage: the listing's cards only (REST also returns category-75 "משרה חמה" posts the listing never shows).
// - body: the post's REST content (the text the job page shows). The two text widgets are split: lines under
//   דרישות / Requirements (and Advantages / יתרונות / מיומנויות kept as sub-headings) -> requirements, except
//   hours, scope, place and "המשרה..." lines, which stay; labels תיאור/דרישות dropped. + "סוג משרה: X".
// - id: the printed "קוד משרה JB - N" as iscar-N; a missing or repeated code -> no id (worker h- id).
// - date: the post date (REST date, site time), unless the slug carries another JB code (reused post) -> none.
// - location: the "מיקום" box as printed, read through locationMap. department: the post's categories.
// - apply: the job page's own Elementor form, one blob per job (hidden post_id/form_id/referer_title/queried_id).
if (document.getElementById('haide-iscar')) return;
var T0 = Date.now(), B = 'https://www.iscar.com/marcom/', LST = B + 'iscar-career-job-list/';
var OK1 = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}]/u;
var BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var MATH = new RegExp('[' + String.fromCodePoint(0x1D400) + '-' + String.fromCodePoint(0x1D7FF) + ']', 'gu');
var RH = /^(דרישות( התפקיד| המשרה)?|requirements)[\s:.–-]*$/i;
var AH = /^(advantages|יתרונות|יתרון|מיומנויות|skills)[\s:]*$/i;
var DH = /^(תיאור (ה)?משרה|job description)[\s:.–-]*$/i;
var OH = /^(what we offer|מה אנחנו מציעים)[\s?:]*$/i;
var STAY = /\d{1,2}:\d\d|^(משרה|למשרת|שעות העבודה|המשרה|המפעל|החברה|מיקום|שכר|תנאים)|ממוקמ|דרוש/;
var sq = function (s) { return String(s || '').split(String.fromCharCode(160)).join(' ').replace(/[ \t]+/g, ' ').trim(); };
var get = async function (u, js) {
var ac = new AbortController(), k = setTimeout(function () { ac.abort(); }, 20000);
try {
var r = await fetch(u, { credentials: 'omit', cache: 'no-store', signal: ac.signal });
if (!r.ok || r.redirected) throw new Error(r.status + (r.redirected ? ' redirected' : '') + ' ' + u);
var t = await r.text();
return js ? JSON.parse(t) : new DOMParser().parseFromString(t, 'text/html');
} finally { clearTimeout(k); }
};
var pool = async function (xs, f) {
var out = new Array(xs.length), i = 0;
await Promise.all([0, 1, 2, 3].map(async function () { while (i < xs.length) { var j = i++; out[j] = await f(xs[j]); } }));
return out;
};
var path = function (u) { try { return decodeURIComponent(new URL(u, B).pathname).toLowerCase().replace(/\/+$/, ''); } catch (e) { return ''; } };
var cards = function (d) {
var cs = d.querySelectorAll('.elementor-posts-container article.elementor-post');
if (!cs.length) throw new Error('no card');
return Array.from(cs).map(function (c) {
var a = c.querySelector('h3.elementor-post__title a'), id = (/(?:^| )post-(\d+)(?: |$)/.exec(c.className) || [])[1];
if (!a || !id || !/^https:\/\/www\.iscar\.com\/marcom\/\d{4}\/\d\d\/\d\d\/[^\/]+\/$/.test(a.href)) throw new Error('card ' + (a && a.href));
return { id: id, href: a.href, title: sq(a.textContent).replace(MATH, function (x) { return x.normalize('NFKC'); }) };
});
};
var lines = function (w) {
var c = w.cloneNode(true);
c.querySelectorAll('br').forEach(function (b) { b.replaceWith('\n'); });
c.querySelectorAll('p,div,li,ul,ol,h1,h2,h3,h4,h5,h6').forEach(function (e) { e.append('\n'); });
return c.textContent.split('\n').map(sq).filter(Boolean);
};
var body = function (p) {
var d = new DOMParser().parseFromString(p.content.rendered, 'text/html');
var ws = Array.from(d.querySelectorAll('.elementor-widget-text-editor .elementor-widget-container')).map(lines);
ws.sort(function (a, b) { return (RH.test(a[0] || '') ? 1 : 0) - (RH.test(b[0] || '') ? 1 : 0); });
var D = [], R = [];
ws.forEach(function (ls) {
var inR = false;
ls.forEach(function (l) {
if (RH.test(l)) { inR = true; return; }
if (DH.test(l)) { inR = false; return; }
if (AH.test(l)) inR = true; else if (OH.test(l)) inR = false;
(inR && !(l.length > 150 || (!AH.test(l) && STAY.test(l))) ? R : D).push(l);
});
});
var box = {};
d.querySelectorAll('.elementor-widget-icon-box').forEach(function (b) {
box[sq((b.querySelector('.elementor-icon-box-title') || {}).textContent)] = sq((b.querySelector('.elementor-icon-box-description') || {}).textContent);
});
var tk = Object.keys(box).filter(function (k) { return /^(סוג משרה|job type)$/i.test(k); })[0];
if (tk && box[tk]) D.push(tk + ': ' + box[tk]);
var code = (/^JB\s*-?\s*(\d+)$/.exec(box['קוד משרה'] || box['Job Code'] || '') || [])[1];
return { d: D.join('\n'), q: R.join('\n'), code: code, loc: box['מיקום'] || box['Location'] || '' };
};
var rows = [], cat = {};
try {
var p1 = await get(LST), last = Math.max.apply(null, [1].concat(Array.from(p1.querySelectorAll('nav.elementor-pagination a.page-numbers')).map(function (a) {
return +((/\/iscar-career-job-list\/(\d+)\/$/.exec(a.href) || [])[1] || 1); })));
var pages = [p1].concat(await pool(Array.from({ length: last - 1 }, function (_, k) { return LST + (k + 2) + '/'; }), get));
pages.forEach(function (d) { rows = rows.concat(cards(d)); });
if (new Set(rows.map(function (r) { return r.id; })).size !== rows.length) throw new Error('card repeated');
var ids = rows.map(function (r) { return r.id; });
var rest = await get(B + 'wp-json/wp/v2/posts?per_page=100&include=' + ids.join(',') + '&_fields=id,date,slug,link,categories,content', 1);
(await get(B + 'wp-json/wp/v2/categories?per_page=100&_fields=id,name', 1)).forEach(function (c) { cat[c.id] = sq(c.name); });
var byId = {};
rest.forEach(function (p) { byId[p.id] = p; });
var forms = await pool(rows, async function (r) {
var f = (await get(r.href)).querySelector('form.elementor-form');
var pid = f && f.querySelector('input[name="post_id"]');
if (!pid || pid.value !== r.id || !f.querySelector('input[type="file"]')) throw new Error('form ' + r.href);
return f;
});
rows.forEach(function (r, i) {
var p = byId[r.id];
if (!p || path(p.link) !== path(r.href) || !p.content || !p.content.rendered) throw new Error('rest ' + r.id);
var b = body(p), sc = (/(?:^|-)jb-?(\d{4})(?:-\d+)?$/.exec(decodeURIComponent(p.slug)) || [])[1];
Object.assign(r, b, { form: forms[i], date: sc && sc !== b.code ? '' : String(p.date || '').slice(0, 10),
dep: (p.categories || []).filter(function (c) { return c !== 1 && c !== 75 && cat[c]; }).map(function (c) { return cat[c]; }).join(', ') });
});
} catch (e) { console.log('[iscar] no rows built: ' + e); rows = []; }
var n = {};
rows.forEach(function (r) { if (r.code) n[r.code] = (n[r.code] || 0) + 1; });
var root = document.createElement('div');
root.id = 'haide-iscar-x'; root.style.display = 'none';
var drop = [], noid = [];
rows.forEach(function (j) {
if (!OK1.test(j.title) || BAD.test(j.title)) { drop.push(j.id); return; }
var it = document.createElement('div'), add = function (k, v) { if (!v) return; var e = document.createElement('span'); e.className = k; e.textContent = v; it.appendChild(e); };
it.className = 'haide-job';
var t = j.title.replace(/\s*[-–]?\s*JB\s*-?\s*\d+\s*$/, '');
if (t === j.title) t = j.title.replace(/\s*JB\s*-?\s*\d+\s*/, ' ').replace(/ {2,}/g, ' ').trim();
var a = document.createElement('a'); a.className = 'haide-link'; a.href = j.href; a.textContent = t; it.appendChild(a);
if (j.code && n[j.code] === 1) add('__ai-externalJobId', 'iscar-' + j.code); else noid.push(j.id);
add('__ai-department', j.dep); add('__ai-description', j.d); add('__ai-requirements', j.q);
add('__ai-location', j.loc); add('__ai-publishDate', j.date);
var hold = document.createElement('div'); hold.className = 'haide-form'; hold.appendChild(document.importNode(j.form, true)); it.appendChild(hold);
root.appendChild(it);
});
document.body.appendChild(root);
;(function () {
var EXTRACTOR_VERSION = 3;
function extractFormSchema(form) {
var pageUrl = window.location.href;
var actionRaw = (form.getAttribute('action') || '').trim();
var actionAttribute = actionRaw;
try { if (actionRaw) actionAttribute = new URL(actionRaw, pageUrl).toString(); } catch (e) {}
var action = form.getAttribute('action') || '';
var method = (form.getAttribute('method') || 'GET').toUpperCase();
var enctype = form.getAttribute('enctype');
var fields = [];
var honeypots = [];
var radios = {};
var els = form.querySelectorAll('input, select, textarea');
for (var i = 0; i < els.length; i++) {
var el = els[i];
var tag = el.tagName.toLowerCase();
var type = tag === 'input' ? ((el.getAttribute('type') || 'text').toLowerCase()) : tag;
if (type === 'submit' || type === 'button' || type === 'image' || type === 'reset') continue;
var name = el.getAttribute('name') || '';
var style = (el.getAttribute('style') || '').toLowerCase();
var isOffscreen = style.indexOf('-99999') !== -1 || style.indexOf('display:none !important') !== -1 || style.indexOf('display: none !important') !== -1;
var ancestorHint = '';
var ancestorHidden = false;
for (var a = el.parentElement; a && a !== form; a = a.parentElement) {
ancestorHint += ' ' + (a.id || '') + ' ' + (typeof a.className === 'string' ? a.className : '');
if (ancestorHidden) continue;
var acs = window.getComputedStyle(a);
var apv = a.parentElement ? window.getComputedStyle(a.parentElement).visibility : 'visible';
var tiny = (/px$/.test(acs.width) && parseFloat(acs.width) <= 1) || (/px$/.test(acs.height) && parseFloat(acs.height) <= 1);
var aclip = (acs.clip || '').replace(/\s+/g, '');
var aclipPath = (acs.clipPath || '').replace(/\s+/g, '');
ancestorHidden =
acs.display === 'none' ||
(acs.visibility === 'hidden' && apv !== 'hidden') ||
(tiny && (acs.overflow || '').indexOf('hidden') !== -1) ||
aclip === 'rect(0px,0px,0px,0px)' ||
aclipPath === 'inset(50%)' ||
aclipPath === 'inset(100%)';
}
var isHpName = /\b(hp[_-]|honeypot|maspik|nickname|malkodet)/i.test(name + ' ' + (el.id || '') + ' ' + (el.className || '') + ancestorHint);
var nearLabel = '';
if (el.parentElement) {
var sibs = el.parentElement.children;
for (var si = 0; si < sibs.length; si++) if (sibs[si] !== el && sibs[si].tagName === 'LABEL') nearLabel += ' ' + (sibs[si].textContent || '');
}
var askText = (nearLabel + ' ' + (el.getAttribute('placeholder') || '')).replace(/\s+/g, ' ');
var asksEmpty =
/leave (this|the) field (empty|blank)|do not fill|don't fill/i.test(askText) ||
['השאר שדה זה ריק', 'השאירו שדה זה ריק', 'יש להשאיר ריק', 'אין למלא', 'לא למלא', 'נא לא למלא'].some(function (h) { return askText.indexOf(h) !== -1; });
var isTrap = false;
var isTextLike = /^(text|email|tel|url|number|search|password|textarea)$/.test(type);
var emptied = false;
var prefilled = false;
if (isTextLike) {
var cs = window.getComputedStyle(el);
var pv = el.parentElement ? window.getComputedStyle(el.parentElement).visibility : 'visible';
emptied = (tag === 'textarea' ? (el.textContent || '').trim() !== '' : (el.getAttribute('value') || '').trim() !== '') && el.value === '';
prefilled = !emptied && (el.value || '').trim() !== '';
var styleHidden =
cs.display === 'none' ||
(cs.visibility === 'hidden' && pv !== 'hidden') ||
cs.opacity === '0' ||
(/px$/.test(cs.width) && parseFloat(cs.width) <= 1) ||
(/px$/.test(cs.height) && parseFloat(cs.height) <= 1) ||
((cs.position === 'absolute' || cs.position === 'fixed') &&
((parseFloat(cs.left) || 0) <= -1000 || (parseFloat(cs.top) || 0) <= -1000)) ||
(el.getAttribute('aria-hidden') === 'true' && el.getAttribute('tabindex') === '-1');
isTrap = emptied || ((styleHidden || ancestorHidden) && !prefilled) || asksEmpty;
}
if ((isOffscreen || isHpName || isTrap) && type !== 'hidden') {
if (name && honeypots.indexOf(name) === -1) honeypots.push(name);
continue;
}
var label = '';
if (el.id) {
var safeId = el.id.replace(/"/g, '\\"');
var lab = form.querySelector('label[for="' + safeId + '"]');
if (lab) label = (lab.textContent || '').replace(/\s+/g, ' ').trim();
}
if (!label) {
var parentLabel = el.closest('label');
if (parentLabel) label = (parentLabel.textContent || '').replace(/\s+/g, ' ').trim();
}
var required = el.hasAttribute('required') || el.getAttribute('aria-required') === 'true';
if (type === 'radio') {
var option = { value: el.value, label: label };
if (name && radios[name]) {
radios[name].options.push(option);
radios[name].required = radios[name].required || required;
continue;
}
var fs = el.closest('fieldset');
var legend = fs ? fs.querySelector('legend') : null;
var groupLabel = legend ? (legend.textContent || '').replace(/\s+/g, ' ').trim() : '';
var group = { name: name, fieldType: 'radio', label: groupLabel || name, required: required, tagName: tag, options: [option] };
if (name) radios[name] = group;
fields.push(group);
continue;
}
if (!label) label = el.getAttribute('placeholder') || el.getAttribute('aria-label') || '';
var rec = { name: name, fieldType: type, label: label, required: required, tagName: tag };
if (type === 'hidden') rec.value = el.value || '';
if (prefilled) { rec.value = el.value; rec.prefilled = true; }
if (type === 'file') {
var accept = el.getAttribute('accept');
if (accept) rec.accept = accept;
if (el.multiple) rec.multiple = true;
}
if (tag === 'select') {
var opts = el.querySelectorAll('option'); var options = [];
for (var k = 0; k < opts.length; k++) {
options.push({ value: opts[k].value, label: (opts[k].textContent || '').replace(/\s+/g, ' ').trim() });
}
rec.options = options;
}
fields.push(rec);
}
var schema = { actionUrl: action, actionAttribute: actionAttribute, pageUrl: pageUrl, method: method };
if (enctype) schema.enctype = enctype;
schema.fields = fields;
schema.honeypots = honeypots;
schema.capturedAt = new Date().toISOString();
schema.captureSource = 'script';
schema.extractorVersion = EXTRACTOR_VERSION;
return schema;
}
function pickForm(scope) {
var forms = scope.querySelectorAll('form');
var best = null, bestScore = -1;
for (var i = 0; i < forms.length; i++) {
var f = forms[i];
var name = (f.getAttribute('name') || '').toLowerCase();
var role = (f.getAttribute('role') || '').toLowerCase();
if (role === 'search' || /search/.test(name)) continue;
var inputs = f.querySelectorAll('input:not([type="hidden"]), select, textarea');
var visibleCount = 0;
for (var j = 0; j < inputs.length; j++) {
var t = (inputs[j].getAttribute('type') || '').toLowerCase();
if (t === 'submit' || t === 'button' || t === 'image' || t === 'reset') continue;
visibleCount++;
}
if (visibleCount > bestScore) { bestScore = visibleCount; best = f; }
}
return bestScore >= 1 ? best : null;
}
try {
document.querySelectorAll('#haide-iscar-x > div.haide-job').forEach(function (item) {
if (item.querySelector('[data-extracted-form]')) return;
var f = pickForm(item);
if (!f) return;
var schema = extractFormSchema(f);
var s = document.createElement('span');
s.setAttribute('data-extracted-form', '1');
s.style.display = 'none';
s.textContent = JSON.stringify(schema);
item.appendChild(s);
});
} catch (e) {}
})();
root.querySelectorAll('div.haide-job').forEach(function (it) {
var s = it.querySelector('[data-extracted-form]'), h = it.querySelector('.haide-form');
if (!s || !h) { drop.push('form:' + it.querySelector('a.haide-link').href); return; }
var o = JSON.parse(s.textContent); o.pageUrl = it.querySelector('a.haide-link').href; s.remove(); h.remove();
['__ai-applicationInfo', '__ai-formData'].forEach(function (k) { var e = document.createElement('span'); e.className = k; e.textContent = JSON.stringify(o); it.appendChild(e); });
});
if (drop.join().indexOf('form:') < 0) root.id = 'haide-iscar';
console.log('[iscar] jobs ' + root.children.length + ' of ' + rows.length + ', dropped ' + drop.join(' ') + ', no id ' + noid.join(' ') + ', ' + (Date.now() - T0) + ' ms');
