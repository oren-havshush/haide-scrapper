var ITEM_SEL = '#jobs div.job';
var prev = -1, stable = 0;
for (var t = 0; t < 40; t++) {
  var n = document.querySelectorAll(ITEM_SEL).length;
  if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n;
  await new Promise(function (r) { setTimeout(r, 250); });
}
var items = document.querySelectorAll(ITEM_SEL);
if (items.length) {
  // Invisible characters the editor leaves in lines (nbsp, zero-width, word joiner).
  var INVIS = new RegExp('[' + String.fromCharCode(0xA0) + String.fromCharCode(0x200B) + '-' +
    String.fromCharCode(0x200F) + String.fromCharCode(0x2060) + String.fromCharCode(0xFEFF) + ']', 'g');
  var BLOCK = /^(P|DIV|H[1-6]|UL|OL|LI|HR|TABLE|TR|BLOCKQUOTE)$/;
  var PLACES = [['נהריה', 'נהריה'], ['ראשון לציון', 'ראשון לציון'], ['גני תקווה', 'גני תקווה'], ['תל אביב', 'תל אביב-יפו']];
  var REQ_HEAD = /^\*?\s*(דרישות|כישורים|מיומנויות|מה אנחנו מחפשים)/;
  var DROP_HEAD = /^\*?\s*(תיאור|הגדרת|מטרת)\s+התפקיד\s*[:：]?\s*$/;
  var META = /^\*?\s*(היקף|מקום העבודה|מסגרת|תקופת|להגשת|קורות חיים)/;
  var APPLY = /(להגשת מועמדות|קורות חיים ניתן לשלוח|ציינו את שם המשרה|בציון שם המשרה|לציין בכותרת)/;
  var EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;

  // The page states once, above the list, that every posting is for women and men
  // alike; a job page shows one job, so that sentence travels with each of them.
  var shared = '';
  var paras = document.querySelectorAll('.elementor-widget-text-editor p');
  for (var s = 0; s < paras.length; s++) {
    var pt = (paras[s].textContent || '').replace(INVIS, ' ').replace(/\s+/g, ' ').trim();
    if (/בשוויון/.test(pt) && /לנשים ולגברים/.test(pt)) { shared = pt; break; }
  }
  var pageApply = '';
  for (var s2 = 0; s2 < paras.length; s2++) {
    var at = (paras[s2].textContent || '').replace(INVIS, ' ').replace(/\s+/g, ' ').trim();
    var am = EMAIL.exec(at);
    if (am && /קו["״]ח/.test(at)) { pageApply = 'mailto:' + am[0] + ' - ' + at.slice(at.indexOf(am[0]) + am[0].length).replace(/^[\s,.:–-]+/, ''); break; }
  }

  // Publish dates from the same-origin WP REST route of the jobs post type, matched by
  // title (the cards carry no post id). A miss only leaves that job undated.
  var DASH = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']', 'g');
  var QUOTE = new RegExp('[' + String.fromCharCode(0x05F4, 0x201C, 0x201D) + ']', 'g');
  var norm = function (s) { return String(s || '').replace(INVIS, ' ').replace(DASH, '-').replace(QUOTE, '"').replace(/\s+/g, ' ').trim(); };
  var dates = {};
  try {
    var res = await fetch('/wp-json/wp/v2/jobs?per_page=100&_fields=date,title', { credentials: 'omit' });
    if (res && res.ok) {
      var rows = await res.json();
      var ta = document.createElement('textarea');
      for (var r1 = 0; rows && r1 < rows.length; r1++) {
        ta.innerHTML = (rows[r1].title && rows[r1].title.rendered) || '';
        dates[norm(ta.value)] = rows[r1].date;
      }
    }
  } catch (e) {}

  function mk(cls, txt) { var e = document.createElement('span'); e.className = cls; e.style.display = 'none'; e.textContent = txt; return e; }

  for (var k = 0; k < items.length; k++) {
    var item = items[k];
    if (item.querySelector('.__ai-eid')) continue;
    var full = item.querySelector('.full');
    var h = null;
    for (var c0 = 0; c0 < item.children.length; c0++) if (item.children[c0].tagName === 'H3') { h = item.children[c0]; break; }
    var title = h ? (h.textContent || '').replace(INVIS, ' ').replace(/\s+/g, ' ').trim() : '';
    if (!title || !full) continue;
    item.appendChild(mk('__ai-title', title));
    // No printed number and no job link: h-<djb2(title)>, recipe §3 (as bontour, domicile).
    var key = title.toLowerCase().replace(/\s+/g, ' ').trim();
    var hh = 5381, hi = key.length;
    while (hi) { hh = (hh * 33) ^ key.charCodeAt(--hi); }
    item.appendChild(mk('__ai-eid', 'h-' + (hh >>> 0).toString(36)));

    if (dates[norm(title)]) item.appendChild(mk('__ai-publishdate', dates[norm(title)]));

    var dm = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec((item.querySelector('.date') || {}).textContent || '');
    if (dm) item.appendChild(mk('__ai-deadline', dm[3] + '-' + ('0' + dm[2]).slice(-2) + '-' + ('0' + dm[1]).slice(-2)));

    // Body -> lines. A <br> or a block boundary ends a line; a line from an <li> stays a bullet.
    var lines = [], buf = '';
    var flush = function (li) {
      var x = buf.replace(INVIS, ' ').replace(/\s+/g, ' ').trim();
      buf = '';
      if (x) lines.push({ t: x, li: li });
    };
    var walk = function (node, li) {
      for (var i = 0; i < node.childNodes.length; i++) {
        var ch = node.childNodes[i];
        if (ch.nodeType === 3) { buf += ch.nodeValue; continue; }
        if (ch.nodeType !== 1) continue;
        if (ch.classList && ch.classList.contains('kk-star-ratings')) continue;
        if (/^(SCRIPT|STYLE)$/.test(ch.tagName)) continue;
        if (ch.tagName === 'BR') { flush(li); continue; }
        if (BLOCK.test(ch.tagName)) {
          var inLi = li || ch.tagName === 'LI';
          flush(li); walk(ch, inLi); flush(inLi);
        } else walk(ch, li);
      }
    };
    walk(full, false); flush(false);

    var desc = [], req = [], apply = [], bucket = 'd';
    var place = '';
    for (var j = 0; j < lines.length; j++) {
      var L = lines[j], tx = L.t;
      var isHead = !L.li && tx.length < 60 && /[:：?]\s*$/.test(tx);
      if (/מקום העבודה\s*[:：]/.test(tx)) place = tx;
      if (APPLY.test(tx)) { apply.push(tx.replace(/^\*\s*/, '')); continue; }
      if (isHead && REQ_HEAD.test(tx)) { bucket = 'r'; continue; }
      if (isHead) bucket = 'd';
      else if (!L.li && META.test(tx)) bucket = 'd';
      if (isHead && DROP_HEAD.test(tx)) continue;
      (bucket === 'r' ? req : desc).push(L);
    }
    if (shared) desc.push({ t: shared, li: false });

    var render = function (arr, cls) {
      var d = document.createElement('div'); d.className = cls; d.style.display = 'none';
      var ul = null;
      for (var q = 0; q < arr.length; q++) {
        if (arr[q].li) {
          if (!ul) { ul = document.createElement('ul'); d.appendChild(ul); }
          var liEl = document.createElement('li'); liEl.textContent = arr[q].t; ul.appendChild(liEl);
        } else {
          ul = null;
          var p = document.createElement('p'); p.textContent = arr[q].t; d.appendChild(p);
        }
      }
      return d;
    };
    item.appendChild(render(desc, '__ai-description'));
    if (req.length) item.appendChild(render(req, '__ai-requirements'));

    // Apply: the job's own address and what it asks to write; else the page-wide address.
    var ai = '';
    var joined = apply.join(' ');
    var em = EMAIL.exec(joined);
    if (em) {
      var rest = joined.slice(joined.indexOf(em[0]) + em[0].length).replace(/^[\s,.:–-]+/, '').trim();
      ai = 'mailto:' + em[0] + (rest ? ' - ' + rest : '');
    } else if (joined) ai = joined;
    else ai = pageApply;
    if (ai) item.appendChild(mk('__ai-apply', ai));

    // Location: the title or the labelled workplace line only, never a prose scan.
    var scope = title + ' ' + place, found = [];
    for (var pz = 0; pz < PLACES.length; pz++) {
      if (scope.indexOf(PLACES[pz][0]) !== -1 && found.indexOf(PLACES[pz][1]) === -1) found.push(PLACES[pz][1]);
    }
    item.appendChild(mk('__ai-location', found.length ? found.join(', ') : 'Unknown'));
  }
}
