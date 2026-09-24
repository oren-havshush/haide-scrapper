var LIST = '/wp-json/wp/v2/jobs?per_page=100';
if (document.getElementById('__ai-jobs')) return;
var res = await fetch(LIST, { credentials: 'same-origin' });
if (!res || !res.ok) return;
var rows = await res.json();
if (!Array.isArray(rows) || rows.length === 0) return;

var CITY = 'יבנה';
var CLOSING = 'המשרה פונה לגברים ונשים כאחד';
var NBSP = String.fromCharCode(160);

var host = document.createElement('div');
host.id = '__ai-jobs';
host.style.position = 'absolute';
host.style.left = '-99999px';
host.style.top = '0';
document.body.appendChild(host);

for (var i = 0; i < rows.length; i++) {
  var r = rows[i];

  var t = document.createElement('div');
  t.innerHTML = (r.title && r.title.rendered) || '';
  var title = (t.textContent || '').trim();

  var tmp = document.createElement('div');
  tmp.innerHTML = ((r.content && r.content.rendered) || '')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<br[^>]*>/gi, '\n');
  var raw = (tmp.textContent || '').split(NBSP).join(' ');
  var lines = raw.split('\n').map(function (s) {
    return s.replace(/[ \t]+/g, ' ').trim();
  }).filter(function (s) { return s.length > 0; });

  var desc = [];
  var req = [];
  var apply = '';
  var inTerms = false;

  for (var j = 0; j < lines.length; j++) {
    var L = lines[j];
    if (/^תיאור\s*ה?תפקיד\s*:?$/.test(L)) continue;
    var m = L.match(/^(.*?)\s*[-–—]*\s*(לפרטים נוספים.*)$/);
    if (m) {
      if (m[1] && m[1].trim()) desc.push(m[1].trim());
      apply = m[2].trim();
      continue;
    }
    if (/^תנאים/.test(L)) { inTerms = true; desc.push(L); continue; }
    var isReq = function (s) {
      return /חובה/.test(s) || /^יתרון/.test(s) || /נכונות ל/.test(s) || /יכולת לעבוד/.test(s);
    };
    if (!inTerms && isReq(L)) {
      var parts = L.split('. ');
      for (var k = 0; k < parts.length; k++) {
        var seg = parts[k].trim();
        if (!seg) continue;
        if (k < parts.length - 1) seg = seg + '.';
        if (isReq(seg)) req.push(seg); else desc.push(seg);
      }
      continue;
    }
    desc.push(L);
  }
  desc.push(CLOSING);

  var el = document.createElement('div');
  el.className = '__ai-job';

  var a = document.createElement('a');
  a.className = '__ai-link';
  a.setAttribute('href', r.link || '');
  a.textContent = title;
  el.appendChild(a);

  var add = function (cls, val) {
    var s = document.createElement('span');
    s.className = cls;
    s.style.whiteSpace = 'pre-wrap';
    s.textContent = val || '';
    el.appendChild(s);
  };

  add('__ai-title', title);
  add('__ai-jobid', 'willifood-' + r.id);
  add('__ai-date', r.date || '');
  add('__ai-desc', desc.join('\n'));
  add('__ai-req', req.join('\n'));
  add('__ai-loc', CITY);
  add('__ai-apply', apply);

  host.appendChild(el);
}
