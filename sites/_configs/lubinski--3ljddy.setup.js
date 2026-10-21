// lubinski (see notes.md): all /job/page/N/ + job pages, credentials omit, 20 s each, all-or-nothing; job page
// redirected to /job/ = closed, named. Apply = the AJAX request (LRN-FORM-17). No captcha, no consent box.
if (document.getElementById('haide-lub')) return;
var T0 = Date.now(), B = 'https://www.lubinski.co.il/job/', S = String.fromCharCode;
var OK1 = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}]/u;
var BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var MATH = new RegExp('[' + String.fromCodePoint(0x1D400) + '-' + String.fromCodePoint(0x1D7FF) + ']', 'gu');
var Q = new RegExp('[' + S(0x5F4, 0x201D, 0x201C) + ']', 'g');
var X = function (s, i) { return new RegExp('^(' + s + ')[\\s?:!.' + S(0x2013) + '-]*$', i); };
var RH = X('דרישות( התפקיד| המשרה| חובה)?|את מי אנחנו מחפשים|requirements|qualifications', 'i');
var RS = X('מאפיינים אישיותיים|מאפיינים אישיים|כישורים (אישיים|נדרשים)|יתרון|יתרונות');
var DL = X('תיאור (משרה|המשרה|התפקיד)|מהות (התפקיד|המשרה)( וניהול שוטף)?');
var DS = X('מה אנחנו מציעים|מה מחכה (לך|לכם) בתפקיד|במסגרת התפקיד|תחומי אחריות( עיקריים)?|תמצית התפקיד ותחומי אחריות|מה כולל התפקיד|התפקיד כולל|מה תעשו (אצלנו|בפועל)|למה כדאי לכם להצטרף אלינו|תנאי המשרה והסדר שעות|ימים ושעות המשרה|היקף המשרה|שווה לעבוד (אצלנו|בלובינסקי)');
var TAIL = /משרה זו פונה|הזדמנות נדירה להצטרף|חושב\/ת ש/;
// text form | city.csv row (verbatim). A city on the title or a work line wins over the tag (owner, STOP 1),
// unless the title and the text name different cities: then the tag.
var CT = [['תל אביב|תל-אביב|ת"א', 'תל אביב-יפו'], ['פתח תקווה|פתח תקוה|פ"ת', 'פתח תקווה'], ['ראשון לציון|ראשל"צ', 'ראשון לציון'],
['רמת גן', 'רמת גן'], ['ראש העין', 'ראש העין'], ['מודיעין(?! עלית)', 'מודיעין'], ['קריית מלאכי|קרית מלאכי', 'קרית מלאכי'],
['אשדוד', 'אשדוד'], ['באר שבע|ב"ש', 'באר שבע'], ['נתניה', 'נתניה'], ['עמק חפר', 'עמק חפר'], ['ירושלים', 'ירושלים'], ['חיפה', 'חיפה']];
CT.forEach(function (c) {
c[3] = new RegExp('(^|[\\s(\\[/,.-]|[\\s(](ו?ב|ו?ל|ו))(' + c[0] + ')(?![א-ת])');
c[4] = new RegExp('(^|[^א-ת])(ו?ב|ו|ל?סניף |באזור |מיקום המשרה:? )(' + c[0] + ')(?![א-ת])');
});
// owner-reviewed: JB -> [check on title+text, value or null = the tags]
var OV = { 'JB-3369': [/השירות שורק/, 'ראשון לציון'] };
var sq = function (s) { return String(s || '').split(S(160)).join(' ').replace(/[ \t]+/g, ' ').trim(); };
var tx = function (e) { return sq((e || {}).textContent); };
var get = async function (u, cl) {
var ac = new AbortController(), k = setTimeout(function () { ac.abort(); }, 20000);
try {
var r = await fetch(u, { credentials: 'omit', cache: 'no-store', signal: ac.signal });
if (cl && r.ok && r.redirected && r.url === B) return null;
if (!r.ok || r.redirected) throw new Error(r.status + ' ' + r.url + ' ' + u);
return new DOMParser().parseFromString(await r.text(), 'text/html');
} finally { clearTimeout(k); }
};
var pool = async function (xs, f) {
var out = [], i = 0;
await Promise.all([0, 1, 2, 3, 4, 5].map(async function () { while (i < xs.length) { var j = i++; out[j] = await f(xs[j]); } }));
return out;
};
var cards = function (d) {
var cs = d.querySelectorAll('div.job-prev.from-archive');
if (!cs.length) throw new Error('no card');
return Array.from(cs).map(function (c) {
var a = c.querySelector('.job-prev__right a'), h = a && a.querySelector('h4');
if (!h || !/^https:\/\/www\.lubinski\.co\.il\/job\/[^/?#]+\/$/.test(a.href)) throw new Error('card');
return { href: a.href, jb: (/מספר משרה:\s*(JB-\d+)$/.exec(tx(c.querySelector('.job-prev__middle .job-contnet__gray'))) || [])[1] || '',
title: tx(h).replace(MATH, function (x) { return x.normalize('NFKC'); }) };
});
};
var job = function (r, d) {
var b = d.querySelector('.job-contnet.wp-content'), f = d.querySelector('form.send-cv-form'), m = {};
if (!b || !f || !d.querySelector('h1') || tx(d.querySelector('#job_id')) !== r.jb) throw new Error('job page ' + r.href);
d.querySelectorAll('.job-meta__single').forEach(function (e) { m[tx(e.querySelector('.job-meta__small')).replace(/:$/, '')] = tx(e.querySelector('.job-meta__big')); });
var c = b.cloneNode(true);
c.querySelectorAll('br').forEach(function (x) { x.replaceWith('\n'); });
c.querySelectorAll('p,div,li,ul,ol,h2,h3,h4').forEach(function (e) { e.append('\n'); });
var D = m['היקף המשרה'] ? ['היקף המשרה: ' + m['היקף המשרה']] : [], R = [], inR = false, tail = false, L = [];
c.textContent.split('\n').map(sq).filter(Boolean).forEach(function (l) {
var bare = l.replace(/^[^\p{L}\p{N}]+/u, '').replace(Q, '"');
if (bare.length <= 45 && !tail) {
if (RH.test(bare)) { inR = true; return; }
if (DL.test(bare)) { inR = false; return; }
if (RS.test(bare)) inR = true; else if (DS.test(bare)) inR = false;
}
if (inR && TAIL.test(bare)) tail = true;
(inR && !tail ? R : D).push(l);
if (!inR && !tail) L.push(bare);
});
var tags = (m['איזור'] || '').replace(Q, '"').split(',').map(sq).filter(Boolean);
var cue = L.filter(function (l, i) { return (i < 3 || /^(מיקום|מקום העבודה|משרה מלאה|משרה חלקית)/.test(l)) && !/עבודת שטח|נסיעות|ניידות/.test(l); });
var ti = r.title.replace(Q, '"'), a = CT.filter(function (t) { return t[3].test(ti); }), x = CT.filter(function (t) { return cue.some(function (l) { return t[4].test(l); }); });
var no = function (p, q) { return p.some(function (t) { return q.indexOf(t) < 0; }); };
var tc = CT.filter(function (t) { return a.indexOf(t) >= 0 || x.indexOf(t) >= 0; });
var loc = tc.length && !(a.length && x.length && no(a, x) && no(x, a)) ? tc.map(function (t) { return t[1]; }) : tags;
var ov = OV[r.jb];
if (ov && ov[0].test(ti + '\n' + D.join('\n'))) loc = ov[1] ? [ov[1]] : tags;
return { d: D.join('\n'), q: R.join('\n'), dep: m['תחום'], loc: loc.join(' | '), form: f, pt: sq(d.title) };
};
var rows = [], closed = [], drop = [];
try {
var p1 = await get(B);
var last = Math.max.apply(null, [1].concat(Array.from(p1.querySelectorAll('.page-numbers')).map(function (a) { return +tx(a) || 1; })));
var pages = [p1].concat(await pool(Array.from({ length: last - 1 }, function (_, k) { return B + 'page/' + (k + 2) + '/'; }), function (u) { return get(u); }));
pages.forEach(function (d) { rows = rows.concat(cards(d)); });
var bodies = await pool(rows, async function (r) { var d = await get(r.href, 1); return d && job(r, d); });
rows = rows.filter(function (r, i) { if (!bodies[i]) closed.push(r.jb); return Object.assign(r, bodies[i]) && bodies[i]; });
if (closed.length * 2 >= rows.length + closed.length) throw new Error('closed ' + closed.length);
} catch (e) { console.log('[lub] no rows built: ' + e); rows = []; }
var root = document.createElement('div'), W = ' wp-exclude-emoji';
root.id = 'haide-lub-x'; root.className = W; root.style.display = 'none';
rows.forEach(function (j) {
if (/לא מצאת(ם|ן)? משרה/.test(j.title)) { drop.push('catchall:' + j.jb); return; }
if (!OK1.test(j.title) || BAD.test(j.title)) { drop.push('lang:' + j.jb); return; }
var it = document.createElement('div'), add = function (k, v, t) { if (!v) return; var e = document.createElement(t || 'span'); e.className = k + W; e.textContent = v; it.appendChild(e); return e; };
it.className = 'haide-job' + W;
add('haide-link', j.title, 'a').href = j.href;
if (j.jb) add('__ai-externalJobId', 'lubinski-' + j.jb);
add('__ai-department', j.dep); add('__ai-description', j.d); add('__ai-requirements', j.q); add('__ai-location', j.loc);
var f = document.importNode(j.form, true), hid = { action: 'send_cv', src: j.href, job_title: j.pt, job_id: j.jb };
f.setAttribute('action', 'https://www.lubinski.co.il/wp-admin/admin-ajax.php'); f.setAttribute('enctype', 'multipart/form-data');
var tel = f.querySelector('input[name="tel"]'), cv = f.querySelector('input[type="file"]');
if (tel) tel.name = 'phone';
if (cv) cv.name = 'file';
['name', 'phone', 'email', 'file'].forEach(function (n) { var e = f.querySelector('input[name="' + n + '"]'); if (e) e.required = true; });
Object.keys(hid).forEach(function (k) { var e = document.createElement('input'); e.type = 'hidden'; e.name = k; e.value = hid[k]; f.appendChild(e); });
add('haide-form', ' ', 'div').appendChild(f);
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
document.querySelectorAll('#haide-lub-x > div.haide-job').forEach(function (item) {
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
var s = it.querySelector('[data-extracted-form]'), h = it.querySelector('.haide-form'), a = it.querySelector('a.haide-link');
if (!s || !h) { drop.push('form:' + a.href); return; }
var o = JSON.parse(s.textContent); o.pageUrl = a.href; s.remove(); h.remove();
['__ai-applicationInfo', '__ai-formData'].forEach(function (k) { var e = document.createElement('span'); e.className = k; e.textContent = JSON.stringify(o); it.appendChild(e); });
});
if (drop.join().indexOf('form:') < 0) root.id = 'haide-lub';
console.log('[lub] jobs ' + root.children.length + '; closed ' + closed.join(' ') + '; dropped ' + drop.join(' ') + '; ' + (Date.now() - T0) + ' ms');
