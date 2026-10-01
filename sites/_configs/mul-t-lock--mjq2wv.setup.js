var ITEM_SEL = 'li[data-testid="card-default"]';
var prev = -1, stable = 0;
for (var t = 0; t < 60; t++) {
  var n = document.querySelectorAll(ITEM_SEL).length;
  if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n;
  await new Promise(function (r) { setTimeout(r, 500); });
}
// AEM web component: the job body ships as base64 JSON in the component's
// content attribute ({title, text}); the rendered richtext is client-side only.
function decodeBody(html) {
  var doc = new DOMParser().parseFromString(html, 'text/html');
  var comps = doc.querySelectorAll('[content]');
  for (var i = 0; i < comps.length; i++) {
    if (!/^gw-group-text-and-media/i.test(comps[i].tagName)) continue;
    try {
      var bin = atob(comps[i].getAttribute('content'));
      var bytes = new Uint8Array(bin.length);
      for (var b = 0; b < bin.length; b++) bytes[b] = bin.charCodeAt(b);
      var o = JSON.parse(new TextDecoder('utf-8').decode(bytes));
      if (o && o.text) return o.text;
    } catch (e) {}
  }
  return '';
}
var NBSP = new RegExp(String.fromCharCode(160), 'g');
function txt(el) { return ((el.innerText || el.textContent || '').replace(NBSP, ' ')).trim(); }
var REQ_HEAD = /^דרישות[^:]{0,20}:?\s*$/;
var APPLY = /(קורות חיים|קו"ח|קו״ח)[^\n]{0,30}(לשלוח|למייל)/;
var INSTR = /(בכותרת|בנושא) המייל|^נא לציין/;
// Lines the employer listed under "דרישות" that are terms, not requirements (LRN-SETUP-18).
var TERMS = /^(סביבת עבודה|ארוחת|עבודה במשרה|משרה מלאה|משרה חלקית|תנאים)/;
var items = document.querySelectorAll(ITEM_SEL);
for (var k = 0; k < items.length; k++) {
  var item = items[k];
  if (item.querySelector('.__ai-description')) continue;
  var a = item.querySelector('a[href*="/about-mul-t-lock/career/"]');
  if (!a) continue;
  var slug = a.href.split('?')[0].replace(/\/+$/, '').split('/').pop();
  var mk = function (cls, val) { var s = document.createElement('span'); s.className = cls; s.textContent = val; item.appendChild(s); };
  mk('__ai-jobid', 'mul-t-lock-' + slug);
  var bodyHtml = '';
  try {
    var res = await fetch(a.href, { credentials: 'omit' });
    if (res && res.ok) bodyHtml = decodeBody(await res.text());
  } catch (e) {}
  if (!bodyHtml) continue;
  var body = document.createElement('div');
  body.innerHTML = bodyHtml;
  var bodyText = txt(body);
  var dDiv = document.createElement('div'); dDiv.className = '__ai-description';
  var rDiv = document.createElement('div'); rDiv.className = '__ai-requirements';
  var email = '', instr = [];
  // Card summary lines the body does not repeat (e.g. "משרה מלאה ביבנה").
  var cardLis = item.querySelectorAll('[data-testid="card-text"] li');
  var cardUl = document.createElement('ul');
  for (var c = 0; c < cardLis.length; c++) {
    var ct = txt(cardLis[c]);
    if (ct && bodyText.indexOf(ct) === -1) { var li0 = document.createElement('li'); li0.textContent = ct; cardUl.appendChild(li0); }
  }
  if (cardUl.children.length) dDiv.appendChild(cardUl);
  var mails = body.querySelectorAll('a[href^="mailto:"]');
  if (mails.length) email = mails[0].getAttribute('href').replace(/^mailto:/i, '').split('?')[0].trim();
  // A <li> can carry a requirement AND the apply line after <br>s: cut the apply tail.
  var lis = body.querySelectorAll('li');
  for (var x = 0; x < lis.length; x++) {
    var li = lis[x];
    var m = li.innerHTML.match(/^([\s\S]*?)(?:<br\s*\/?>\s*)+(?:&nbsp;|\s)*((?:קורות חיים|קו"ח|קו״ח)[\s\S]*)$/);
    if (m && li.querySelector('a[href^="mailto:"]')) li.innerHTML = m[1];
  }
  var kids = [];
  for (var y = 0; y < body.children.length; y++) kids.push(body.children[y]);
  var bucket = 'd';
  for (var z = 0; z < kids.length; z++) {
    var kid = kids[z];
    var kt = txt(kid);
    if (!kt) continue;
    if (kid.tagName === 'P' && REQ_HEAD.test(kt)) { bucket = 'r'; continue; }
    if (kid.tagName === 'P' && (APPLY.test(kt) || kid.querySelector('a[href^="mailto:"]'))) { continue; }
    if (kid.tagName === 'P' && INSTR.test(kt)) { instr.push(kt); continue; }
    if (kid.tagName !== 'UL' && kid.tagName !== 'OL') {
      // Prose after the requirements list (office, hours, "לגברים ונשים") is description.
      if (bucket === 'r' && rDiv.childNodes.length) bucket = 'd';
      dDiv.appendChild(kid);
      continue;
    }
    if (bucket === 'd') { dDiv.appendChild(kid); continue; }
    var rList = document.createElement(kid.tagName), tList = document.createElement(kid.tagName);
    var its = [];
    for (var w = 0; w < kid.children.length; w++) its.push(kid.children[w]);
    for (var v = 0; v < its.length; v++) {
      var it = txt(its[v]);
      if (!it) continue;
      (TERMS.test(it) ? tList : rList).appendChild(its[v]);
    }
    if (rList.children.length) rDiv.appendChild(rList);
    if (tList.children.length) dDiv.appendChild(tList);
  }
  item.appendChild(dDiv);
  if (rDiv.childNodes.length) item.appendChild(rDiv);
  if (email) mk('__ai-apply', 'mailto:' + email + (instr.length ? ' - ' + instr.join(' ') : ''));
  // Location: explicit workplace statement only (LRN-LOC-10), else nationwide phrase, else Unknown.
  var all = txt(item.querySelector('[data-testid="card-text"]') || document.createElement('i')) + '\n' + bodyText;
  var loc = 'Unknown';
  // Only phrases that place the JOB; "משרדי החברה ממוקמים ב…" places the offices, not a field role.
  if (/(משרה מלאה|ממשרדינו)\s+ביבנה/.test(all)) loc = 'יבנה';
  else if (/בכל רחבי הארץ|ברחבי הארץ|בכל הארץ|פריסה ארצית/.test(all)) loc = 'פריסה ארצית';
  mk('__ai-location', loc);
}
