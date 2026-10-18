/* Deloitte Israel, careers.deloitte.co.il - a WordPress plugin page whose jobs are synced from Comeet (company F7.00B).
   Listing-only. The page shows 7 rows and loads the rest by an admin-ajax POST, so the script does not page the
   listing: it reads the same jobs from the Comeet careers-api (one GET, details=true) and builds one hidden row per
   job in #haide-deloitte; the worker reads those rows.
   - Kept: no Comeet location, or location.country = IL (LRN-SPA-16), a title in Hebrew/Latin letters only. Left out: the job-fair general
     applications (Comeet name "יריד תעסוקה ..."), see the card.
   - Language, as the site's own Hebrew job page shows it: when Comeet has a Hebrew description, the Hebrew title
     ("Public Name (Hebrew)"), Hebrew description and Hebrew requirements; otherwise the English ones.
   - Id = the Comeet position UID (native, ASCII; multi-location copies carry a suffix, e.g. 10.F6C-92.301).
   - Link = the job's own Hebrew page on careers.deloitte.co.il (/he/position/<uid with dots as dashes>-he/).
   - Department = the Hebrew side of the "Area of Interest" category, as the job page prints it.
   - Body: description block -> description; requirements list -> requirements, its lead label line dropped, the
     closing lines after the list -> end of description.
   - Location: the Comeet city, plus the cities of a "מיקום:" / "Location:" line or an "העבודה ... במשרדי הפירמה
     ב<list>" line in the published text (closed table); the config locationMap turns each into a city.csv row.
   - Requirements: a line after the list that ends "- mandatory / - חובה / - יתרון" stays in requirements.
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
var COMP = 'F7.00B', TOKEN = '7FB2FE21FEC3FD847D33FD8FF603FD81FEC';
var DROP_NAME = /יריד תעסוקה/;
var REQ_END = /[-–]\s*(mandatory|an advantage|advantage|חובה|יתרון)\s*\.?$/i;
/* "העבודה (הינה) ממשרדינו / במשרדי הפירמה / במשרדי החברה ב<list>": the list up to the first clause that follows it. */
var OFFICE_CUE = /^העבודה (?:הינה )?(?:ממשרדינו|במשרדי הפירמה|במשרדי החברה) ?ב?(.+?)(?: בשילוב| וכוללת| ומאתרי|\.|$)/;
/* "מיקום:" / "Location:" list items -> the Comeet city spelling the locationMap knows. Hybrid words place nothing. */
var CUE_CITY = {
  'תל אביב': 'Tel Aviv', 'ת"א': 'Tel Aviv', 'tel aviv': 'Tel Aviv', 'tel-aviv': 'Tel Aviv',
  'חיפה': 'Haifa', 'haifa': 'Haifa', 'ירושלים': 'Jerusalem', 'jerusalem': 'Jerusalem',
  'בית שמש': 'Beit Shemesh', 'beit shemesh': 'Beit Shemesh', 'beit-shemesh': 'Beit Shemesh',
  'נצרת': 'Nazareth', 'nazareth': 'Nazareth'
};

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

function hasText(html) { return !!aiClean(String(html || '').replace(/<[^>]*>/g, ' ')); }

function aiInject(host, cls, val, tag) {
  if (!val) return;
  var s = document.createElement(tag || 'span');
  s.className = cls;
  s.textContent = val;
  host.appendChild(s);
}

