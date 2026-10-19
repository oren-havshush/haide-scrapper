/* CET (מטח), cet.ac.il/jobs/: WordPress job cards fed by Comeet (2A.00B); one hidden row per job in #haide-cet.
   Comeet jobs: the cards' UIDs, data from the careers-api, id = UID, apply = the job's Comeet form (blob).
   Arabic-only jobs (/jobs/?lang=ar, decided 2026-10-18): body from the card, id cet-<n>, apply = CF7 1603 on
   the job page; "كل/جميع مناطق البلاد" in the title or the first body line -> פריסה ארצית.
   Dates: each job page's JSON-LD (LRN-AGE-6). All-or-nothing, except the date.
   Full description: the 2026-10-18 card (.scratch/batch-flow/2026-10-18-b/sites/cet/card.md). */

var NL = String.fromCharCode(10);
/* fromCharCode, never invisible chars in a literal (CLAUDE.md). */
var ZW = new RegExp('[' + String.fromCharCode(0xFEFF, 0x200B, 0x200C, 0x200D, 0x2060, 0x200E, 0x200F) + ']', 'g');
var NBSP = new RegExp(String.fromCharCode(0x00A0), 'g');
var QUOTES = new RegExp('["\'' + String.fromCharCode(0x201D, 0x2019, 0x05F4, 0x05F3) + ']', 'g');
var BULLETS = [String.fromCharCode(0x2022), String.fromCharCode(0x00B7)];
var OK = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}]/u;
var BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var DIA = new RegExp('[' + String.fromCharCode(0x064B) + '-' + String.fromCharCode(0x0652) + ']', 'g');
var COMP = '2A.00B', TOKEN = 'A2B472D1E815B833D025B83472D1456A2B0';
var REQ_TAIL = /^יתרון|[-–]\s*(חובה|יתרון|mandatory|an advantage|advantage)\s*\.?$/i;
var DESC_LABEL = /^(תיאור התפקיד|תיאור משרה|description|job description)\s*:?$/i;

function aiClean(t) {
  t = String(t || '').replace(ZW, '').replace(NBSP, ' ');
  var lines = t.split(NL), out = [];
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i].replace(/[ \t]+/g, ' ').trim();
    if (!l) { if (out.length && out[out.length - 1] !== '') out.push(''); continue; }
    out.push(l);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join(NL).trim();
}

function isBullet(t) { return BULLETS.indexOf(t.charAt(0)) !== -1; }

/* HTML -> lines, parsed inert; li = a list item or a bulleted paragraph. */
function htmlLines(html) {
  var doc = new DOMParser().parseFromString('<div>' + String(html || '') + '</div>', 'text/html');
  var root = doc.body.firstChild, out = [];
  if (!root) return out;
  var blocks = root.querySelectorAll('li, p, h1, h2, h3, h4, h5, h6');
  for (var i = 0; i < blocks.length; i++) {
    var b = blocks[i];
    if (b.tagName !== 'LI' && b.closest('li')) continue;
    var c = b.cloneNode(true), br = c.querySelectorAll('br');
    for (var k = 0; k < br.length; k++) br[k].replaceWith(NL);
    var sub = b.tagName === 'LI' ? c.querySelectorAll('ul, ol') : [];
    for (var s = 0; s < sub.length; s++) sub[s].remove();
    var parts = aiClean(c.textContent).split(NL);
    for (var j = 0; j < parts.length; j++) {
      if (parts[j]) out.push({ t: parts[j], li: b.tagName === 'LI' || isBullet(parts[j]) });
    }
  }
  if (!blocks.length) {
    var all = aiClean(root.textContent).split(NL);
    for (var m = 0; m < all.length; m++) if (all[m]) out.push({ t: all[m], li: isBullet(all[m]) });
  }
  return out;
}

/* JSON-LD WebPage datePublished of this url, Israel date, or ''. */
function ldDate(doc, href) {
  var ld = doc.querySelectorAll('script[type="application/ld+json"]');
  for (var s = 0; s < ld.length; s++) {
    var j = null;
    try { j = JSON.parse(ld[s].textContent); } catch (e) { continue; }
    var gr = (j && j['@graph']) || [j];
    for (var t = 0; t < gr.length; t++) {
      var o = gr[t] || {};
      if (o['@type'] !== 'WebPage' || !o.datePublished) continue;
      if (decodeURI(String(o.url || '')).toLowerCase().replace(/^https?:/, '') !== decodeURI(href).toLowerCase().replace(/^https?:/, '')) continue;
      var dt = new Date(o.datePublished);
      if (isNaN(dt)) continue;
      return dt.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    }
  }
  return '';
}

