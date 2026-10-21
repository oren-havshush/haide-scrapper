/* AT&T Israel (AT&T Israel R&D Center), www.comeet.com/jobs/joinattil/38.00A - the employer's Comeet hosted
   board (company 38.00A). Listing-only: the script reads the live set from the Comeet careers-api (one GET,
   details=true, the board's own token) plus one GET per kept job (its questionnaire), and builds one hidden
   row per job in #haide-joinattil.
   - Kept: location.country = IL, or a location with no country whose name is "Israel" (LRN-SPA-16); a title
     in Hebrew/Latin/Arabic letters only.
   - Id = the Comeet position UID (native, ASCII), office suffix kept if one appears (LRN-SPA-31).
   - Link = Comeet's hosted page for the UID, on www.comeet.com/jobs/joinattil/38.00A/ only.
   - Body: Description block -> description, a bare label line dropped; Requirements block -> requirements,
     its sub-headings kept (Required / Preferred Qualifications, Advantages); a "why join us" / "why you'll
     love working with us" / "success measures" section, closing lines after the last list item, and the
     shared closing ("We are hiring for various positions ... Join us and enjoy ...") -> end of description.
   - Location: the Comeet city of the job's own office (the job page prints it: "Airport, Center District, IL"
     or "Tel Aviv-Yafo, Tel Aviv District, IL"); the config locationMap turns it into a city.csv row. The
     board's location name "Airport City/ ToHa, Tel Aviv" names both offices and is not read.
   - Never read: hiring manager, referral reward, the comeetapply.com e-mail alias (internal Comeet fields).
   - Apply: this job's own Comeet form (careers-api apply route, multipart) with its questionnaire; the
     reCAPTCHA v3 token is browser-made: empty hidden field. No consent box on the form.
   Every fetch: no cookies (credentials omit), 20 s limit. ALL-OR-NOTHING: any fetch that fails, times out,
   redirects, answers non-2xx or returns an empty/wrong body builds no row (a scheduled run then refuses). */

var NL = String.fromCharCode(10);
/* fromCharCode: invisible chars in a regex literal have disabled a guard before (CLAUDE.md). */
var ZW = new RegExp('[' + String.fromCharCode(0xFEFF, 0x200B, 0x200C, 0x200D, 0x2060, 0x200E, 0x200F) + ']', 'g');
var NBSP = new RegExp(String.fromCharCode(0x00A0), 'g');
/* bullet signs an ad types at the start of a paragraph: bullet, middle dot, black circle, small square,
   check marks, small blue diamond, a plain + */
var BULLETS = [0x2022, 0x00B7, 0x25CF, 0x25AA, 0x2713, 0x2714, 0x2705, 0x1F539, 0x2B];
var OK = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}]/u;
var BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var COMP = '38.00A', TOKEN = '83A315C29223996399641D039963996107418AE';
var BOARD = 'https://www.comeet.com/jobs/joinattil/38.00A/';
var UID = /^[0-9A-Z]{2}\.[0-9A-Z]{3}(-[0-9A-Z]{2}\.[0-9A-Z]{3})?$/i;
var LIMIT_MS = 20000;
var REQ_END = /[-–]\s*(mandatory|an advantage|advantage|חובה|יתרון( משמעותי)?)\s*-?\s*\.?$/i;
var AP = "['" + String.fromCharCode(0x2019) + ']';
/* a label line that only says "requirements" */
var REQ_LABEL = new RegExp('^(requirements?|job requirements|requirements (&|and) qualifications|what you(' + AP + 'll)? bring|what we(' + AP + 're| are) looking for|דרישות|דרישות התפקיד|דרישות המשרה)\\s*[:?]?$', 'i');
/* a requirements heading inside the Description block starts a section that moves to requirements */
var REQ_HEAD = new RegExp('^(requirements?|qualifications|required qualifications|what you(' + AP + 'll)? bring|what we(' + AP + 're| are) looking for|דרישות|דרישות התפקיד)\\s*[:?]?$', 'i');
var DESC_LABEL = /^(description|job description|תיאור התפקיד|תיאור משרה|תיאור המשרה)\s*:?$/i;
var TAIL_HEAD = new RegExp('^(why join us|why you' + AP + 'll love working with us|success measures|what we offer|we offer|benefits|perks|למה להצטרף|מה אנחנו מציעים)(?=$|[\\s:?!.])', 'i');
/* the closing every AT&T ad ends with; from this line on, the rest is description */
var CLOSE = /^\*?\s*we are hiring for various positions/i;

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

function isBullet(t) { return BULLETS.indexOf(t.codePointAt(0)) !== -1; }

