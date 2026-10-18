/* CET (מטח), cet.ac.il/jobs/ - a WordPress jobs archive whose positions come from Comeet (company 2A.00B).
   Listing-only. The page shows every job as a .job-card (title, full text in a collapse, and an apply link
   /jobs/<slug>//?form=1&external=<uid> that opens Comeet's apply form in an iframe). The script keeps exactly
   the cards the page shows and reads each one's data from the Comeet careers-api (one GET, details=true), then
   builds one hidden row per job in #haide-cet; the worker reads those rows.
   - Kept: a card on the page whose Comeet UID is in the API list, location.country = IL (LRN-SPA-16), a title
     in Hebrew/Latin letters only. A card with no UID, or a UID Comeet no longer lists, is left out (logged).
   - Id = the Comeet position UID (native, ASCII).
   - Link = the card's own job page (/jobs/<slug>/), read from the page, never Comeet's url_active_page (it is
     the careers page itself for C2.479 on 2026-10-18).
   - Body: Comeet "Description" -> description, a bare "תיאור התפקיד:" label line dropped; "Requirements"
     -> requirements, a short lead label line before the list dropped, the closing lines after the list -> end
     of description (a line that starts with "יתרון" or ends "- חובה / - יתרון" stays a requirement).
   - Location: the Comeet city; the config locationMap turns it into a city.csv row.
   - Apply: this job's own Comeet form (careers-api apply route, multipart) with the fields the site's embedded
     form shows, plus its questionnaire (one GET per job); the reCAPTCHA v3 token is browser-made: empty field.
   - Date: each job page's JSON-LD datePublished (one GET per job page, 6 at a time), as an Israel-time date.
   ALL-OR-NOTHING: a failed Comeet GET, or no card on the page, builds no row (a scheduled run then refuses).
   The date alone is exempt: a failed date read leaves that job undated (owner, 2026-10-18). */

var NL = String.fromCharCode(10);
/* fromCharCode: invisible chars in a regex literal have disabled a guard before (CLAUDE.md). */
var ZW = new RegExp('[' + String.fromCharCode(0xFEFF, 0x200B, 0x200C, 0x200D, 0x2060, 0x200E, 0x200F) + ']', 'g');
var NBSP = new RegExp(String.fromCharCode(0x00A0), 'g');
var QUOTES = new RegExp('["\'' + String.fromCharCode(0x201D, 0x2019, 0x05F4, 0x05F3) + ']', 'g');
var BULLETS = [String.fromCharCode(0x2022), String.fromCharCode(0x00B7)];
var OK = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u;
var BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
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

/* Comeet HTML -> lines, in an inert document (nothing in it runs or loads). A line knows whether it is a list
   item: an <li>, or a paragraph that starts with a bullet sign. */
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
    /* Dates: the job page's own JSON-LD WebPage datePublished (the job's WordPress post), 6 pages at a time.
       EXCEPTION to all-or-nothing, for this field only: any failure (fetch, redirect, no JSON-LD, another
       page's url, unparsable) leaves that job undated; it never drops the job or fails the run. LRN-AGE-6:
       the slug (minus a -2/-3 suffix) must name this job's title, else the post may be an older one -> undated. */
    var dates = [];
    for (var g = 0; g < keep.length; g += 6) {
      var part = await Promise.all(keep.slice(g, g + 6).map(function (k) {
        return fetch(k.href, { cache: 'no-store', credentials: 'omit' }).then(function (r) {
          if (!r.ok || r.redirected) return '';
          return r.text().then(function (h) {
            var doc = new DOMParser().parseFromString(h, 'text/html'), ld = doc.querySelectorAll('script[type="application/ld+json"]');
            for (var s = 0; s < ld.length; s++) {
              var j = null;
              try { j = JSON.parse(ld[s].textContent); } catch (e) { continue; }
              var gr = (j && j['@graph']) || [j];
              for (var t = 0; t < gr.length; t++) {
                var o = gr[t] || {};
                if (o['@type'] !== 'WebPage' || !o.datePublished) continue;
                /* scheme ignored: some job pages print http:// in their JSON-LD */
                if (decodeURI(String(o.url || '')).toLowerCase().replace(/^https?:/, '') !== decodeURI(k.href).toLowerCase().replace(/^https?:/, '')) continue;
                var dt = new Date(o.datePublished);
                if (isNaN(dt)) continue;
                return dt.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
              }
            }
            return '';
          });
        }).catch(function () { return ''; });
      }));
      dates = dates.concat(part);
    }
    for (var z = 0; z < keep.length; z++) {
      var slug = decodeURI(keep[z].href.split('/jobs/')[1] || '').replace(/\/$/, '').toLowerCase().replace(/-\d+$/, '');
      var tslug = keep[z].title.toLowerCase().replace(QUOTES, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dates[z] || '') || !slug || tslug.indexOf(slug) !== 0) {
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