/* The slug must name the title, else an older post (LRN-AGE-6). */
function slugNames(href, title) {
  var slug = decodeURI(href.split('/jobs/')[1] || '').split('?')[0].replace(/\/$/, '').toLowerCase().replace(/-\d+$/, '');
  var tslug = title.toLowerCase().replace(QUOTES, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  return !!slug && tslug.indexOf(slug) === 0;
}

function aiInject(host, cls, val, tag) {
  if (!val) return;
  var s = document.createElement(tag || 'span');
  s.className = cls;
  s.textContent = val;
  host.appendChild(s);
}

if (!document.getElementById('haide-cet')) {
  var built = [];
  try {
    var cards = [];
    for (var w = 0; w < 20; w++) {
      cards = document.querySelectorAll('.job-card');
      if (cards.length) break;
      await new Promise(function (r) { setTimeout(r, 500); });
    }
    if (!cards.length) throw new Error('no job card on the page');
    var onPage = [], pageLink = {};
    for (var q = 0; q < cards.length; q++) {
      var ap = cards[q].querySelector('a.apply-btn[href*="external="]');
      var um = ap ? /[?&]external=([0-9A-Z]{2}\.[0-9A-Z]{3})(?:&|$)/i.exec(ap.getAttribute('href') || '') : null;
      if (!um) { console.log('[cet] card without a Comeet UID left out: ' + (cards[q].textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)); continue; }
      var share = cards[q].querySelector('[data-url*="/jobs/"], [data-clipboard-text*="/jobs/"]');
      var link = share ? (share.getAttribute('data-url') || share.getAttribute('data-clipboard-text') || '') : '';
      if (!link) link = ap.href.split('?')[0];
      link = new URL(link.trim(), location.href).href.split(/[?#]/)[0].replace(/\/+$/, '/');
      if (!/^https:\/\/cet\.ac\.il\/jobs\/[^/]+\/$/.test(link)) throw new Error('no job page for ' + um[1]);
      if (!pageLink[um[1]]) { pageLink[um[1]] = link; onPage.push(um[1]); }
    }
    var API = 'https://www.comeet.co/careers-api/2.0/company/' + COMP + '/positions';
    var lr = await fetch(API + '?token=' + TOKEN + '&details=true', { cache: 'no-store' });
    if (!lr.ok) throw new Error('positions list ' + lr.status);
    var list = await lr.json();
    if (!list || typeof list.length !== 'number' || !list.length) throw new Error('positions list is empty or not a list');
    var byUid = {};
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].uid) byUid[String(list[i].uid)] = list[i];
    var keep = [];
    for (var o = 0; o < onPage.length; o++) {
      var uid = onPage[o], p = byUid[uid];
      if (!p) { console.log('[cet] ' + uid + ' is on the page but not in Comeet: left out'); continue; }
      if (!p.location || p.location.country !== 'IL') continue;
      var title = String(p.name || '').replace(/\s+/g, ' ').trim();
      if (!title || !OK.test(title) || BAD.test(title)) continue;
      var det = {};
      for (var d = 0; d < (p.details || []).length; d++) det[String(p.details[d].name || '').trim()] = p.details[d].value;
      keep.push({ p: p, title: title, href: pageLink[uid], descHtml: det['Description'], reqHtml: det['Requirements'] });
    }
    if (!keep.length) throw new Error('no page card matches a Comeet position');
    var forms = await Promise.all(keep.map(function (k) {
      return fetch(API + '/' + k.p.uid + '?token=' + TOKEN, { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('position ' + k.p.uid + ' ' + r.status);
        return r.json();
      });
    }));
    /* Dates, 6 pages at a time; any failure leaves that job undated. */
    var dates = [];
    for (var g = 0; g < keep.length; g += 6) {
      var part = await Promise.all(keep.slice(g, g + 6).map(function (k) {
        return fetch(k.href, { cache: 'no-store', credentials: 'omit' }).then(function (r) {
          if (!r.ok || r.redirected) return '';
          return r.text().then(function (h) { return ldDate(new DOMParser().parseFromString(h, 'text/html'), k.href); });
        }).catch(function () { return ''; });
      }));
      dates = dates.concat(part);
    }
    for (var z = 0; z < keep.length; z++) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dates[z] || '') || !slugNames(keep[z].href, keep[z].title)) {
        if (dates[z]) console.log('[cet] ' + keep[z].p.uid + ' slug does not name the title: left undated');
        dates[z] = '';
      }
    }
    for (var n = 0; n < keep.length; n++) {
      var K = keep[n], job = K.p, desc = [], req = [], tail = [];
      var dl = htmlLines(K.descHtml).filter(function (o) { return !DESC_LABEL.test(o.t); });
      if (dl.length) desc.push(dl.map(function (o) { return o.t; }).join(NL));
      var rl = htmlLines(K.reqHtml), firstLi = -1, lastLi = -1;
      for (var x = 0; x < rl.length; x++) if (rl[x].li) { if (firstLi < 0) firstLi = x; lastLi = x; }
      for (var y = 0; y < rl.length; y++) {
        var L = rl[y];
        if (firstLi >= 0 && y < firstLi && L.t.length <= 40 && !/\.$/.test(L.t)) continue;
        if (firstLi >= 0 && y > lastLi && !REQ_TAIL.test(L.t)) tail.push(L.t); else req.push(L.t);
      }
      if (tail.length) desc.push(tail.join(NL));
      var act = 'https://www.comeet.co/careers-api/1.0/company/' + COMP + '/positions/' + job.uid + '/apply';
      var F = [['first_name', 'First name', 'text', 1], ['last_name', 'Last name', 'text', 1], ['email', 'Email', 'email', 1],
        ['phone', 'Phone', 'tel', 1], ['cv', 'Resume', 'file', 1]];
      var fields = F.map(function (f) { return { name: f[0], label: f[1], fieldType: f[2], required: !!f[3], tagName: 'INPUT' }; });
      var qs = (forms[n] && forms[n].questionnaires) || [];
      for (var a = 0; a < qs.length; a++) {
        var qq = qs[a].questions || [];
        for (var b = 0; b < qq.length; b++) {
          var qn = qq[b], ty = qn.type === 5 ? 'checkbox' : qn.type === 4 ? 'select' : qn.type === 3 ? 'radio' : 'text';
          var fo = { name: 'questionnaires:' + qs[a].id + ':' + qn.uid, label: aiClean(qn.title || qs[a].name || ''), fieldType: ty, required: !!qn.is_required, tagName: ty === 'select' ? 'SELECT' : 'INPUT' };
          if (qn.options && qn.options.length) fo.options = qn.options.map(function (o) { return { value: String(o.uid), label: aiClean(o.title) }; });
          fields.push(fo);
        }
      }
      fields.push({ name: 'grecaptcha_token', label: '', fieldType: 'hidden', required: false, tagName: 'INPUT', value: '' });
      built.push({
        uid: job.uid, title: K.title, href: K.href, date: dates[n],
        dept: String(job.department || '').replace(/\s+/g, ' ').trim(),
        city: job.location && job.location.city ? String(job.location.city).trim() : '',
        emp: job.employment_type ? String(job.employment_type).trim() : '',
        desc: aiClean(desc.join(NL + NL)), req: aiClean(req.join(NL)),
        blob: JSON.stringify({ actionUrl: act, actionAttribute: act, method: 'POST', enctype: 'multipart/form-data', fields: fields })
      });
    }
    /* Arabic-only postings (header). */
    var ar = await fetch('/jobs/?lang=ar', { cache: 'no-store' });
    if (!ar.ok) throw new Error('Arabic listing ' + ar.status);
    var ac = new DOMParser().parseFromString(await ar.text(), 'text/html').querySelectorAll('.job-card');
    var CF7 = 'https://cet.ac.il/wp-json/contact-form-7/v1/contact-forms/1603/feedback';
    for (var e = 0; e < ac.length; e++) {
      if (ac[e].querySelector('a.apply-btn[href*="external="]')) continue;
      var sp = ac[e].querySelectorAll('.job-header span');
      var at = sp.length ? aiClean(sp[0].textContent) : '', nm = sp.length > 1 ? /#(\d+)/.exec(sp[1].textContent) : null;
      if (!at || !nm || !OK.test(at) || BAD.test(at)) continue;
      var cp = ac[e].querySelector('[data-clipboard-text*="/jobs/"]');
      var ah = cp ? new URL(cp.getAttribute('data-clipboard-text').trim(), location.href).href : '';
      if (!/^https:\/\/cet\.ac\.il\/jobs\/[^/?]+\/\?lang=ar$/.test(ah)) throw new Error('no job page for #' + nm[1]);
      var pr = await fetch(ah, { cache: 'no-store', credentials: 'omit' });
      if (!pr.ok || pr.redirected) throw new Error('job page #' + nm[1] + ' ' + pr.status);
      var pd = new DOMParser().parseFromString(await pr.text(), 'text/html');
      var adt = slugNames(ah, at) ? ldDate(pd, ah) : '';
      var bl = htmlLines((ac[e].querySelector('.job-details') || {}).innerHTML), ad = [], aq = [], inq = false;
      for (var f = 0; f < bl.length; f++) {
        var tx = bl[f].t.replace(/[\s:]+$/, '');
        if (/^متطلبات/.test(tx) && tx.length < 25) { inq = true; continue; }
        if (tx === 'وصف الوظيفة') { inq = false; continue; }
        (inq ? aq : ad).push(bl[f].t);
      }
      var hv = { _wpcf7: '1603', _wpcf7_version: '5.8.2', _wpcf7_locale: 'he_IL', _wpcf7_unit_tag: 'wpcf7-f1603-o1',
        _wpcf7_container_post: '0', _wpcf7_posted_data_hash: '', _wpcf7_recaptcha_response: '', 'job-name-and-number': at + ' / #' + nm[1] };
      var af = Object.keys(hv).map(function (k) { return { name: k, label: '', fieldType: 'hidden', required: false, tagName: 'INPUT', value: hv[k] }; });
      [['first-name', 'الاسم الشخصيّ', 'text', 1], ['last-name', 'العائلة', 'text', 1], ['phone-number', 'رقم الهاتف', 'tel', 1],
        ['email', 'البريد الإلكترونيّ', 'email', 1], ['message', 'هل ترغب في التواصل معنا?', 'textarea', 0], ['file-1', 'رفع السيرة الذاتيّة', 'file', 1]
      ].forEach(function (x) { af.push({ name: x[0], label: x[1], fieldType: x[2], required: !!x[3], tagName: x[2] === 'textarea' ? 'TEXTAREA' : 'INPUT' }); });
      built.push({
        uid: 'cet-' + nm[1], title: at, href: ah, date: adt,
        dept: aiClean((pd.querySelector('.like-bread a[href*="jobs_categories"]') || {}).textContent),
        city: /(كل|جميع) مناطق البلاد/.test((at + ' ' + (bl.length ? bl[0].t : '')).replace(DIA, '')) ? 'פריסה ארצית' : '', emp: '',
        desc: aiClean(ad.join(NL)), req: aiClean(aq.join(NL)),
        blob: JSON.stringify({ actionUrl: CF7, actionAttribute: ah + '&form=1#wpcf7-f1603-o1', method: 'POST', enctype: 'multipart/form-data', fields: af })
      });
    }
  } catch (err) {
    console.log('[cet] no rows: ' + err);
    built = [];
  }

  var box = document.createElement('div');
  box.id = 'haide-cet';
  box.style.display = 'none';
  for (var r = 0; r < built.length; r++) {
    var J = built[r], row = document.createElement('div');
    row.className = 'haide-job';
    var a1 = document.createElement('a');
    a1.className = 'haide-link';
    a1.href = J.href;
    a1.textContent = J.title;
    row.appendChild(a1);
    aiInject(row, '__ai-externalJobId', J.uid);
    aiInject(row, '__ai-department', J.dept);
    aiInject(row, '__ai-location', J.city);
    aiInject(row, '__ai-employmentType', J.emp);
    aiInject(row, '__ai-publishDate', J.date);
    aiInject(row, '__ai-description', J.desc, 'div');
    aiInject(row, '__ai-requirements', J.req, 'div');
    aiInject(row, '__ai-applicationInfo', J.blob, 'div');
    aiInject(row, '__ai-formData', J.blob, 'div');
    box.appendChild(row);
  }
  document.body.appendChild(box);
}
