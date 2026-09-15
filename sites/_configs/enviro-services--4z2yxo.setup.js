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
  for (var k = 0; k < items.length; k++) {
    var item = items[k];
    if (item.querySelector('.__ai-location')) continue;
    var content = item.querySelector('.dorsim-item__content');
    var text = content ? (content.innerText || content.textContent || '') : '';
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
    var pid = (item.id || '').replace(/^dorsim-/, '');
    if (pid && dates[pid]) {
      var pd = document.createElement('span');
      pd.className = '__ai-publishdate';
      pd.textContent = dates[pid];
      item.appendChild(pd);
    }
  }
}