if (!document.getElementById('haide-deloitte')) {
  var built = [];
  try {
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
      if (DROP_NAME.test(String(p.name || ''))) continue;
      var det = {}, cat = {};
      for (var d = 0; d < (p.details || []).length; d++) det[String(p.details[d].name || '').trim()] = p.details[d].value;
      for (var c = 0; c < (p.categories || []).length; c++) cat[String(p.categories[c].name || '').trim()] = p.categories[c].value;
      var he = hasText(det['Description Hebrew']);
      var heName = String(cat['Public Name (Hebrew)'] || '').replace(/\s+/g, ' ').trim();
      var title = (he && heName ? heName : String(p.name || '')).replace(/\s+/g, ' ').trim();
      if (!title || !OK.test(title) || BAD.test(title)) continue;
      var area = String(cat['Area of Interest'] || ''), cut = area.indexOf('<>');
      keep.push({
        p: p, title: title,
        dept: (cut >= 0 ? area.slice(cut + 2) : area).replace(/\s+/g, ' ').trim(),
        descHtml: he ? det['Description Hebrew'] : det['Description'],
        reqHtml: he ? det['Requirements Hebrew'] : det['Requirements']
      });
    }
    if (!keep.length) throw new Error('no Israeli job in the list');
    var forms = [];
    for (var g = 0; g < keep.length; g += 6) {
      var part = await Promise.all(keep.slice(g, g + 6).map(function (k) {
        return fetch(API + '/' + k.p.uid + '?token=' + TOKEN, { cache: 'no-store' }).then(function (r) {
          if (!r.ok) throw new Error('position ' + k.p.uid + ' ' + r.status);
          return r.json();
        });
      }));
      forms = forms.concat(part);
    }
    for (var n = 0; n < keep.length; n++) {
      var K = keep[n], job = K.p, desc = [], req = [], tail = [];
      var dl = htmlLines(K.descHtml);
      if (dl.length) desc.push(dl.map(function (o) { return o.t; }).join(NL));
      var rl = htmlLines(K.reqHtml), firstLi = -1, lastLi = -1;
      for (var x = 0; x < rl.length; x++) if (rl[x].li) { if (firstLi < 0) firstLi = x; lastLi = x; }
      for (var y = 0; y < rl.length; y++) {
        var L = rl[y];
        if (firstLi >= 0 && y < firstLi && /:\s*$/.test(L.t) && L.t.length <= 40) continue;
        /* After the list: a line that ends "- mandatory / - חובה / - an advantage / - יתרון" is still a requirement. */
        if (firstLi >= 0 && y > lastLi && !REQ_END.test(L.t)) tail.push(L.t); else req.push(L.t);
      }
      if (tail.length) desc.push(tail.join(NL));
      var body = desc.concat(req).join(NL);
      var cities = [];
      if (job.location && job.location.city) cities.push(String(job.location.city).trim());
      var bl = body.split(NL);
      for (var z = 0; z < bl.length; z++) {
        var ln = bl[z].replace(/^[*\s]+/, '').trim();
        var cm = /^(?:מיקום|location)\s*:\s*(.+)$/i.exec(ln) || OFFICE_CUE.exec(ln);
        if (!cm) continue;
        var toks = cm[1].replace(/\.\s*$/, '').split(/\s*[,/|]\s*/);
        for (var w = 0; w < toks.length; w++) {
          var key = toks[w].trim().toLowerCase();
          if (CUE_CITY[key] && cities.indexOf(CUE_CITY[key]) === -1) cities.push(CUE_CITY[key]);
        }
      }
      var slug = job.uid.toLowerCase().replace(/\./g, '-');
      var act = 'https://www.comeet.co/careers-api/1.0/company/' + COMP + '/positions/' + job.uid + '/apply';
      var F = [['first_name', 'First name', 'text', 1], ['last_name', 'Last name', 'text', 1], ['email', 'Email', 'email', 1],
        ['phone', 'Phone', 'tel', 1], ['cv', 'Resume', 'file', 1], ['attachments', 'Cover Letter', 'file', 0],
        ['comment', 'Personal note', 'textarea', 0]];
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
        uid: job.uid, title: K.title, href: 'https://careers.deloitte.co.il/he/position/' + slug + '-he/',
        dept: K.dept, city: cities.join(' | '),
        desc: aiClean(desc.join(NL + NL)), req: aiClean(req.join(NL)),
        blob: JSON.stringify({ actionUrl: act, actionAttribute: act, method: 'POST', enctype: 'multipart/form-data', fields: fields })
      });
    }
  } catch (err) {
    console.log('[deloitte] no rows: ' + err);
    built = [];
  }

  var box = document.createElement('div');
  box.id = 'haide-deloitte';
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
    aiInject(row, '__ai-description', J.desc, 'div');
    aiInject(row, '__ai-requirements', J.req, 'div');
    aiInject(row, '__ai-applicationInfo', J.blob, 'div');
    aiInject(row, '__ai-formData', J.blob, 'div');
    box.appendChild(row);
  }
  document.body.appendChild(box);
}
