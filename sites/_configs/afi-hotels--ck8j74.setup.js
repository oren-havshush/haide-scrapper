// afi-hotels.co.il /jobs (Simplex Hotel Marketing CMS), listing-only, no detail pages, no fetches, no clicks.
// The page prints one section per hotel (div.job-row#hotel-jobs-N: h2.job-title, a contact block with
// phone + email shared by every job of that hotel) and one div.job-item per job (h3.job-name, div.job-desc).
// This script adds hidden fields to each div.job-item:
// - department + location tag: the hotel, read from the section heading "משרות פנויות ב<hotel>"
//   (the lead "משרות פנויות" and a ב prefix before מלון/מלונות/קראון are dropped). The location is the
//   same tag; the config's locationMap turns it into a city.csv row (a new hotel stays Unknown + warning).
// - applicationInfo: "mailto:<address>" from the hotel's own email link (href first, Cloudflare
//   email-protection decoded when present; the link text only when the href has no address).
//   The page gives no instruction for the email, so the address is bare; the phone line is dropped.
// - description / requirements: the job-desc lines. Section labels (התפקיד כולל / תיאור המשרה /
//   המשרה כוללת) are dropped; lines under דרישות / דרישות התפקיד go to requirements until a blank line
//   after the first requirement; "המשרה מיועדת ..." lines stay in the description; a line outside that
//   section that opens with "אין דרישות" or ניסיון/נסיון is a requirement (no-heading rule).
// - externalJobId: none. The page prints no job number and has no record id (data-node-item is a
//   client-side DOM counter, absent from the server HTML), so the worker synthesises h-<hash>.
// - language gate: a job whose title fails the Hebrew/Latin/Arabic test is removed.
var NBSP = String.fromCharCode(160);
var ITEM_SEL = 'div.job-row div.job-item';
var LANG_OK = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}]/u;
var LANG_BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Arabic}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var LABEL = /^(התפקיד כולל|תיאור המשרה|המשרה כוללת|תיאור התפקיד)\s*:?\s*$/;
var REQ_HEAD = /^(דרישות התפקיד|דרישות)\s*:?\s*$/;
var STAYS = /^המשרה מיועדת/;
var REQ_LOOSE = /^(אין דרישות|ניסיון|נסיון)/;
var EMAIL = /^[^@\s<>"]+@[^@\s<>"]+\.[A-Za-z]{2,}$/;

var prev = -1, stable = 0;
for (var t = 0; t < 40; t++) {
  var n = document.readyState === 'loading' ? -1 : document.querySelectorAll(ITEM_SEL).length;
  if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n;
  await new Promise(function (r) { setTimeout(r, 250); });
}

var clean = function (s) { return String(s || '').split(NBSP).join(' ').replace(/\s+/g, ' ').trim(); };

var cfDecode = function (hex) {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length < 4) return '';
  var key = parseInt(hex.substr(0, 2), 16), out = '';
  for (var i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.substr(i, 2), 16) ^ key);
  return out;
};

var emailOf = function (a) {
  if (!a) return '';
  var href = a.getAttribute('href') || '';
  var addr = '';
  if (/^mailto:/i.test(href)) addr = clean(href.replace(/^mailto:/i, '').split('?')[0]);
  else if (href.indexOf('/cdn-cgi/l/email-protection#') !== -1) addr = cfDecode(href.split('#')[1] || '');
  if (!EMAIL.test(addr)) {
    var cf = a.querySelector('[data-cfemail]');
    addr = cf ? cfDecode(cf.getAttribute('data-cfemail') || '') : clean(a.textContent).replace(/^mailto:/i, '').trim();
  }
  return EMAIL.test(addr) ? addr : '';
};

var linesOf = function (el) {
  var c = el.cloneNode(true);
  // Source line breaks inside text nodes are layout, not content: fold them to spaces first.
  var tw = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
  var tn;
  while ((tn = tw.nextNode())) tn.nodeValue = String(tn.nodeValue || '').split(NBSP).join(' ').replace(/\s+/g, ' ');
  var brs = c.querySelectorAll('br');
  for (var i = 0; i < brs.length; i++) brs[i].replaceWith('\n');
  var blocks = c.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,tr');
  for (var j = 0; j < blocks.length; j++) blocks[j].append('\n');
  return String(c.textContent || '').split(NBSP).join(' ').split('\n').map(function (s) { return s.replace(/[ \t\r\f\v]+/g, ' ').trim(); });
};

var put = function (item, cls, lines) {
  var old = item.querySelector(':scope > .' + cls);
  if (old) old.remove();
  var s = document.createElement('span');
  s.className = cls;
  s.style.display = 'none';
  for (var i = 0; i < lines.length; i++) {
    var d = document.createElement('div');
    d.textContent = lines[i];
    s.appendChild(d);
  }
  item.appendChild(s);
};

var rows = document.querySelectorAll('div.job-row');
for (var r = 0; r < rows.length; r++) {
  var row = rows[r];
  var h2 = row.querySelector('h2.job-title');
  var hotel = clean(h2 ? h2.textContent : '').replace(/^משרות פנויות\s+/, '').replace(/^ב(?=(מלון|מלונות|קראון))/, '');
  var mail = emailOf(row.querySelector('div.job-contact a.email'));
  var items = row.querySelectorAll('div.job-item');
  for (var k = 0; k < items.length; k++) {
    var item = items[k];
    var title = clean((item.querySelector('h3.job-name') || {}).textContent);
    if (!title || !LANG_OK.test(title) || LANG_BAD.test(title)) { item.remove(); continue; }
    var desc = [], req = [], inReq = false, seenReq = false;
    var body = item.querySelector('div.job-desc');
    var lines = body ? linesOf(body) : [];
    for (var L = 0; L < lines.length; L++) {
      var line = lines[L];
      if (!line) { if (inReq && seenReq) inReq = false; continue; }
      if (REQ_HEAD.test(line)) { inReq = true; seenReq = false; continue; }
      if (LABEL.test(line)) { inReq = false; continue; }
      if (inReq) {
        if (STAYS.test(line)) desc.push(line); else { req.push(line); seenReq = true; }
      } else if (REQ_LOOSE.test(line)) req.push(line);
      else desc.push(line);
    }
    put(item, '__ai-description', desc);
    put(item, '__ai-requirements', req);
    put(item, '__ai-department', hotel ? [hotel] : []);
    put(item, '__ai-location', hotel ? [hotel] : []);
    put(item, '__ai-apply', mail ? ['mailto:' + mail] : []);
  }
}
