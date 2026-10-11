// braude.ac.il/about/jobs/: one page, two accordions; each li.accordion-item is one job, ad inline.
// title: injected div (the "#" anchor must not become the job url).
// externalJobId: not emitted (no printed number; accordion ids are made in the browser per load);
//   the worker makes an h- id from title, department and url (addsite3 6.2).
// description: lines before the first label, the role section (label dropped), meta lines
//   (היקף משרה / הערות / כפיפות / אופי העסקה, label kept), then the closing lines printed once
//   under both accordions, appended to every job (rule 4).
// requirements: sections whose label names השכלה / כישורים / ניסיון / דרישות; labels dropped.
// applicationInfo: the job's mailto + the page's instruction for that email, one line; apply
//   lines leave the description. No address in the ad -> the closing section's address.
// location: site rule (owner 2026-10-11, as kortec): one campus, every job = CITY, verbatim city.csv.
// language gate: Hebrew/Latin titles only (addsite3 6.2).
var ITEM_SEL = 'section.accordion_sec li.accordion-item';
var CITY = 'כרמיאל'; // verbatim city.csv row
var prev = -1, stable = 0;
for (var t = 0; t < 20; t++) {
  var n = document.querySelectorAll(ITEM_SEL).length;
  if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n;
  await new Promise(function (r) { setTimeout(r, 300); });
}

