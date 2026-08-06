try {
  document.querySelectorAll('div.section-carrer__item.rtl').forEach(function (d) {
    if (d.querySelector('[data-ex-id]')) return;
    var h = d.querySelector('h3');
    var t = h ? (h.textContent || '') : '';
    var m = t.match(/משרה\D*(\d+)/);
    var es = document.createElement('span');
    es.setAttribute('data-ex-id', '1');
    es.style.display = 'none';
    es.textContent = m ? m[1] : ('h-' + t.replace(/\s+/g, '').slice(0, 24));
    d.appendChild(es);
  });
} catch (e) {}
