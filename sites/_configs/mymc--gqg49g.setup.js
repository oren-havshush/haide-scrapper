// mymc.co.il /jobs/ — Elementor loop of job cards; body, date and id are injected per card.
// Body: detail page "תיאור התפקיד" / "דרישות התפקיד" sections (+ intro post content).
// Date: WP REST `date` for the cards the page shows (field source only, never coverage).
await (async function () {
  if (!/^\/jobs\/?$/.test(location.pathname)) return;
  var cards = document.querySelectorAll('.e-loop-item.type-jobs');
  if (!cards.length || cards[0].querySelector('.__ai-jobid')) return;
  var hash = function (s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); };
  var get = function (u) { return fetch(u, { credentials: 'omit' }).then(function (r) { return r.ok ? r.text() : ''; }).catch(function () { return ''; }); };
  var norm = function (u) { try { return decodeURI(u).replace(/\/+$/, '').toLowerCase(); } catch (e) { return u.replace(/\/+$/, '').toLowerCase(); } };
  var NBSP = new RegExp(String.fromCharCode(160), 'g');

  // Cloudflare email obfuscation: data-cfemail hex, first byte is the xor key.
  var cfDecode = function (hex) {
    var k = parseInt(hex.substr(0, 2), 16), s = '';
    for (var i = 2; i < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.substr(i, 2), 16) ^ k);
    return s;
  };
  var lines = function (el) {
    if (!el) return [];
    var c = el.cloneNode(true);
    c.querySelectorAll('[data-cfemail]').forEach(function (n) { n.textContent = cfDecode(n.getAttribute('data-cfemail')); });
    c.querySelectorAll('script,style').forEach(function (n) { n.remove(); });
    c.querySelectorAll('br').forEach(function (n) { n.replaceWith('\n'); });
    c.querySelectorAll('p,li,div,h1,h2,h3,h4,h5,h6').forEach(function (n) { n.insertAdjacentText('afterend', '\n'); });
    return c.textContent.replace(NBSP, ' ').split('\n')
      .map(function (s) { return s.replace(/[ \t]+/g, ' ').trim(); })
      .filter(function (s) { return s.length > 0; });
  };

  var dates = {};
  try {
    var api = JSON.parse(await get('/wp-json/wp/v2/jobs?per_page=100&_fields=link,date'));
    api.forEach(function (r) { if (r && r.link) dates[norm(r.link)] = r.date; });
  } catch (e) {}

  // Contact, pay and equal-opportunity lines are not requirements; they stay in the description.
  // Duty lines are description even under the דרישות heading (the maintenance job swaps its sections).
  var NOT_REQ = /^לפרטים|@|\d{2,3}-?\d{7}|לנשים ו?ל?גברים כאחד|^תגמול|^שכר|^ביצוע|^טיפול|^מתן מענה/;
  // A line that is only other postings' titles (maintenance job) is not job content (LRN-SETUP-5).
  var OTHER_JOBS = /^בית מאזן פקיד בכיר סניטר\.?$/;

  await Promise.all([].slice.call(cards).map(function (card) {
    var a = card.querySelector('a[href*="/jobs/"]');
    if (!a) return null;
    var href = a.href;
    return get(href).then(function (html) {
      var d = new DOMParser().parseFromString(html || '', 'text/html');
      var desc = [], reqs = [];
      var intro = d.querySelector('.elementor-widget-theme-post-content');
      desc = desc.concat(lines(intro));
      var mode = null;
      var ws = d.querySelectorAll('.elementor-widget-heading, .elementor-widget-text-editor');
      for (var i = 0; i < ws.length; i++) {
        var w = ws[i];
        if (w.classList.contains('elementor-widget-heading')) {
          var t = (w.textContent || '').trim();
          mode = t === 'תיאור התפקיד' ? 'd' : t === 'דרישות התפקיד' ? 'r' : null;
          continue;
        }
        if (!mode) continue;
        var ls = lines(w).filter(function (l) { return !OTHER_JOBS.test(l); });
        if (mode === 'd') desc = desc.concat(ls);
        else ls.forEach(function (l) { (NOT_REQ.test(l) ? desc : reqs).push(l); });
      }

      var title = (card.querySelector('h2') || a).textContent.replace(/\s+/g, ' ').trim();
      var dep = card.querySelector('.elementor-widget-heading .elementor-heading-title');
      var slug = decodeURIComponent(href.replace(/\/+$/, '').split('/').pop());
      var id = /^[!-~]+$/.test(slug) ? 'mymc-' + slug : 'mymc-' + hash(slug);
      var loc = /אחיסמך/.test(title + '\n' + desc.join('\n') + '\n' + reqs.join('\n')) ? 'אחיסמך' : 'בני ברק';

      var mk = function (cls, txt, attr) {
        if (!txt) return;
        var s = document.createElement(attr ? 'a' : 'span');
        s.className = cls; s.style.display = 'none';
        if (attr) s.setAttribute('href', txt); else s.textContent = txt;
        card.appendChild(s);
      };
      mk('__ai-title', title);
      mk('__ai-link', href, true);
      mk('__ai-description', desc.join('\n'));
      mk('__ai-requirements', reqs.join('\n'));
      mk('__ai-location', loc);
      mk('__ai-department', dep ? dep.textContent.replace(/\s+/g, ' ').trim() : '');
      mk('__ai-date', dates[norm(href)] || '');
      mk('__ai-jobid', id);
    });
  }));
})();