/* One GET: no cookies, a 20 s limit on the whole request including the body, no redirect, 2xx only, JSON. */
function getJson(url) {
  var ctl = new AbortController();
  var timer = setTimeout(function () { ctl.abort(); }, LIMIT_MS);
  return fetch(url, { credentials: 'omit', cache: 'no-store', signal: ctl.signal })
    .then(function (r) {
      if (r.redirected) throw new Error('redirected ' + url.split('?')[0]);
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url.split('?')[0]);
      return r.json();
    })
    .finally(function () { clearTimeout(timer); });
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

if (!document.getElementById('haide-joinattil')) {
  var built = [];
  try {
    var API = 'https://www.comeet.co/careers-api/2.0/company/' + COMP + '/positions';
    var list = await getJson(API + '?token=' + TOKEN + '&details=true');
    if (!list || typeof list.length !== 'number' || !list.length) throw new Error('positions list is empty or not a list');
    var keep = [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i] || {};
      var uid = String(p.uid || '');
      if (!UID.test(uid)) continue;
      var loc = p.location || null;
      if (!loc) continue;
      var il = loc.country === 'IL' || (!loc.country && /^Israel$/i.test(String(loc.name || '').trim()));
      if (!il) continue;
      var title = String(p.name || '').replace(/\s+/g, ' ').trim();
      if (!title || !OK.test(title) || BAD.test(title)) { console.log('[joinattil] language: left out ' + uid); continue; }
      var det = {};
      for (var d = 0; d < (p.details || []).length; d++) det[String(p.details[d].name || '').trim()] = p.details[d].value;
      var href = String(p.url_comeet_hosted_page || '').split(/[?#]/)[0];
      if (href.indexOf(BOARD) !== 0 || href.slice(-uid.length - 1) !== '/' + uid) throw new Error('no hosted page for ' + uid);
      keep.push({ p: p, title: title, href: href, descHtml: det['Description'], reqHtml: det['Requirements'] });
    }
    if (!keep.length) throw new Error('no Israeli job in the list');
    /* questionnaires, 6 at a time; every one must answer with its own uid */
    var forms = new Array(keep.length), next = 0;
    var worker = async function () {
      while (next < keep.length) {
        var n0 = next++;
        var f = await getJson(API + '/' + keep[n0].p.uid + '?token=' + TOKEN);
        if (!f || f.uid !== keep[n0].p.uid) throw new Error('position ' + keep[n0].p.uid + ': wrong or empty body');
        forms[n0] = f;
      }
    };
    await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
    for (var n = 0; n < keep.length; n++) {
      var K = keep[n], job = K.p, desc = [], req = [], tail = [];
      var dl = htmlLines(K.descHtml), moved = [];
      if (dl.length && !dl[0].li && DESC_LABEL.test(dl[0].t)) dl.shift();
      for (var h = 0; h < dl.length; h++) {
        if (!dl[h].li && REQ_HEAD.test(dl[h].t)) { moved = dl.splice(h); break; }
      }
      if (dl.length) desc.push(dl.map(function (o) { return o.t; }).join(NL));
      if (moved.length) req.push(moved.map(function (o) { return o.t; }).join(NL), '');
      var rl = htmlLines(K.reqHtml), lastLi = -1, inTail = false, closed = false;
      for (var x = 0; x < rl.length; x++) if (rl[x].li) lastLi = x;
      for (var y = 0; y < rl.length; y++) {
        var L = rl[y];
        if (!closed && !L.li && CLOSE.test(L.t)) closed = true;
        if (!L.li && L.t.length <= 40) inTail = TAIL_HEAD.test(L.t);
        /* a lone label is dropped, unless lines moved from the Description sit above it (it then separates them) */
        if (REQ_LABEL.test(L.t) && !moved.length) continue;
        if (closed || inTail || (lastLi >= 0 && y > lastLi && !REQ_END.test(L.t))) tail.push(L.t); else req.push(L.t);
      }
      if (tail.length) desc.push(tail.join(NL));
      var dText = aiClean(desc.join(NL + NL)), rText = aiClean(req.join(NL));
      var city = job.location && job.location.city ? String(job.location.city).trim() : '';
      var act = 'https://www.comeet.co/careers-api/1.0/company/' + COMP + '/positions/' + job.uid + '/apply';
      var F = [['first_name', 'First name', 'text', 1], ['last_name', 'Last name', 'text', 1], ['email', 'Email', 'email', 1],
        ['phone', 'Phone', 'tel', 1], ['cv', 'Resume', 'file', 1], ['links', 'Personal website', 'url', 0],
        ['attachments', 'Cover Letter', 'file', 0], ['attachments', 'Portfolio', 'file', 0], ['comment', 'Personal note', 'textarea', 0]];
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
    console.log('[joinattil] no rows: ' + err);
    built = [];
  }

  var box = document.createElement('div');
  box.id = 'haide-joinattil';
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
