/* Tikal Knowledge, www.tikalk.com/career/ - a Next.js page whose jobs come from Comeet (company 68.00C).
   Listing-only. The cards are click-only <div>s inside 4 department tabs, so the script builds one hidden
   row per job in #haide-tikal and the worker reads those rows.
   - Set: Comeet careers-api positions list (one GET; the token is the page's own, read from __NEXT_DATA__).
     Kept: department = one of the page's own tab titles (what a visitor can open), location.country = IL
     (LRN-SPA-16), a title in Hebrew/Latin letters only, and not a row with no text whose page is the careers
     page itself (LRN-SPA-27: F2.633 "Tikal's", the "Let's Talk" form).
   - Id = the Comeet position UID (native, ASCII). Link = the URL the page's own card click opens.
   - Body: Comeet "Description" (+ "Responsibilities" when filled) -> description; "Requirements" list ->
     requirements, its lead label line dropped, closing lines after the list -> end of description.
   - Location: the Comeet city as printed; config locationMap turns it into a city.csv row.
   - Apply: this job's own Comeet form (careers-api apply route, multipart) with its own questionnaire,
     one GET per job; reCAPTCHA v3 token is browser-made: empty hidden field.
   ALL-OR-NOTHING: any failed GET, or no tabs on the page, builds no row (a scheduled run then refuses). */

var NL = String.fromCharCode(10);
/* fromCharCode: invisible chars in a regex literal have disabled a guard before (CLAUDE.md). */
var ZW = new RegExp('[' + String.fromCharCode(0xFEFF, 0x200B, 0x200C, 0x200D, 0x2060) + ']', 'g');
var NBSP = new RegExp(String.fromCharCode(0x00A0), 'g');
var OK = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u;
var BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;

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

