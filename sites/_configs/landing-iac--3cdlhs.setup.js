try {
  document.querySelectorAll('details.job-card').forEach(function (card) {
    if (card.querySelector('[data-haide-desc]')) return;
    var det = card.querySelector('.job-details');
    if (!det) return;
    var c = det.cloneNode(true);
    c.querySelectorAll('a.apply-btn, a.btn, style, script, noscript, svg, iframe').forEach(function (n) { n.remove(); });
    c.querySelectorAll('br').forEach(function (n) { n.replaceWith('\n'); });
    c.querySelectorAll('li').forEach(function (li) {
      var lt = (li.textContent || '').replace(/^\s+/, '');
      if (lt && !/^[•–\-]/.test(lt)) { li.prepend('• '); }
    });
    c.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, h5, h6').forEach(function (b) { b.append('\n'); });
    var t = (c.textContent || '')
      .replace(/[^\S\n]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/ \n/g, '\n')
      .replace(/\n /g, '\n')
      .trim();
    if (!t) return;
    var span = document.createElement('span');
    span.setAttribute('data-haide-desc', '1');
    span.style.display = 'none';
    span.textContent = t;
    card.appendChild(span);
  });
} catch (e) {}
