/* Elmo Motion Control, www.elmomc.com/careers/ - a WordPress page whose job list is rendered by the Comeet plugin
   (company B3.00F). Listing-only. The page's cached list can still show a closed position (49.34A "SQA Engineer"
   on 2026-10-18, whose own page says "The position may have been closed"), so the script reads the live set from the
   Comeet careers-api (one GET, details=true) and builds one hidden row per job in #haide-elmo; the worker reads
   those rows.
   - Kept: no Comeet location, or location.country = IL (LRN-SPA-16; Germany and USA rows dropped), a title in Hebrew/Latin letters only.
   - Id = the Comeet position UID (native, ASCII).
   - Link = the page's own link for that UID (careers-new-2/co/<country>/<uid>/<slug>/all); if the cached page does
     not list it yet, Comeet's url_active_page without its query string (it can carry a gclid).
   - Body: description block -> description; requirements list -> requirements, its lead label line dropped, the
     closing lines after the list -> end of description (a line ending "- mandatory / - an advantage" stays).
   - Location: the Comeet city; the config locationMap turns it into a city.csv row.
   - Apply: this job's own Comeet form (careers-api apply route, multipart) with its own questionnaire, one GET per
     job; reCAPTCHA v3 token is browser-made: empty hidden field.
   ALL-OR-NOTHING: any failed GET builds no row (a scheduled run then refuses). */

var NL = String.fromCharCode(10);
/* fromCharCode: invisible chars in a regex literal have disabled a guard before (CLAUDE.md). */
var ZW = new RegExp('[' + String.fromCharCode(0xFEFF, 0x200B, 0x200C, 0x200D, 0x2060, 0x200E, 0x200F) + ']', 'g');
var NBSP = new RegExp(String.fromCharCode(0x00A0), 'g');
var BULLET = String.fromCharCode(0x2022);
var OK = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u;
var BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var COMP = 'B3.00F', TOKEN = '3BF12BBB3D1A3921B7167AEFC1A3921B777E';
var REQ_END = /[-–]\s*(mandatory|an advantage|advantage|חובה|יתרון)\s*\.?$/i;

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
      if (parts[j]) out.push({ t: parts[j], li: b.tagName === 'LI' || parts[j].indexOf(BULLET) === 0 });
    }
  }
  if (!blocks.length) {
    var all = aiClean(root.textContent).split(NL);
    for (var m = 0; m < all.length; m++) if (all[m]) out.push({ t: all[m], li: all[m].indexOf(BULLET) === 0 });
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

if (!document.getElementById('haide-elmo')) {
  var built = [];
  try {
    var pageLink = {}, anchors = document.querySelectorAll('a[href*="/careers-new-2/co/"]');
    for (var q = 0; q < anchors.length; q++) {
      var hm = /\/co\/[^/]+\/([0-9A-Z]{2}\.[0-9A-Z]{3})\//i.exec(anchors[q].getAttribute('href') || '');
      if (hm && !pageLink[hm[1]]) pageLink[hm[1]] = anchors[q].href;
    }
    var API = 'https://www.comeet.co/careers-api/2.0/company/' + COMP + '/positions';
    var lr = await fetch(API + '?token=' + TOKEN + '&details=true', { cache: 'no-store' });
    if (!lr.ok) throw new Error('positions list ' + lr.status);
    var list = await lr.json();
    if (!list || typeof list.length !== 'number' || !list.length) throw new Error('positions list is empty or not a list');
    var keep = [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i] || {};
      var uid = String(p.uid || '');
      if (!/^[0-9A-Z]{2}\.[0-9A-Z]{3}(-[0-9A-Z]{2}\.[0-9A-Z]{3})?$/i.test(uid)) continue;
      if (p.location && p.location.country && p.location.country !== 'IL') continue;
      var title = String(p.name || '').replace(/\s+/g, ' ').trim();
      if (!title || !OK.test(title) || BAD.test(title)) continue;
      var det = {};
      for (var d = 0; d < (p.details || []).length; d++) det[String(p.details[d].name || '').trim()] = p.details[d].value;
      var href = pageLink[uid] || String(p.url_active_page || '').split(/[?#]/)[0];
      if (!/^https:\/\/www\.elmomc\.com\//.test(href)) throw new Error('no job page for ' + uid);
      keep.push({ p: p, title: title, href: href, descHtml: det['Description'], reqHtml: det['Requirements'] });
    }
    if (!keep.length) throw new Error('no Israeli job in the list');
    var forms = await Promise.all(keep.map(function (k) {
      return fetch(API + '/' + k.p.uid + '?token=' + TOKEN, { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('position ' + k.p.uid + ' ' + r.status);
        return r.json();
      });
    }));
    for (var n = 0; n < keep.length; n++) {
      var K = keep[n], job = K.p, desc = [], req = [], tail = [];
      var dl = htmlLines(K.descHtml);
      if (dl.length) desc.push(dl.map(function (o) { return o.t; }).join(NL));
      var rl = htmlLines(K.reqHtml), firstLi = -1, lastLi = -1;
      for (var x = 0; x < rl.length; x++) if (rl[x].li) { if (firstLi < 0) firstLi = x; lastLi = x; }
      for (var y = 0; y < rl.length; y++) {
        var L = rl[y];
        if (firstLi >= 0 && y < firstLi && /:\s*$/.test(L.t) && L.t.length <= 40) continue;
        if (firstLi >= 0 && y > lastLi && !REQ_END.test(L.t)) tail.push(L.t); else req.push(L.t);
      }
      if (tail.length) desc.push(tail.join(NL));
      var act = 'https://www.comeet.co/careers-api/1.0/company/' + COMP + '/positions/' + job.uid + '/apply';
      var F = [['first_name', 'First name', 'text', 1], ['last_name', 'Last name', 'text', 1], ['email', 'Email', 'email', 1],
        ['phone', 'Phone', 'tel', 1], ['cv', 'Resume', 'file', 1], ['attachments', 'Cover Letter', 'file', 0],
        ['attachments', 'Portfolio', 'file', 0], ['comment', 'Personal note', 'textarea', 0]];
      var fields = F.map(function (f) { return { name: f[0], label: f[1], fieldType: f[2], required: !!f[3], tagName: f[2] === 'textarea' ? 'TEXTAREA' : 'INPUT' }; });
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
        uid: job.uid, title: K.title, href: K.href,
        dept: String(job.department || '').replace(/\s+/g, ' ').trim(),
        city: job.location && job.location.city ? String(job.location.city).trim() : '',
        emp: job.employment_type ? String(job.employment_type).trim() : '',
        desc: aiClean(desc.join(NL + NL)), req: aiClean(req.join(NL)),
        blob: JSON.stringify({ actionUrl: act, actionAttribute: act, method: 'POST', enctype: 'multipart/form-data', fields: fields })
      });
    }
  } catch (err) {
    console.log('[elmo] no rows: ' + err);
    built = [];
  }

  var box = document.createElement('div');
  box.id = 'haide-elmo';
  box.style.display = 'none';
  for (var r = 0; r < built.length; r++) {
    var J = built[r], row = document.createElement('div');
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
