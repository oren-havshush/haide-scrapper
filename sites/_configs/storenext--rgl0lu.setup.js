/* StoreNext, www.storenext.co.il/about/career/ - a WordPress page whose job list is rendered by the official Comeet
   plugin (company 1B.00B) into the page itself; each row links to the site's own job page
   /comeet-inner/co/<city|other>/<uid>/<slug>/all, where the Comeet apply form sits in a cross-origin iframe.
   Listing-only: the script reads the live set from the Comeet careers-api (one GET, details=true, the page's own
   token) plus one GET per job (its questionnaire), and builds one hidden row per job in #haide-storenext.
   - Kept: no Comeet location, or location.country = IL (LRN-SPA-16); a title in Hebrew/Latin letters only.
   - Id = the Comeet position UID (native, ASCII).
   - Link = the page's own link for that UID; if the cached page does not list it yet, Comeet's url_active_page
     without its query string, on www.storenext.co.il only.
   - Body: Description block -> description, its inner headings kept; Requirements block -> requirements, its
     sub-headings kept (Must / Nice to have / Advantage), a lone "Requirements" label dropped; a "Why join us" /
     "Bonus" / benefits section and the closing lines after the last list item -> end of description.
   - Location: the Comeet city (the config locationMap turns it into a city.csv row). A job with no Comeet location:
     the ad's own line placing it in Petah Tikva, else the company's single printed address (Hamagshimim 20,
     Petah Tikva; LRN-LOC-20) unless the ad hints at field work, remote work or another location -> no value.
   - Never read: hiring manager, referral reward, apply e-mail alias (internal Comeet fields).
   - Apply: this job's own Comeet form (careers-api apply route, multipart) with its own questionnaire; the
     reCAPTCHA v3 token is browser-made: empty hidden field.
   ALL-OR-NOTHING: any failed GET builds no row (a scheduled run then refuses). */

var NL = String.fromCharCode(10);
/* fromCharCode: invisible chars in a regex literal have disabled a guard before (CLAUDE.md). */
var ZW = new RegExp('[' + String.fromCharCode(0xFEFF, 0x200B, 0x200C, 0x200D, 0x2060, 0x200E, 0x200F) + ']', 'g');
var NBSP = new RegExp(String.fromCharCode(0x00A0), 'g');
var BULLET = String.fromCharCode(0x2022);
var OK = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u;
var BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var COMP = '1B.00B', TOKEN = 'B1B4DBD4DBD2C6C63F3378737873787378742A2';
var HOST = /^https:\/\/www\.storenext\.co\.il\//;
var REQ_END = /[-–]\s*(mandatory|an advantage|advantage|חובה|יתרון( משמעותי)?)\s*\.?$/i;
var REQ_LABEL = /^(requirements?|job requirements|דרישות|דרישות התפקיד|דרישות המשרה)\s*:?$/i;
var TAIL_HEAD = /^(why join us|bonus|what we offer|benefits|perks|למה להצטרף|מה אנחנו מציעים|אנחנו מציעים)(?=$|[\s:?!.])/i;
var HQ_LABEL = 'Petah Tikva';
var HQ_LINE = /(בפתח[ -]תקווה|בפתח[ -]תקוה|Petah[ -]Tikva)/i;
var ELSEWHERE = /(עבודת שטח|אצל (ה)?לקוחות|ברחבי הארץ|פריסה ארצית|מהבית|מרחוק|באזור|מיקום המשרה|field work|remote|work from home|location\s*:|based in)/i;

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
  s.className = cls + ' wp-exclude-emoji';
  s.textContent = val;
  host.appendChild(s);
}

if (!document.getElementById('haide-storenext')) {
  var built = [];
  try {
    var pageLink = {}, anchors = document.querySelectorAll('a[href*="/comeet-inner/co/"]');
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
      if (!HOST.test(href)) throw new Error('no job page for ' + uid);
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
      var rl = htmlLines(K.reqHtml), lastLi = -1, inTail = false;
      for (var x = 0; x < rl.length; x++) if (rl[x].li) lastLi = x;
      for (var y = 0; y < rl.length; y++) {
        var L = rl[y];
        if (!L.li && L.t.length <= 40) inTail = TAIL_HEAD.test(L.t);
        if (!L.li && REQ_LABEL.test(L.t)) continue;
        if (inTail || (lastLi >= 0 && y > lastLi && !REQ_END.test(L.t))) tail.push(L.t); else req.push(L.t);
      }
      if (tail.length) desc.push(tail.join(NL));
      var dText = aiClean(desc.join(NL + NL)), rText = aiClean(req.join(NL));
      var city = job.location && job.location.city ? String(job.location.city).trim() : '';
      if (!city) {
        var all = dText + NL + rText;
        if (HQ_LINE.test(all)) city = HQ_LABEL;
        else if (!ELSEWHERE.test(all)) city = HQ_LABEL;
      }
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
          if (ty !== 'text' && qn.options && qn.options.length) fo.options = qn.options.map(function (o) { return { value: String(o.uid), label: aiClean(o.title) }; });
          fields.push(fo);
        }
      }
      fields.push({ name: 'grecaptcha_token', label: '', fieldType: 'hidden', required: false, tagName: 'INPUT', value: '' });
      built.push({
        uid: job.uid, title: K.title, href: K.href,
        dept: String(job.department || '').replace(/\s+/g, ' ').trim(),
        city: city,
        emp: job.employment_type ? String(job.employment_type).trim() : '',
        desc: dText, req: rText,
        blob: JSON.stringify({ actionUrl: act, actionAttribute: act, method: 'POST', enctype: 'multipart/form-data', fields: fields })
      });
    }
  } catch (err) {
    console.log('[storenext] no rows: ' + err);
    built = [];
  }

  var box = document.createElement('div');
  box.id = 'haide-storenext';
  box.className = 'wp-exclude-emoji';
  box.style.display = 'none';
  for (var r = 0; r < built.length; r++) {
    var J = built[r], row = document.createElement('div');
    row.className = 'haide-job wp-exclude-emoji';
    var link = document.createElement('a');
    link.className = 'haide-link wp-exclude-emoji';
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
