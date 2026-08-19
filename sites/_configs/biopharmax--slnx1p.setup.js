/* Biopharmax — WordPress + Elementor + JetEngine listing (www.biopharmax.com/he/careers/).
   Listing cards carry only a truncated excerpt, so each detail page is fetched
   same-origin and its REAL block nodes are imported (never textContent) so
   paragraphs/bullets survive — LRN-SETUP-11. Scope is ISRAEL-ONLY: India rows
   are removed from the listing before extraction. */
try {
  var ITEM = '.jet-listing-grid__item';
  var items = [].slice.call(document.querySelectorAll(ITEM));
  if (items.length) {
    /* city.csv-verbatim tokens only (cities first, regions last) */
    var MAP = [
      ['herzliya','הרצליה'], ['hertzliya','הרצליה'], ['הרצליה','הרצליה'],
      ['or akiva','אור עקיבא'], ['kiryat gat','קרית גת'], ['jerusalem','ירושלים'],
      ['tel aviv','תל אביב-יפו'], ['haifa','חיפה'], ['rehovot','רחובות'],
      ['ness ziona','נס ציונה'], ['modiin','מודיעין'], ["modi'in",'מודיעין'],
      ['beer sheva','באר שבע'], ["be'er sheva",'באר שבע'], ['netanya','נתניה'],
      ['petah tikva','פתח תקווה'], ['rosh haayin','ראש העין'], ['caesarea','קיסריה'],
      ['ashdod','אשדוד'], ['ashkelon','אשקלון'], ['raanana','רעננה'],
      ['kfar saba','כפר סבא'], ['holon','חולון'], ['rishon','ראשון לציון'],
      ['ramat gan','רמת גן'], ['bnei brak','בני ברק'], ['afula','עפולה'],
      ['central israel','אזור מרכז'], ['northern israel','אזור צפון'],
      ['southern israel','אזור דרום'], ['shfela','אזור שפלה']
    ];
    var NONIL = /india|pune|mumbai|hyderabad|bangalore|bengaluru|new delhi|chennai|ahmedabad|gujarat|maharashtra/i;
    var REQ = /^(requirements|qualifications|candidate profile|advantages|skills|experience required|דרישות|כישורים|יתרונות?)\b/i;
    var LOC = /^(job\s*)?location\b/i;
    var EMAIL = /[\w.+-]+@[\w-]+\.[\w.]{2,}/g;
    var CTA = /(שלחו|לשלוח|שליחת)?\s*(קורות\s*חיים|קו"?ח|cv|resume)\s*(למייל|לכתובת|to)?\s*:?\s*$/i;

    var mk = function (cls, txt) {
      var s = document.createElement('span');
      s.className = cls; s.style.display = 'none'; s.textContent = txt;
      return s;
    };
    var isHead = function (el) {
      if (/^H[1-6]$/.test(el.tagName)) return true;
      if (el.tagName !== 'P') return false;
      var t = (el.textContent || '').trim();
      if (!t || t.length > 60) return false;
      var s = el.querySelector('strong,b');
      return !!s && s.textContent.trim().length >= t.length - 2;
    };
    var scrub = function (root) {
      root.querySelectorAll('h1,h2,style,script,noscript,iframe,form,button').forEach(function (n) { n.remove(); });
      root.querySelectorAll('[data-cfemail],.__cf_email__,a[href^="mailto:"],a[href*="email-protection"]').forEach(function (n) { n.remove(); });
      var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      var tn = [], n;
      while ((n = w.nextNode())) tn.push(n);
      tn.forEach(function (t) {
        var v = t.nodeValue.replace(EMAIL, '').replace(CTA, '');
        if (v !== t.nodeValue) t.nodeValue = v;
      });
      root.querySelectorAll('p,div,span,strong,li').forEach(function (e) {
        if (!(e.textContent || '').trim() && !e.querySelector('img')) e.remove();
      });
    };
    var box = function (cls, nodes) {
      var d = document.createElement('div');
      d.className = cls; d.style.display = 'none';
      nodes.forEach(function (nd) { d.appendChild(document.importNode(nd, true)); });
      scrub(d);
      return d;
    };
    var pickAll = function (s) {
      s = (s || '').toLowerCase();
      var out = [];
      MAP.forEach(function (m) { if (s.indexOf(m[0]) >= 0 && out.indexOf(m[1]) < 0) out.push(m[1]); });
      return out;
    };

    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.querySelector('.__ai-externalJobId')) continue;          /* idempotency */
      var a = it.querySelector('a[href*="/career/"]');
      var href = a ? a.href : '';
      if (!href) { it.remove(); continue; }
      var pm = (it.className || '').match(/jet-listing-dynamic-post-(\d+)/);

      var res = await fetch(href, { credentials: 'same-origin' });
      var raw = await res.text();
      var doc = new DOMParser().parseFromString(raw, 'text/html');
      /* Yoast JSON-LD carries the real post date; nothing prints it in the DOM */
      var dm = raw.match(/"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2}[^"]*)"/);
      var c = doc.querySelector('.elementor-widget-theme-post-content');
      while (c && c.children.length === 1) c = c.children[0];
      if (!c) { it.remove(); continue; }

      var kids = [].slice.call(c.children);
      var dNodes = [], rNodes = [], lTxt = '', bucket = 'D';
      kids.forEach(function (el) {
        if (isHead(el)) {
          var ht = (el.textContent || '').trim();
          bucket = REQ.test(ht) ? 'R' : (LOC.test(ht) ? 'L' : 'D');
          /* drop only the FIRST requirements label; keep sub-headings (Advantages) */
          if (bucket === 'R') { if (rNodes.length) rNodes.push(el); }
          else if (bucket === 'D') dNodes.push(el);
          return;
        }
        if (bucket === 'R') rNodes.push(el);
        else if (bucket === 'L') lTxt += ' ' + (el.textContent || '');
        else dNodes.push(el);
      });

      var full = (c.textContent || '') + ' ' + href;
      /* ISRAEL-ONLY scope: keep a row only on positive Israel evidence. */
      var slugIN = /india\/?$/i.test(href);
      var txtIN = NONIL.test(lTxt || (c.textContent || ''));
      var hasIL = /israel|isreal|ישראל/i.test(full);
      if (slugIN || txtIN || !hasIL) { it.remove(); continue; }

      var arr = pickAll(lTxt);
      if (!arr.length) arr = pickAll(c.textContent || '');
      if (!arr.length) arr = ['Unknown'];   /* ad names a country, not a city - do NOT guess */

      it.appendChild(box('__ai-description', dNodes));
      it.appendChild(box('__ai-requirements', rNodes));
      it.appendChild(mk('__ai-location', arr.slice(0, 3).join(', ')));
      it.appendChild(mk('__ai-externalJobId', 'bpx-' + (pm ? pm[1] : href.replace(/\/$/, '').split('/').pop())));
      it.appendChild(mk('__ai-apply', href));
      if (dm) it.appendChild(mk('__ai-publishDate', dm[1]));
    }
  }
} catch (e) { console.log('[biopharmax setup] ' + e); }
