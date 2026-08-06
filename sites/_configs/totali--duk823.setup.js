
// totali.com — runs on listing AND each detail page (idempotent).

// 1) externalJobId: the trailing (NNNNNN) code in each job title (per listing item).
document.querySelectorAll('article.elementor-post').forEach(function(art){
  if (art.querySelector('.__ai-jobid')) return;
  var titleEl = art.querySelector('.elementor-post__title');
  var t = titleEl ? (titleEl.textContent || '') : '';
  var m = t.match(/\((\d{3,})\)[\s\u00a0]*$/);
  if (m){
    var s = document.createElement('span');
    s.className = '__ai-jobid';
    s.textContent = m[1];
    art.appendChild(s);
  }
});

// 2) Detail page: locate the job-body text widget (has apply CTA / sections).
function cfDecode(hex){
  try { var k=parseInt(hex.substr(0,2),16),o=''; for(var i=2;i<hex.length;i+=2){o+=String.fromCharCode(parseInt(hex.substr(i,2),16)^k);} return o; } catch(e){ return ''; }
}
var widgets = Array.prototype.slice.call(document.querySelectorAll('.elementor-widget-theme-post-content .elementor-widget-container, .elementor-widget-text-editor .elementor-widget-container'));
var body = null;
for (var i=0;i<widgets.length;i++){
  var txt = widgets[i].innerText || widgets[i].textContent || '';
  if (/יש\s*לשלוח|הגשת\s*מועמדות|תפקיד\s*:/.test(txt)){ body = widgets[i]; break; }
}
if (body){
  var bt = body.innerText || body.textContent || '';

  // location: extract BEFORE stripping, value after "מיקום:"
  if (!document.querySelector('.__ai-location')){
    var lm = bt.match(/מיקום\s*[:\-\u2013]\s*([^\n\r]+)/);
    if (lm){
      var ls = document.createElement('span');
      ls.className = '__ai-location';
      ls.textContent = lm[1].trim();
      document.body.appendChild(ls);
    }
  }

  // applicationInfo: extract BEFORE stripping — email + subject instruction.
  if (!document.querySelector('.__ai-applyinfo')){
    var email = '';
    var cf = body.querySelector('[data-cfemail]');
    if (cf) email = cfDecode(cf.getAttribute('data-cfemail'));
    if (!email){
      var em = bt.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
      if (em) email = em[0];
    }
    var subj = '';
    var sm = bt.match(/יש\s*לציין[^\n\r]*/);
    if (sm) subj = sm[0].trim().replace(/\*+/g,'').replace(/\[\d+\]/g,'').replace(/\s{2,}/g,' ').trim();
    var parts = [];
    if (email) parts.push('דוא"ל: ' + email);
    if (subj) parts.push(subj);
    if (parts.length){
      var as = document.createElement('span');
      as.className = '__ai-applyinfo';
      as.textContent = parts.join(' | ');
      document.body.appendChild(as);
    }
  }

  // Strip the "הגשת מועמדות" apply block from the description DOM so it
  // doesn't appear in the description text. Walk block children; once we hit
  // the apply-section heading, remove it and every sibling after it.
  var blocks = Array.prototype.slice.call(body.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, br'));
  var cutting = false;
  for (var bi = 0; bi < blocks.length; bi++) {
    var blk = blocks[bi];
    var blkTxt = blk.textContent || '';
    if (!cutting && /הגשת\s*מועמדות/.test(blkTxt)) { cutting = true; }
    if (cutting && blk.parentNode) { blk.parentNode.removeChild(blk); }
  }
  // Also strip any remaining plain-text nodes after the apply heading that
  // may have slipped through (רק פניות ..., etc.) by truncating at the marker.
  // Walk text nodes inside body and blank those that mention the apply CTA.
  var walker = document.createTreeWalker(body, 4 /* NodeFilter.SHOW_TEXT */);
  var tn;
  while ((tn = walker.nextNode())) {
    if (/הגשת\s*מועמדות|יש\s*לשלוח|יש\s*לציין|רק פניות/.test(tn.nodeValue || '')) {
      tn.nodeValue = '';
    }
  }

  // description: tag the cleaned body so block line-breaks are preserved.
  body.classList.add('__ai-jobbody');
}
