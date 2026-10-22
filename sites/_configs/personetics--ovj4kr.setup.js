/* Personetics, personetics.com/careers/ - WordPress Comeet plugin (company 83.00A).
   - Rows: the page's own cards; id = the Comeet position uid from the card link; body from the job page.
     Id and link are written onto every card FIRST, so a slow or failed lookup can cost a form, never an id.
   - Israel only (LRN-SPA-16): a card whose Comeet position has a country other than IL is removed; one with
     no location or no country stays. Comeet unreachable -> the card's printed location decides: kept when it
     ends in "Israel" (or prints nothing), removed otherwise. Never zero rows on a failed lookup.
   - Apply: this job's own Comeet form (careers-api apply route, multipart), one GET per job for its
     questionnaire; the fields are the ones the plugin's comeetvar turns on. reCAPTCHA v3 token is
     browser-made: empty hidden field. Token and company come from the page's own comeetvar.
     ALL-OR-NOTHING for the forms: any failed GET, or no comeetvar, gives no job a form (the site has no
     formCapture, so no job falls back to another job's position).
   - Every request: 20 s limit on the whole request including the body; Comeet GETs send no cookies. */
var LIMIT_MS = 20000;
var UID_RE = /^[0-9A-Z]{2}\.[0-9A-Z]{3}(-[0-9A-Z]{2}\.[0-9A-Z]{3})?$/;

function get(url, asJson, credentials) {
  var ctl = new AbortController();
  var timer = setTimeout(function () { ctl.abort(); }, LIMIT_MS);
  return fetch(url, { credentials: credentials, cache: 'no-store', signal: ctl.signal })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url.split('?')[0]);
      return asJson ? r.json() : r.text();
    })
    .finally(function () { clearTimeout(timer); });
}

var cards = [...document.querySelectorAll('div.career-listings > a.active')].filter(item => !item.querySelector('.__ai-externalJobId'));
var uidOf = item => (item.getAttribute('href') || '').split('/')[7] || '';

/* 1. Id and link on every card, before any request. */
cards.forEach(item => {
  const href = item.getAttribute('href') || '';
  // href format: //personetics.com/us/careers-4/co/{location}/{uid}/{slug}/all
  const idSpan = document.createElement('span');
  idSpan.className = '__ai-externalJobId';
  idSpan.textContent = uidOf(item);
  item.appendChild(idSpan);

  const urlSpan = document.createElement('span');
  urlSpan.className = '__ai-detailUrl';
  urlSpan.textContent = href.startsWith('//') ? 'https:' + href : href;
  item.appendChild(urlSpan);
});

