var ITEM_SEL = 'article.dorsim-item';
var prev = -1, stable = 0;
for (var t = 0; t < 40; t++) {
  var n = document.querySelectorAll(ITEM_SEL).length;
  if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n;
  await new Promise(function (r) { setTimeout(r, 250); });
}
var items = document.querySelectorAll(ITEM_SEL);
if (items.length) {
  var dates = {};
  try {
    var res = await fetch('/wp-json/wp/v2/dorsim?per_page=100&_fields=id,date', { credentials: 'omit' });
    if (res && res.ok) {
      var rows = await res.json();
      if (rows && rows.length) {
        for (var r1 = 0; r1 < rows.length; r1++) dates[String(rows[r1].id)] = rows[r1].date;
      }
    }
  } catch (e) {}
  var PLACES = [['נאות חובב', 'נאות חובב'], ['תל אביב', 'תל אביב-יפו']];
  var ANCHORS = 'מפעלנו|מפעלה|מפעל החברה|מפעל|משרדי החברה|משרדי|הממוקמת|ממוקם|מיקום';
  // Section labels. Checked in this order: a requirements sub-head ("תנאי סף:") must
  // win over the description-class "תנאי…", and the legal block must switch back even
  // though it is long, so it is tested before the short-label rule.
  var LEGAL = /^\*?\s*(המשרה מיועדת|המשרה מנוסחת|החברה פועלת|סודיות מובטחת|המודעה מנוסחת)/;
  var REQ = /^\s*(דרישות|כישורים|תנאי סף|מה אנחנו מחפשים|מי מתאים|עדיפות תינתן)/;
  var DESC = /^\s*\*?\s*(תיאור|מיקום|שעות|תנאי|היקף|שכר|מה אנחנו מציעים|הערות|להגשת|יש להגיש|הגשת המועמדות|נשמח לקבל|מס['׳]|אנו מציעים)/;
  for (var k = 0; k < items.length; k++) {
    var item = items[k];
    if (item.querySelector('.__ai-location')) continue;
    var content = item.querySelector('.dorsim-item__content');
    var text = content ? (content.innerText || content.textContent || '') : '';

    // --- location: explicit statement only, never a prose scan (LRN-LOC-10) ---
    var found = [];
    var labeled = text.match(/מיקום\s*(?:ה?משרה)?\s*[:：]\s*([^\n]{1,80})/);
    var scope = labeled ? labeled[1] : '';
    var q;
    if (scope) {
      for (q = 0; q < PLACES.length; q++) {
        if (scope.indexOf(PLACES[q][0]) !== -1 && found.indexOf(PLACES[q][1]) === -1) found.push(PLACES[q][1]);
      }
    }
    if (found.length === 0) {
      var ordered = [];
      for (q = 0; q < PLACES.length; q++) {
        var re = new RegExp('(?:' + ANCHORS + ')[^\\n]{0,30}?' + PLACES[q][0]);
        var m = re.exec(text);
        if (m && ordered.map(function (o) { return o.v; }).indexOf(PLACES[q][1]) === -1) {
          ordered.push({ v: PLACES[q][1], at: m.index });
        }
      }
      ordered.sort(function (a, b) { return a.at - b.at; });
      for (q = 0; q < ordered.length; q++) found.push(ordered[q].v);
    }
    if (found.length === 0 && /בכל רחבי הארץ|ברחבי הארץ|בכל הארץ|פריסה ארצית/.test(text)) {
      found.push('פריסה ארצית');
    }
    var loc = document.createElement('span');
    loc.className = '__ai-location';
    loc.textContent = found.length ? found.join(', ') : 'Unknown';
    item.appendChild(loc);

    // --- externalJobId: the site's own printed job number, namespaced (LRN-ID-11) ---
    var numEl = item.querySelector('.dorsim-col--number');
    var num = numEl ? (numEl.textContent || '').replace(/[^0-9]/g, '') : '';
    if (num) {
      var jid = document.createElement('span');
      jid.className = '__ai-jobid';
      jid.textContent = 'enviro-services-' + num;
      item.appendChild(jid);
    }

    // --- publishDate from the same-origin WP REST API ---
    var pid = (item.id || '').replace(/^dorsim-/, '');
    if (pid && dates[pid]) {
      var pd = document.createElement('span');
      pd.className = '__ai-publishdate';
      pd.textContent = dates[pid];
      item.appendChild(pd);
    }

    // --- description / requirements: two-bucket state machine over the direct
    // children (LRN-SETUP-10). Nodes are MOVED, never re-rendered as text, so the
    // worker's <br>/<li> handling still sees native markup (LRN-SETUP-11).
    if (content && !content.querySelector('.__ai-desc')) {
      // WordPress indents a list by wrapping it in <li style="list-style-type:none">
      // levels. The page hides those markers, but the worker prefixes "•" to every
      // <li>, so each wrapper ships as an empty bullet. Unwrap an <li> that has no
      // text of its own and only holds a nested list; its items move up intact.
      var lis = content.querySelectorAll('li');
      for (var w = 0; w < lis.length; w++) {
        var li = lis[w];
        if (!li.querySelector('ul, ol')) continue;
        var own = '';
        for (var cn = 0; cn < li.childNodes.length; cn++) {
          var node = li.childNodes[cn];
          if (node.nodeType === 1 && /^(UL|OL)$/.test(node.tagName)) continue;
          own += node.textContent || '';
        }
        if (own.replace(/[\s ​-‏﻿]/g, '') !== '') continue;
        while (li.firstChild) li.parentNode.insertBefore(li.firstChild, li);
        li.parentNode.removeChild(li);
      }
      var kids = [];
      for (var c = 0; c < content.children.length; c++) kids.push(content.children[c]);
      var dDiv = document.createElement('div'); dDiv.className = '__ai-desc';
      var rDiv = document.createElement('div'); rDiv.className = '__ai-req';
      var bucket = 'd';
      var descHeads = 0;
      for (var x = 0; x < kids.length; x++) {
        var kid = kids[x];
        var kt = ((kid.innerText || kid.textContent || '').replace(/[​-‏﻿]/g, '')).trim();
        if (!kt) { continue; }
        // A bare "מס' משרה-1118" line is metadata, not description prose — the
        // number already ships as externalJobId. Dropped wherever it appears;
        // a line that merely mentions the number is left alone.
        if (/^\*?\s*מס['׳`]?\s*משרה\s*[-–—:]?\s*\d+\s*$/.test(kt.replace(/ /g, ' ').trim())) { continue; }
        var isShortLabel = kt.length < 60 && kt.indexOf('\n') === -1;
        if (LEGAL.test(kt)) {
          bucket = 'd';
        } else if (isShortLabel && REQ.test(kt)) {
          // A bare "דרישות התפקיד:" head is dropped — the field name says it. A
          // sub-head inside the block ("תנאי סף:") is kept, it is real structure.
          if (/^\s*(דרישות|כישורים|מה אנחנו מחפשים|מי מתאים)/.test(kt)) { bucket = 'r'; continue; }
          bucket = 'r';
        } else if (isShortLabel && /^\s*תיאור/.test(kt)) {
          // Some ads label the requirements block "תיאור התפקיד:" a SECOND time
          // (job 1114). The first one opens the description; a repeat opens the
          // requirements, and the misleading label is dropped with it.
          descHeads++;
          if (descHeads >= 2) { bucket = 'r'; continue; }
          bucket = 'd';
        } else if (isShortLabel && DESC.test(kt)) {
          bucket = 'd';
        }
        (bucket === 'r' ? rDiv : dDiv).appendChild(kid);
      }
      content.appendChild(dDiv);
      if (rDiv.childNodes.length) content.appendChild(rDiv);
    }
  }
}
