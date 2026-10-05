// minet.co.il/דרושים: Elementor posts widget, article.elementor-post per job; body on the post page.
// Id: Hebrew slug -> minet-haideHash(decoded slug) (LRN-ID-6). Date: the card's "דצמבר 9, 2025".
// Body split: requirements start at the first requirements-class heading (דרישות / השכלה / ניסיון
// נדרש / יכולות…); labels that only restate a field are dropped, others stay as sub-headings.
// The "לפרטים והגשת מועמדות – <email>" line leaves the description -> applicationInfo (mailto).
// Location (owner 2026-10-05): only where the ad says where the job is — per job, by id.
var NBSP = String.fromCharCode(160);
function haideHash(s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); }
var LOC = { 'minet-13f2t6i': 'באר שבע', 'minet-dqst3s': 'אשדוד' };
var MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
var DROP = /^(עיקרי התפקיד|דרישות|דרישות התפקיד|דרישות וכישורים נוספים|תיאור התפקיד)\s*:?$/;
var REQ_H = /^(דרישות|השכלה|ניסיון נדרש|יכולות ומיומנויות|כישורים)/;
var APPLY = /^לפרטים והגשת מועמדות/;
var HEADLESS_REQ = /^(ניסיון|נסיון)\s/;
function isHeading(el) {
  if (/^H[1-6]$/.test(el.tagName)) return true;
  var t = el.textContent.trim(), b = el.querySelector('strong,b,u');
  return !!b && t.length < 60 && Array.prototype.every.call(el.childNodes, function (n) { return n.nodeType !== 3 || !n.textContent.trim(); });
}
function lines(el) {
  var c = el.cloneNode(true);
  Array.prototype.forEach.call(c.querySelectorAll('p,div,li,br,h1,h2,h3,h4'), function (e) { e.insertAdjacentText('afterend', '\n'); });
  return c.textContent.split(NBSP).join(' ').split('\n').map(function (l) { return l.replace(/\s{2,}/g, ' ').trim(); }).filter(Boolean);
}
function mk(cls, val) { var e = document.createElement('span'); e.className = cls; e.style.display = 'none'; e.textContent = val; return e; }
var items = document.querySelectorAll('article.elementor-post');
await Promise.all(Array.prototype.map.call(items, async function (item) {
  if (item.querySelector('.__ai-id')) return;
  var a = item.querySelector('.elementor-post__title a');
  if (!a) return;
  var slug = decodeURIComponent(a.href.replace(/\/+$/, '').split('/').pop());
  var id = 'minet-' + haideHash(slug);
  item.appendChild(mk('__ai-id', id));
  var dm = /(\S+)\s+(\d{1,2}),\s*(\d{4})/.exec((item.querySelector('.elementor-post-date') || {}).textContent || '');
  if (dm && MONTHS.indexOf(dm[1]) >= 0) {
    var mo = MONTHS.indexOf(dm[1]) + 1;
    item.appendChild(mk('__ai-date', dm[3] + '-' + (mo < 10 ? '0' : '') + mo + '-' + (dm[2].length < 2 ? '0' : '') + dm[2]));
  }
  item.appendChild(mk('__ai-location', LOC[id] || 'Unknown'));
  try {
    var doc = new DOMParser().parseFromString(await (await fetch(a.href)).text(), 'text/html');
    var body = doc.querySelector('.elementor-widget-theme-post-content .elementor-widget-container') || doc.querySelector('.elementor-widget-theme-post-content');
    if (!body) return;
    var root = body.children.length === 1 && body.firstElementChild.tagName === 'DIV' && body.firstElementChild.children.length > 1 ? body.firstElementChild : body;
    var desc = [], req = [], sec = 'desc', mail = '';
    Array.prototype.forEach.call(root.children, function (block) {
      var ls = lines(block);
      if (!ls.length) return;
      if (APPLY.test(ls[0])) {
        var m = block.querySelector('a[href^="mailto:"]');
        if (m) mail = m.getAttribute('href').replace(/^mailto:/i, '').split('?')[0].trim();
        return;
      }
      if (isHeading(block) || (block.tagName === 'P' && ls.length === 1 && /:\s*$/.test(ls[0]) && ls[0].length < 60)) {
        var h = ls.join(' ');
        if (REQ_H.test(h)) sec = 'req';
        if (DROP.test(h)) return;
        (sec === 'req' ? req : desc).push(h);
        return;
      }
      ls.forEach(function (l) {
        if (sec === 'desc' && HEADLESS_REQ.test(l)) { req.unshift(l); return; }
        (sec === 'req' ? req : desc).push(l);
      });
    });
    item.appendChild(mk('__ai-description', desc.join('\n')));
    if (req.length) item.appendChild(mk('__ai-requirements', req.join('\n')));
    if (mail) item.appendChild(mk('__ai-apply', 'mailto:' + mail));
  } catch (e) { }
}));