/* 2. Comeet: each position's country and its own apply form. */
var CV = window.comeetvar || {};
var COMP = String(CV.comeet_uid || ''), TOKEN = String(CV.comeet_token || '');
var forms = {}, country = null;
try {
  if (!/^[0-9A-F]{2}\.[0-9A-F]{3}$/i.test(COMP) || !TOKEN) throw new Error('no comeetvar on the page');
  var API = 'https://www.comeet.co/careers-api/2.0/company/' + COMP + '/positions/';
  var uids = [...new Set(cards.map(uidOf))];
  if (uids.some(u => !UID_RE.test(u))) throw new Error('a card link has no position uid');
  var got = await Promise.all(uids.map(u => get(API + u + '?token=' + TOKEN, true, 'omit')));
  var cty = {};
  for (var g = 0; g < uids.length; g++) {
    if (String((got[g] || {}).uid || '') !== uids[g]) throw new Error('position ' + uids[g] + ' answered as ' + (got[g] || {}).uid);
    var loc = got[g].location;
    cty[uids[g]] = loc && loc.country ? String(loc.country).toUpperCase() : '';
    var F = [['first_name', 'First name', 'text', 1], ['last_name', 'Last name', 'text', 1], ['email', 'Email', 'email', 1],
      ['phone', 'Phone', 'tel', 1], ['cv', 'Resume', 'file', 1], ['linkedin_url', 'LinkedIn Profile URL', 'url', 0],
      ['attachments', 'Cover Letter', 'file', 0], ['attachments', 'Portfolio', 'file', 0], ['comment', 'Personal note', 'textarea', 0]];
    var fields = F.map(f => ({ name: f[0], label: f[1], fieldType: f[2], required: !!f[3], tagName: f[2] === 'textarea' ? 'TEXTAREA' : 'INPUT' }));
    var qs = got[g].questionnaires || [];
    for (var a = 0; a < qs.length; a++) {
      var qq = qs[a].questions || [];
      for (var b = 0; b < qq.length; b++) {
        var qn = qq[b], ty = qn.type === 5 ? 'checkbox' : qn.type === 4 ? 'select' : qn.type === 3 ? 'radio' : 'text';
        var fo = { name: 'questionnaires:' + qs[a].id + ':' + qn.uid, label: String(qn.title || qs[a].name || '').replace(/\s+/g, ' ').trim(), fieldType: ty, required: !!qn.is_required, tagName: ty === 'select' ? 'SELECT' : 'INPUT' };
        if (qn.options && qn.options.length) fo.options = qn.options.map(o => ({ value: String(o.uid), label: String(o.title || '').replace(/\s+/g, ' ').trim() }));
        fields.push(fo);
      }
    }
    fields.push({ name: 'grecaptcha_token', label: '', fieldType: 'hidden', required: false, tagName: 'INPUT', value: '' });
    var act = 'https://www.comeet.co/careers-api/1.0/company/' + COMP + '/positions/' + uids[g] + '/apply';
    forms[uids[g]] = JSON.stringify({ actionUrl: act, actionAttribute: act, method: 'POST', enctype: 'multipart/form-data', fields: fields });
  }
  country = cty;
} catch (err) {
  console.log('[personetics] no apply forms, country from the card text: ' + err);
  forms = {};
  country = null;
}

/* 3. Israel only. */
var kept = [], dropped = [];
cards.forEach(item => {
  const uid = uidOf(item);
  const printed = ((item.querySelector('p.location') || {}).textContent || '').replace(/\s+/g, ' ').trim();
  const keep = country ? (!country[uid] || country[uid] === 'IL') : (!printed || /(^|,\s*)Israel$/i.test(printed));
  if (keep) kept.push(item);
  else { dropped.push(uid + ' (' + (country ? country[uid] : printed) + ')'); item.remove(); }
});
if (dropped.length) console.log('[personetics] not Israel, removed: ' + dropped.join(', '));

/* 4. Form and body for each kept card. */
await Promise.all(kept.map(async item => {
  const uid = uidOf(item);
  if (forms[uid]) {
    ['__ai-applicationInfo', '__ai-formData'].forEach(cls => {
      const formSpan = document.createElement('div');
      formSpan.className = cls;
      formSpan.textContent = forms[uid];
      item.appendChild(formSpan);
    });
  }

  try {
    const html = await get(item.querySelector('.__ai-detailUrl').textContent, false, 'same-origin');
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    /* Each Comeet section goes by its own heading: requirements-class sections (Requirements, Nice to have)
       to requirements, everything else to description, word for word. A heading that only restates the
       field name ("Requirements") is dropped; one that distinguishes content ("Nice to have") stays. */
    let text = '', req = '';
    doc.querySelectorAll('.comeet-position-info h4').forEach(h4 => {
      const next = h4.nextElementSibling;
      if (next && next.classList.contains('comeet-user-text')) {
        const label = h4.textContent.trim(), body = next.textContent.trim();
        if (/requirement|qualification|skill|advantage|nice to have/i.test(label)) {
          req += (/^(requirements?|qualifications?|skills?)$/i.test(label) ? '' : label + '\n') + body + '\n\n';
        } else {
          text += label + '\n' + body + '\n\n';
        }
      }
    });

    if (text.trim()) {
      const descSpan = document.createElement('span');
      descSpan.className = '__ai-description';
      descSpan.textContent = text.trim();
      item.appendChild(descSpan);
    }
    if (req.trim()) {
      const reqSpan = document.createElement('span');
      reqSpan.className = '__ai-requirements';
      reqSpan.textContent = req.trim();
      item.appendChild(reqSpan);
    }
  } catch(e) {}
}));
