// yazamco.co.il — דרושים listing (WordPress `job` CPT, theme "anova")
//
// Everything lives on the single listing page: each `div.job` holds the title,
// the full body, the share links, and its own apply form. There is no anchor to
// the detail page — the only place the post URL appears is inside the share
// hrefs, and the only place the WP post id appears is the share *text*.
//
// Injects, per item:
//   a.__ai-detailurl    -> https://yazamco.co.il/job/<slug>/   (from a.linkedin)
//   span.__ai-jobid     -> yz-<wp post id>                     (from a.tw text=)
//   div.__ai-description-> body minus the דרישות section, block structure kept
//   div.__ai-requirements-> the דרישות section
//   span.__ai-employment-> משרה מלאה / משרה חלקית / משמרות     (when stated)
//   span.__ai-location  -> city named in the title             (when stated)
//
// The printed "משרה מספר" number is NOT usable as an id: 16 cards carry only 12
// distinct numbers, and two of the repeats are genuinely different postings
// (14 = עובד/ת אחזקה and אב הבית; 40 = two different מבקר/ת פנים roles). The WP
// post id is unique per posting and stable across scrapes.

function aiText(el) {
  if (!el) return '';
  var c = el.cloneNode(true);
  // #simple-translate is browser-extension residue that got pasted into the CMS
  // content on at least one posting — it is not part of the job text.
  c.querySelectorAll(
    'script,style,form,.social-share,.wrapper-form,#simple-translate,[class*="simple-translate"]',
  ).forEach(function (n) {
    n.remove();
  });
  c.querySelectorAll('li').forEach(function (n) {
    n.insertBefore(document.createTextNode('\n• '), n.firstChild);
  });
  c.querySelectorAll('br').forEach(function (n) {
    n.replaceWith(document.createTextNode('\n'));
  });
  c.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,ul,ol,tr').forEach(function (n) {
    n.appendChild(document.createTextNode('\n'));
  });
  var t = c.textContent || '';
  t = t.replace(/[\u200B-\u200F\u2060\uFEFF]/g, '').replace(/\u00A0/g, ' ');
  var lines = t.split('\n');
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i].replace(/[ \t]+/g, ' ').trim();
    if (!l) continue;
    if (l === '•') continue;
    // the theme prints the req number under the body — it is not part of the text
    if (/^משרה מספר\s*\d*$/.test(l)) continue;
    out.push(l);
  }
  return out.join('\n').trim();
}

// Splits the body at the דרישות heading. Returns [description, requirements].
function aiSplit(el) {
  if (!el) return ['', ''];
  // The CMS wraps the body in a stray <p>, but the parser auto-closes it, so
  // the sections arrive as flat siblings. Do NOT "flatten" a <p> into its own
  // children: on the cards that use <br>-separated prose the text lives in the
  // <p>'s own text nodes, and lifting only the element children drops all of it.
  var flat = Array.from(el.children);
  var cut = -1;
  for (var i = 0; i < flat.length; i++) {
    var n = flat[i];
    var isHeading = /^H[1-6]$/.test(n.tagName) || n.querySelector('strong,b');
    var txt = (n.textContent || '').replace(/\u00A0/g, ' ').trim();
    if (isHeading && /^דרישות|^תנאי סף|^כישורים/.test(txt)) {
      cut = i;
      break;
    }
  }
  if (cut === -1) return [aiText(el), ''];

  var dWrap = document.createElement('div');
  var rWrap = document.createElement('div');
  for (var j = 0; j < flat.length; j++) {
    (j < cut ? dWrap : rWrap).appendChild(flat[j].cloneNode(true));
  }
  return [aiText(dWrap), aiText(rWrap)];
}

var CITIES = [
  'ירושלים', 'תל אביב', 'פתח תקווה', 'ראשון לציון', 'באר שבע', 'רמת גן',
  'ראש העין', 'בני ברק', 'רחובות', 'נתניה', 'אשדוד', 'אשקלון', 'חולון',
  'מודיעין', 'כפר סבא', 'הרצליה', 'רעננה', 'חדרה', 'עפולה', 'טבריה',
  'הקריות', 'חיפה', 'השרון', 'הצפון', 'הדרום', 'המרכז',
];

var items = document.querySelectorAll('div.job');
for (var k = 0; k < items.length; k++) {
  var item = items[k];
  if (item.querySelector('.__ai-jobid')) continue; // re-run guard

  // --- detailUrl: only the LinkedIn share link carries the URL un-encoded
  var li = item.querySelector('a.linkedin');
  var durl = '';
  if (li) {
    var m = (li.getAttribute('href') || '').match(/[?&]url=(https?:\/\/[^&"]+)/);
    if (m) durl = decodeURIComponent(m[1]);
  }
  if (durl) {
    var a = document.createElement('a');
    a.className = '__ai-detailurl';
    a.href = durl;
    a.textContent = 'detail';
    a.style.display = 'none';
    item.appendChild(a);
  }

  // --- externalJobId: WP post id, taken from the tweet text (e.g. text=7580דרושים)
  var tw = item.querySelector('a.tw');
  var pid = '';
  if (tw) {
    var mm = (tw.getAttribute('href') || '').match(/[?&]text=(\d+)/);
    if (mm) pid = mm[1];
  }
  if (!pid && durl) {
    // fallback: slug from the detail URL, never index-based
    var sm = durl.match(/\/job\/([^/]+)\/?$/);
    if (sm) pid = decodeURIComponent(sm[1]).slice(0, 60);
  }
  var idEl = document.createElement('span');
  idEl.className = '__ai-jobid';
  idEl.textContent = pid ? 'yz-' + pid : '';
  idEl.style.display = 'none';
  item.appendChild(idEl);

  // --- description / requirements
  var body = item.querySelector('.col-lg-7');
  var parts = aiSplit(body);
  var dEl = document.createElement('div');
  dEl.className = '__ai-description';
  dEl.textContent = parts[0];
  dEl.style.display = 'none';
  item.appendChild(dEl);

  var rEl = document.createElement('div');
  rEl.className = '__ai-requirements';
  rEl.textContent = parts[1];
  rEl.style.display = 'none';
  item.appendChild(rEl);

  var full = parts[0] + '\n' + parts[1];

  // --- employmentType (only when the posting actually states it)
  var emp = '';
  if (/משרה\s*מלאה/.test(full)) emp = 'משרה מלאה';
  else if (/משרה\s*חלקית/.test(full)) emp = 'משרה חלקית';
  else if (/משמרות/.test(full)) emp = 'משמרות';
  if (emp) {
    var eEl = document.createElement('span');
    eEl.className = '__ai-employment';
    eEl.textContent = emp;
    eEl.style.display = 'none';
    item.appendChild(eEl);
  }

  // --- location: only when the title names a place. No hardcoded fallback —
  // these postings span Jerusalem / Petah Tikva / the north, so a constant
  // would override the gazetteer with a wrong value (LRN-LOC-1).
  var h3 = item.querySelector('.title-job h3');
  var title = h3 ? h3.textContent || '' : '';
  var loc = '';
  for (var ci = 0; ci < CITIES.length; ci++) {
    if (title.indexOf(CITIES[ci]) !== -1) {
      loc = CITIES[ci];
      break;
    }
  }
  if (loc) {
    var lEl = document.createElement('span');
    lEl.className = '__ai-location';
    lEl.textContent = loc;
    lEl.style.display = 'none';
    item.appendChild(lEl);
  }
}
