(function(){
  try {
    document.querySelectorAll('.accordion-item').forEach(function(el){
      if (el.querySelector('[data-extracted-location]')) return;
      var s = document.createElement('span');
      s.setAttribute('data-extracted-location','1');
      s.style.display='none';
      s.textContent = '\u05e0\u05d5\u05d5\u05d4 \u05e0\u05d0\u05de\u05df';
      el.appendChild(s);
    });
  } catch(e){}
})();