/* Comeet HTML -> lines, in an inert document (nothing in it runs or loads). Each line knows whether it
   came from a list item. */
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
    for (var j = 0; j < parts.length; j++) if (parts[j]) out.push({ t: parts[j], li: b.tagName === 'LI' });
  }
  if (!blocks.length) {
    var all = aiClean(root.textContent).split(NL);
    for (var m = 0; m < all.length; m++) if (all[m]) out.push({ t: all[m], li: false });
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

if (!document.getElementById('haide-tikal')) {
  var nd = null;
  try { nd = window.__NEXT_DATA__ || JSON.parse((document.getElementById('__NEXT_DATA__') || {}).textContent || 'null'); } catch (e) { nd = null; }
  var pageJobs = nd && nd.props && nd.props.pageProps && nd.props.pageProps.jobs ? nd.props.pageProps.jobs : [];
  var COMP = '68.00C', TOKEN = '';
  for (var q = 0; q < pageJobs.length && !TOKEN; q++) {
    var pm = /\/company\/([0-9A-F]{2}\.[0-9A-F]{3})\/positions\/[^?]+\?token=([0-9A-F]+)/i.exec(pageJobs[q].position_url || '');
    if (pm) { COMP = pm[1]; TOKEN = pm[2]; }
  }

  var tabs = [];
  for (var w = 0; w < 30 && !tabs.length; w++) {
    var th = document.querySelectorAll('[class*="tabs_titles"] > [class*="tabs_title"]');
    for (var ti = 0; ti < th.length; ti++) { var tt = (th[ti].textContent || '').replace(/\s+/g, ' ').trim(); if (tt) tabs.push(tt); }
    if (!tabs.length) await new Promise(function (r) { setTimeout(r, 500); });
  }

  var built = [];
  try {
    if (!TOKEN) throw new Error('no Comeet token on the page');
    if (!tabs.length) throw new Error('no department tabs on the page');
    var API = 'https://www.comeet.co/careers-api/2.0/company/' + COMP + '/positions';
    var lr = await fetch(API + '?token=' + TOKEN + '&details=true', { cache: 'no-store' });
    if (!lr.ok) throw new Error('positions list ' + lr.status);
    var list = await lr.json();
    if (!list || typeof list.length !== 'number') throw new Error('positions list is not a list');
    var keep = [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i] || {};
      var title = String(p.name || '').replace(/\s+/g, ' ').trim();
      var uid = String(p.uid || '');
      if (!/^[0-9A-Z]{2}\.[0-9A-Z]{3}$/i.test(uid) || !title) continue;
      if (tabs.indexOf(String(p.department || '').trim()) === -1) continue;
      if (!p.location || p.location.country !== 'IL') continue;
      if (!OK.test(title) || BAD.test(title)) continue;
      var hasText = (p.details || []).some(function (d) { return d && d.value && aiClean(String(d.value).replace(/<[^>]*>/g, ' ')); });
      if (!hasText && /tikalk\.com\/career\/?$/i.test(String(p.url_active_page || ''))) continue;
      keep.push(p);
    }
    var forms = await Promise.all(keep.map(function (p) {
      return fetch(API + '/' + p.uid + '?token=' + TOKEN, { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('position ' + p.uid + ' ' + r.status);
        return r.json();
      });
    }));
    for (var k = 0; k < keep.length; k++) {
      var job = keep[k], desc = [], req = [], tail = [];
      for (var d = 0; d < (job.details || []).length; d++) {
        var det = job.details[d], name = String(det.name || '').trim(), lines = htmlLines(det.value);
        if (!lines.length) continue;
        if (/^requirements?$/i.test(name)) {
          var firstLi = -1, lastLi = -1;
          for (var x = 0; x < lines.length; x++) if (lines[x].li) { if (firstLi < 0) firstLi = x; lastLi = x; }
          for (var y = 0; y < lines.length; y++) {
            var L = lines[y];
            if (firstLi >= 0 && y < firstLi && /:\s*$/.test(L.t) && L.t.length <= 40) continue;
            if (firstLi >= 0 && y > lastLi) tail.push(L.t); else req.push(L.t);
          }
        } else {
          var body = lines.map(function (o) { return o.t; }).join(NL);
          desc.push(/^(description|job description)$/i.test(name) ? body : name + ':' + NL + body);
        }
      }
      if (tail.length) desc.push(tail.join(NL));
      var slug = String(job.name).replace(' ', '-').replace(' ', '-').replace(' ', '-').toLowerCase() + '-' + job.uid.toLowerCase();
      var href = 'https://www.tikalk.com/career/' + encodeURI(slug) + '/';
      var act = 'https://www.comeet.co/careers-api/1.0/company/' + COMP + '/positions/' + job.uid + '/apply';
      var F = [['first_name', 'First name', 'text', 1], ['last_name', 'Last name', 'text', 1], ['email', 'Email', 'email', 1],
        ['phone', 'Phone', 'tel', 1], ['cv', 'Resume', 'file', 0], ['linkedin_url', 'LinkedIn Profile URL', 'url', 0]];
      var fields = F.map(function (f) { return { name: f[0], label: f[1], fieldType: f[2], required: !!f[3], tagName: 'INPUT' }; });
      var qs = (forms[k] && forms[k].questionnaires) || [];
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
        uid: job.uid, title: String(job.name).replace(/\s+/g, ' ').trim(), href: href,
        dept: String(job.department || '').trim(), city: job.location && job.location.city ? String(job.location.city).trim() : '',
        emp: job.employment_type ? String(job.employment_type).trim() : '',
        desc: aiClean(desc.join(NL + NL)), req: aiClean(req.join(NL)),
        blob: JSON.stringify({ actionUrl: act, actionAttribute: act, method: 'POST', enctype: 'multipart/form-data', fields: fields })
      });
    }
  } catch (err) {
    console.log('[tikal] no rows: ' + err);
    built = [];
  }

  var box = document.createElement('div');
  box.id = 'haide-tikal';
  box.style.display = 'none';
  for (var n = 0; n < built.length; n++) {
    var J = built[n], row = document.createElement('div');
    row.className = 'haide-job';
    var link = document.createElement('a');
    link.className = 'haide-link';
    link.href = J.href;
    link.textContent = J.title;
    row.appendChild(link);
    aiInject(row, '__ai-externalJobId', J.uid);
    aiInject(row, '__ai-department', J.dept);
    aiInject(row, '__ai-location', J.city);
    aiInject(row, '__ai-employmentType', J.emp);
    aiInject(row, '__ai-description', J.desc, 'div');
    aiInject(row, '__ai-requirements', J.req, 'div');
    aiInject(row, '__ai-applicationInfo', J.blob, 'div');
    aiInject(row, '__ai-formData', J.blob, 'div');
    box.appendChild(row);
  }
  document.body.appendChild(box);
}
