// GETs all /jobs/?pg=N and job pages (credentials omit, LRN-SETUP-27; 20 s per fetch; 8 in flight). ALL-OR-
// NOTHING: a failed fetch, empty page, id count != printed total or a job page without h1/body/number/form -> no row.
// Requirement headings -> requirements, labels dropped. Location: region tags (locationMap); a city on a work-
// location line wins inside a tagged region or untagged; OV (2026-10-21): that job's city while its ad names it.
// Apply: CF7 form 652 via the shared template, comment lines cut; consent "acceptance" not pre-checked,
// marked required: CF7 refuses without it.
if (document.getElementById('haide-elad')) return;
var T0 = Date.now(), B = 'https://careers.eladsoft.com/jobs/';
var OK1 = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}]/u;
var BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var MATH = new RegExp('[' + String.fromCodePoint(0x1D400) + '-' + String.fromCodePoint(0x1D7FF) + ']', 'gu');
var PIN = String.fromCodePoint(0x1F4CD), Q = new RegExp('[' + String.fromCharCode(0x5F4, 0x201D, 0x201C) + ']', 'g');
var RH = /^(מה (אנחנו|אנו) מחפשים|מה (צריך|חובה) להביא|מה נדרש|דרישות( (התפקיד|חובה|המשרה|הסף))?|יתרונות|כישורים|תנאי סף|what we'?re looking for|requirements|qualifications|nice to have|advantages)[\s?:!.]*$/i;
var DH = /^(קצת על התפקיד|תיאור( (התפקיד|משרה|המשרה))?|מה בתפקיד|מה עושים בתפקיד|מה כולל התפקיד|תחומי אחריות|(a bit )?about the role|responsibilities|the role)[\s?:!.]*$/i;
var CTA = /(שלח|הגש)\S*.{0,40}(קו"?ח|קורות חיים)|להגשת מועמדות/;
var REG = { 'גוש דן': 'אזור מרכז', 'השפלה': 'אזור שפלה', 'השרון': 'אזור השרון', 'חיפה והקריות': 'אזור צפון', 'ירושלים יו"ש': 'אזור ירושלים', 'דרום': 'אזור דרום', 'צפון': 'אזור צפון' };
// text form | city.csv row | its city.csv region
var CT = [['תל אביב-יפו|תל אביב|ת"א', 'תל אביב-יפו', 'מ'], ['ירושלים', 'ירושלים', 'י'], ['רמת גן', 'רמת גן', 'מ'], ['בני ברק', 'בני ברק', 'מ'],
['פתח תקווה|פתח תקוה|פ"ת', 'פתח תקווה', 'מ'], ['ראשון לציון', 'ראשון לציון', 'מ'], ['אור יהודה', 'אור יהודה', 'מ'], ['לוד|רמלה', 'רמלה לוד', 'מ'],
['נצרת', 'נצרת', 'צ'], ['חיפה', 'חיפה', 'צ'], ['בית שמש', 'בית שמש', 'י'], ['מודיעין(?! עלית)', 'מודיעין', 'י'], ['חדרה', 'חדרה', 'ש'], ['נתניה', 'נתניה', 'ש']];
var OV = { 1005954: 1, 1007244: 4, 1007701: 2 };
var RL = { 'מ': 'אזור מרכז', 'י': 'אזור ירושלים', 'צ': 'אזור צפון', 'ש': 'אזור השרון' };
CT.forEach(function (c) { c[3] = new RegExp('^(' + c[0] + ')$'); c[0] = new RegExp('(^|[:,|(–-] *|[^א-ת](וב|ב|מ|ל|ב?אזור ))(' + c[0] + ')(?![א-ת])'); });
var sq = function (s) { return String(s || '').split(String.fromCharCode(160)).join(' ').replace(/[ \t]+/g, ' ').trim(); };
var get = async function (u) {
var ac = new AbortController(), k = setTimeout(function () { ac.abort(); }, 20000);
try {
var r = await fetch(u, { credentials: 'omit', cache: 'no-store', signal: ac.signal });
if (!r.ok || r.redirected) throw new Error(r.status + (r.redirected ? ' redirected' : '') + ' ' + u);
return new DOMParser().parseFromString(await r.text(), 'text/html');
} finally { clearTimeout(k); }
};
var pool = async function (xs, f) {
var out = new Array(xs.length), i = 0;
await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map(async function () { while (i < xs.length) { var j = i++; out[j] = await f(xs[j]); } }));
return out;
};
var tags = function (el) { return el ? Array.from(el.querySelectorAll('a.job-tag')).map(function (a) { return sq(a.textContent); }) : []; };
var cards = function (d) {
var cs = d.querySelectorAll('article.job-card');
if (!cs.length) throw new Error('no card');
return Array.from(cs).map(function (c) {
var a = c.querySelector('h3.job-title a'), id = (/(\d+)\s*$/.exec(sq((c.querySelector('span.job-id') || {}).textContent)) || [])[1];
var m = /^https:\/\/careers\.eladsoft\.com\/jobs\/(\d+)\/$/.exec(a ? a.href : '');
if (!m || m[1] !== id) throw new Error('card ' + (a && a.href));
return { id: id, href: a.href, title: sq(a.textContent).replace(MATH, function (x) { return x.normalize('NFKC'); }),
areas: tags(c.querySelector('.job-areas')), cats: tags(c.querySelector('.job-tags:not(.job-areas)')) };
});
};
var job = function (r, d) {
var n = d.querySelector('.single-job-notes'), f = d.querySelector('form.wpcf7-form'), jn = sq((d.querySelector('.job-number') || {}).textContent);
var ji = f && f.querySelector('input[name="job-id"]');
if (!d.querySelector('h1') || !n || jn.indexOf(r.id) < 0 || !ji || ji.value !== r.id) throw new Error('job page ' + r.href);
var c = n.cloneNode(true), H = String.fromCharCode(1);
c.querySelectorAll('h1,h2,h3,h4').forEach(function (h) { h.replaceWith('\n' + H + sq(h.textContent) + '\n'); });
c.querySelectorAll('br').forEach(function (b) { b.replaceWith('\n'); });
c.querySelectorAll('p,div,li,ul,ol').forEach(function (e) { e.append('\n'); });
var D = [], R = [], inR = false, tail = false, cue = [];
c.textContent.split('\n').map(sq).filter(Boolean).forEach(function (l) {
var h = l.charAt(0) === H; l = l.replace(H, '');
var bare = l.replace(/^[^\p{L}\p{N}]+/u, '').replace(Q, '"');
if (!tail && bare.length <= 40 && RH.test(bare)) { inR = true; return; }
if (!tail && bare.length <= 40 && DH.test(bare)) { inR = false; return; }
if (h) inR = false;
if (inR && CTA.test(l.replace(Q, '"'))) tail = true;
(inR && !tail ? R : D).push(l);
var pipe = bare.split('|').map(sq);
if (/נסיע|לקוח|ניידת|בין אתרי/.test(bare)) return;
if (/^(מיקום|מקום העבודה|העבודה|עבודה|משרה|נכונות ל(עבודה|משרה))/.test(bare) && !/^משרה\s*\d/.test(bare) || l.indexOf(PIN) === 0) cue.push(bare);
else if (pipe.length > 2) cue.push(pipe.filter(function (s) { return CT.some(function (t) { return t[3].test(s); }); }).join(', '));
});
var tc = [];
cue.forEach(function (l) { CT.forEach(function (t) { if (t[0].test(l) && tc.indexOf(t) < 0) tc.push(t); }); });
var tr = r.areas.map(function (a) { return REG[a.replace(Q, '"')]; });
var loc = tc.length && (!r.areas.length || tc.every(function (t) { return tr.indexOf(RL[t[2]]) >= 0; })) ? tc.map(function (t) { return t[1]; }) : r.areas;
var ov = CT[OV[r.id]];
if (ov && ov[0].test(D.concat(R).join('\n'))) loc = [ov[1]];
return { d: D.join('\n'), q: R.join('\n'), loc: loc.join(' | '), form: f };
};
var rows = [];
try {
var p1 = await get(B), total = +((/(\d+)\s*משרות/.exec(sq((p1.querySelector('.jobs-count') || {}).textContent)) || [])[1]);
var last = Math.max.apply(null, Array.from(p1.querySelectorAll('.jobs-pagination a')).map(function (a) { return +((/[?&]pg=(\d+)/.exec(a.href) || [])[1] || 1); }));
if (!total || !(last >= 1)) throw new Error('count/pager');
var pages = [p1].concat(await pool(Array.from({ length: last - 1 }, function (_, k) { return B + '?pg=' + (k + 2); }), get));
pages.forEach(function (d) { rows = rows.concat(cards(d)); });
var n = new Set(rows.map(function (r) { return r.id; })).size;
if (n !== total) throw new Error('jobs ' + n + ' vs printed ' + total);
var bodies = await pool(rows, async function (r) { return job(r, await get(r.href)); });
rows.forEach(function (r, i) { Object.assign(r, bodies[i]); });
} catch (e) { console.log('[elad] no rows built: ' + e); rows = []; }
var root = document.createElement('div');
root.id = 'haide-elad-x'; root.style.display = 'none';
var drop = [];
rows.forEach(function (j) {
if (!OK1.test(j.title) || BAD.test(j.title)) { drop.push(j.id); return; }
var it = document.createElement('div'), add = function (k, v) { if (!v) return; var e = document.createElement('span'); e.className = k; e.textContent = v; it.appendChild(e); };
it.className = 'haide-job';
var a = document.createElement('a'); a.className = 'haide-link'; a.href = j.href; a.textContent = j.title; it.appendChild(a);
add('__ai-externalJobId', 'eladsoft-' + j.id); add('__ai-department', j.cats.join(', ')); add('__ai-description', j.d);
add('__ai-requirements', j.q); add('__ai-location', j.loc);
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
document.querySelectorAll('#haide-elad-x > div.haide-job').forEach(function (item) {
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
if (!s || !h) { drop.push('form:' + it.querySelector('.__ai-externalJobId').textContent); return; }
var o = JSON.parse(s.textContent); o.pageUrl = it.querySelector('a.haide-link').href; s.remove();
h.querySelectorAll('.wpcf7-acceptance:not(.optional) input').forEach(function (e) { o.fields.forEach(function (x) { if (x.name === e.name) x.required = true; }); });
h.remove();
['__ai-applicationInfo', '__ai-formData'].forEach(function (k) { var e = document.createElement('span'); e.className = k; e.textContent = JSON.stringify(o); it.appendChild(e); });
});
if (drop.join().indexOf('form:') < 0) root.id = 'haide-elad';
console.log('[elad] jobs ' + root.children.length + ' of ' + rows.length + ', dropped ' + drop.join(' ') + ', ' + (Date.now() - T0) + ' ms');
