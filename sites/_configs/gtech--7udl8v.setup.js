// gtech.co.il — Elementor/WordPress posts. This script runs on BOTH the listing
// page and every detail page, so each half guards on what only exists there.
//
// LISTING: drop catch-all/SEO rows that are not a real vacancy (post 18812 is a
// "browse our QA job board" landing card, not a job), and seed the WP post id.
document.querySelectorAll('article.elementor-post').forEach(function (it) {
  try {
    var t = (it.textContent || '').replace(/\s+/g, ' ');
    if (/מזמינים אתכם להציץ|לוח המשרות שלנו|שלחו(?: לנו)? קורות חיים|משרה כללית/.test(t)) {
      it.remove();
      return;
    }
    if (!it.querySelector('.__ai-jobid')) {
      var m = (it.className || '').match(/post-(\d+)/);
      if (m) {
        var s = document.createElement('span');
        s.className = '__ai-jobid';
        s.style.display = 'none';
        s.textContent = m[1];
        it.appendChild(s);
      }
    }
  } catch (e) {}
});

// DETAIL: a single post page carries the id in its body class and the whole ad
// in one content block.
try {
  var cls = document.body.className || '';
  if (/\bsingle-post\b/.test(cls)) {
    var pm = cls.match(/postid-(\d+)/);
    if (pm && !document.querySelector('.__ai-postid')) {
      var j = document.createElement('span');
      j.className = '__ai-postid';
      j.style.display = 'none';
      j.textContent = pm[1];
      document.body.appendChild(j);
    }

    // Split the ad into description (the role) and requirements (the דרישות
    // block) by MOVING the requirement nodes out of the content element rather
    // than copying their text out of it. Copying would leave the same prose in
    // both fields; moving keeps them disjoint and loses nothing. The nodes are
    // moved, never rewritten, so <li> bullets and <br> breaks still reach the
    // worker's block-aware text extractor.
    var w = document.querySelector('.elementor-widget-theme-post-content');
    if (w && !document.querySelector('.__ai-requirements')) {
      var host = w.querySelector('.elementor-widget-container') || w;

      // The apply form is normally its own Elementor widget, OUTSIDE this block —
      // but on some posts (18237) it sits INSIDE the ad body as a trailing child.
      // The requirements sweep below moves every node after the דרישות heading,
      // so that form's field labels ("שם פרטי / שם משפחה / טלפון / אימייל /
      // העלאת קובץ קו\"ח / שליחת קו\"ח") shipped as if they were job requirements.
      // Merely SKIPPING it in the sweep would leave it in the content block and
      // pollute `description` instead, so drop it from the document outright: it
      // is the apply path, not ad copy. Gated on >= 2 real form controls so a
      // paragraph with one stray inline control is never mistaken for the form.
      Array.prototype.slice.call(host.children).forEach(function (c) {
        if (c.querySelectorAll && c.querySelectorAll('input, textarea, select').length >= 2) {
          c.parentNode.removeChild(c);
        }
      });

      var RE = /^\s*(?:דרישות(?:\s+התפקיד)?|כישורים(?:\s+נדרשים)?|תנאי\s+סף)\s*:?\s*/;
      var kids = Array.prototype.slice.call(host.children);
      for (var i = 0; i < kids.length; i++) {
        var k = kids[i];
        var txt = (k.textContent || '').replace(/ /g, ' ');
        var m2 = RE.exec(txt);
        if (!m2) continue;
        // Keep the whole body as description when there is no real role text
        // ahead of the heading — an empty description is worse than an
        // unsplit one.
        var lead = '';
        for (var q = 0; q < i; q++) lead += (kids[q].textContent || '');
        if (lead.replace(/\s+/g, ' ').trim().length < 40) break;

        var box = document.createElement('div');
        box.className = '__ai-requirements';
        box.style.display = 'none';
        var rest = txt.slice(m2[0].length).trim();
        if (rest) {
          // Heading runs inline with its content ("דרישות התפקיד:תואר ראשון…"):
          // clone the node and strip only the label from its first text node.
          var clone = k.cloneNode(true);
          var walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT, null);
          var tn = walker.nextNode();
          while (tn && !(tn.nodeValue || '').trim()) tn = walker.nextNode();
          if (tn) tn.nodeValue = (tn.nodeValue || '').replace(RE, '');
          box.appendChild(clone);
        }
        k.parentNode.removeChild(k);
        for (var n = i + 1; n < kids.length; n++) box.appendChild(kids[n]);
        document.body.appendChild(box);
        break;
      }
    }
  }
} catch (e) {}
