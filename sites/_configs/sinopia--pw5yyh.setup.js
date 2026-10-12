/* Sinopia (sinopia.co.il/company/careers/). Listing-only: every job is one Flatsome text block
   on the careers page, no detail page, no job number. Runs on the listing page only.
   Item = the div.text block whose h2 starts with "דרוש" (Flatsome ids change on every load, so
   the block is found by its title, then marked with the class __ai-job).
   No native id: the script emits no externalJobId and the worker builds an h- id itself.
   Body: the "מה אנחנו מחפשים?" section -> requirements (label dropped); everything else between
   the title and the apply line -> description ("מה תעשו אצלנו?" kept as a label inside it).
   The apply line ("שלחו קורות חיים ... ל: <mailto>") leaves the body; its address -> applicationInfo.
   Location: site rule (owner 2026-10-12, LRN-LOC-20 single-address rule): the company prints one
   address (אנגל 78, כפר סבא), so an ad whose text names no place and no field work gets כפר סבא;
   a field-work or other-place cue leaves it Unknown. Bare "היברידי" is not a cue here: both ads
   use it for IT environments ("סביבות היברידיות"), so only hybrid-WORK wording counts. */

var NL = String.fromCharCode(10);
/* fromCharCode: invisible chars in a regex literal have disabled a guard before (CLAUDE.md). */
var ZW = new RegExp('[' + String.fromCharCode(0xFEFF, 0x200B, 0x200C, 0x200D, 0x2060) + ']', 'g');
var NBSP = new RegExp(String.fromCharCode(0x00A0), 'g');

function aiClean(t) {
  t = String(t || '').replace(ZW, '').replace(NBSP, ' ');
  var lines = t.split(NL), out = [];
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i].replace(/[ \t]+/g, ' ').trim();
    if (!l) { if (out.length && out[out.length - 1] !== '') out.push(''); continue; }
    out.push(l);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  while (out.length && out[0] === '') out.shift();
  return out.join(NL).trim();
}

/* textContent alone collapses the block to one run-on line. */
function structuredText(el) {
  if (!el) return '';
  var c = el.cloneNode(true), i;
  var kill = c.querySelectorAll('style,script,link,meta,iframe,img,noscript,form,button,svg');
  for (i = kill.length - 1; i >= 0; i--) kill[i].parentNode.removeChild(kill[i]);
  var brk = c.querySelectorAll('p,div,ul,ol,li,br,h1,h2,h3,h4,h5,h6,tr');
  for (i = 0; i < brk.length; i++) brk[i].insertAdjacentText('afterend', NL);
  return aiClean(c.textContent || '');
}

function aiInject(host, cls, val) {
  if (!host || !val || host.querySelector('.' + cls)) return;
  var s = document.createElement('span');
  s.className = cls;
  s.style.display = 'none';
  s.textContent = val;
  host.appendChild(s);
}

/* Language gate on the title: Hebrew or Latin letters only (owner, 2026-09-27). */
var OK = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u;
var BAD = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;

var REQ_LABEL = /^מה אנחנו מחפשים\s*\??$/;
var EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;
var HQ = 'כפר סבא'; /* verbatim, CSV files/city.csv */
var FIELD = /עבודת שטח|אצל (ה)?לקוח|באתרי (ה)?לקוח|במשרדי (ה)?לקוח|ברחבי הארץ|פריסה ארצית|נסיעות|ניידות|רכב צמוד/;
var OTHER = /ממוקמ|מיקום|באזור|באיזור|עבודה מהבית|עבודה היברידית|מודל היברידי|סניף/;

var blocks = document.querySelectorAll('#content div.text');
for (var b = 0; b < blocks.length; b++) {
  var block = blocks[b];
  if (block.querySelector('.__ai-title')) continue;
  var h2s = block.querySelectorAll('h2'), head = null;
  for (var h = 0; h < h2s.length; h++) {
    if (/^דרוש/.test(aiClean(h2s[h].textContent))) { head = h2s[h]; break; }
  }
  if (!head) continue;
  var title = aiClean(head.textContent).replace(/\s+/g, ' ');
  if (!title || !OK.test(title) || BAD.test(title)) continue;

  var desc = [], req = [], mail = '', inReq = false, seenHead = false;
  var kids = block.children;
  for (var k = 0; k < kids.length; k++) {
    var el = kids[k];
    if (el === head) { seenHead = true; continue; }
    if (!seenHead || el.tagName === 'STYLE' || el.tagName === 'SCRIPT') continue;
    var a = el.querySelector('a[href^="mailto:"]');
    if (a) {
      /* The apply line: its address goes to applicationInfo, the line itself is dropped. */
      var m = EMAIL.exec(a.getAttribute('href').replace(/^mailto:/i, '').split('?')[0]);
      if (m && !mail) mail = m[0];
      continue;
    }
    /* li > p gives a blank line between bullets; one line per bullet instead. */
    var txt = structuredText(el).split(NL).filter(function (l) { return l.trim(); }).join(NL);
    if (!txt) continue;
    if (REQ_LABEL.test(txt)) { inReq = true; continue; }
    (inReq ? req : desc).push(txt);
  }

  block.classList.add('__ai-job');
  aiInject(block, '__ai-title', title);
  if (desc.length) aiInject(block, '__ai-description', desc.join(NL));
  if (req.length) aiInject(block, '__ai-requirements', req.join(NL));
  if (mail) aiInject(block, '__ai-applicationInfo', 'mailto:' + mail);
  var all = title + NL + desc.join(NL) + NL + req.join(NL);
  aiInject(block, '__ai-location', FIELD.test(all) || OTHER.test(all) ? 'Unknown' : HQ);
}