var MATH = new RegExp('[' + String.fromCodePoint(0x1D400) + '-' + String.fromCodePoint(0x1D7FF) + ']', 'gu');
var HE_LA = /(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u;
var OTHER = /(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var NBSP = String.fromCharCode(160);
var clean = function (s) { return (s || '').split(NBSP).join(' ').replace(/\s+/g, ' ').trim(); };

var ROLE_L = /^(תכולו?ת התפקיד|הגדרת התפקיד|תיאור התפקיד)$/;
var REQ_L = /(השכלה|כישורים|ניסיון|נסיון|דרישות)/;
var APPLY_L = /^(בפניה למשרה יש לצרף|בפנייה למשרה יש לצרף)$/;
var APPLY_LINE = /^(קורות חיים|יש לשלוח)/;

// lines of a block: <br> splits a paragraph; <strong> text that ends in ":" is a label
var linesOf = function (el) {
  var c = el.cloneNode(true);
  var brs = c.querySelectorAll('br');
  for (var i = 0; i < brs.length; i++) brs[i].replaceWith('\n');
  return c.textContent.split('\n').map(clean).filter(function (x) { return x; });
};
var labelOf = function (line) {
  var m = /^([^:]{2,40}):\s*(.*)$/.exec(line);
  return m ? { label: clean(m[1]), rest: clean(m[2]) } : null;
};

// closing lines printed once under both accordions
var shared = [], siteMail = '';
var secs = document.querySelectorAll('section.accordion_sec');
if (secs.length) {
  var s = secs[secs.length - 1].nextElementSibling;
  while (s && s.tagName !== 'SECTION') s = s.nextElementSibling;
  if (s && !s.querySelector('form, li.accordion-item')) {
    var sm = s.querySelector('a[href^="mailto:"]');
    if (sm) siteMail = (sm.getAttribute('href') || '').replace(/^mailto:/i, '').split('?')[0].trim();
    var ps = s.querySelectorAll('p');
    for (var q = 0; q < ps.length; q++) {
      if (ps[q].querySelector('a[href^="mailto:"]')) continue; // apply line
      linesOf(ps[q]).forEach(function (x) { shared.push({ li: false, text: x }); });
    }
  }
}

var items = document.querySelectorAll(ITEM_SEL);
for (var i = 0; i < items.length; i++) {
  var item = items[i];
  try {
    if (item.querySelector('.__ai-title')) continue; // re-run guard
    var a = item.querySelector('a.accordion-title');
    var title = clean(a ? a.textContent : '').replace(MATH, function (ch) { return ch.normalize('NFKC'); });
    if (!title || !HE_LA.test(title) || OTHER.test(title)) { item.remove(); continue; }

    var body = item.querySelector('.accordion-content');
    var blocks = body ? body.children : [];
    var desc = [], req = [], instr = [], mode = 'desc', mail = '';
    for (var b = 0; b < blocks.length; b++) {
      var el = blocks[b];
      var tag = el.tagName;
      if (tag === 'HR') continue;
      if (tag === 'UL' || tag === 'OL') {
        var lis = el.querySelectorAll('li');
        for (var l = 0; l < lis.length; l++) {
          var lt = clean(lis[l].textContent);
          if (!lt) continue;
          var row = { li: true, text: lt };
          if (mode === 'apply') instr.push(lt);
          else (mode === 'req' ? req : desc).push(row);
        }
        continue;
      }
      var ma = el.querySelector('a[href^="mailto:"]');
      if (ma) {
        // the apply line: address, then whatever the page asks to send with it
        mail = (ma.getAttribute('href') || '').replace(/^mailto:/i, '').split('?')[0].trim();
        var full = clean(el.textContent);
        var at = full.indexOf(clean(ma.textContent));
        var after = at >= 0 ? clean(full.slice(at + clean(ma.textContent).length)).replace(/^[\s,.;:–-]+/, '') : '';
        if (after) instr.push(after);
        mode = 'done';
        continue;
      }
      var ls = linesOf(el);
      for (var k = 0; k < ls.length; k++) {
        var line = ls[k];
        var lab = labelOf(line);
        if (lab && ROLE_L.test(lab.label)) {
          mode = 'desc';
          if (lab.rest) desc.push({ li: false, text: lab.rest });
          continue;
        }
        if (lab && APPLY_L.test(lab.label)) {
          mode = 'apply';
          instr.push(lab.label + ':');
          if (lab.rest) instr.push(lab.rest);
          continue;
        }
        if (lab && REQ_L.test(lab.label)) {
          mode = 'req';
          if (lab.rest) req.push({ li: false, text: lab.rest });
          continue;
        }
        if (lab) { mode = 'desc'; desc.push({ li: false, text: line }); continue; } // meta line, label kept
        if (APPLY_LINE.test(line)) { mode = 'apply'; instr.push(line); continue; }
        if (mode === 'apply') { instr.push(line); continue; }
        (mode === 'req' ? req : desc).push({ li: false, text: line });
      }
    }
    if (!mail) mail = siteMail;
    desc = desc.concat(shared);

    var info = '';
    if (mail) {
      var ins = '';
      for (var w = 0; w < instr.length; w++) {
        var part = instr[w];
        if (!ins) ins = part;
        else ins += (/:$/.test(ins) ? ' ' : '; ') + part;
      }
      info = 'mailto:' + mail + (ins ? ' - ' + ins : '');
    }

    var add = function (cls, val) {
      var wrap = document.createElement('div');
      wrap.className = cls;
      wrap.style.display = 'none';
      if (typeof val === 'string') { wrap.textContent = val; item.appendChild(wrap); return; }
      var ul = null;
      for (var v = 0; v < val.length; v++) {
        if (val[v].li) {
          if (!ul) { ul = document.createElement('ul'); wrap.appendChild(ul); }
          var li = document.createElement('li');
          li.textContent = val[v].text;
          ul.appendChild(li);
        } else {
          ul = null;
          var p = document.createElement('p');
          p.textContent = val[v].text;
          wrap.appendChild(p);
        }
      }
      item.appendChild(wrap);
    };
    add('__ai-title', title);
    if (desc.length) add('__ai-description', desc);
    if (req.length) add('__ai-requirements', req);
    if (info) add('__ai-apply', info);
    add('__ai-location', CITY);
  } catch (e) {
    // degrade per item (LRN-WRK-19)
  }
}
