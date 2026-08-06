
try {
  document.querySelectorAll('.cookies-popup-wrapper,.wrapper-popup,#elementor-popup-modal-7706')
    .forEach(function(el){ el.style.display='none'; });

  var cols = Array.prototype.slice.call(document.querySelectorAll('div.elementor-column'))
    .filter(function(c){ return c.querySelector('a.elementor-button[href*="popup"]'); });

  function decodeId(btn){
    try {
      var dec = decodeURIComponent(btn.getAttribute('href') || '');
      var m = dec.match(/settings=([A-Za-z0-9+/=]+)/);
      if (m && m[1]) { var j = JSON.parse(atob(m[1])); return j.id ? String(j.id) : ''; }
    } catch(e){}
    return '';
  }

  for (var i=0;i<cols.length;i++){
    var col = cols[i];
    var btn = col.querySelector('a.elementor-button[href*="popup"]');
    if (!btn) continue;
    var id = decodeId(btn);
    if (!id) continue;

    if (!col.querySelector('[data-extracted-jobid]')) {
      var idspan = document.createElement('span');
      idspan.setAttribute('data-extracted-jobid','1');
      idspan.style.display='none';
      idspan.textContent = id;
      col.appendChild(idspan);
    }

    if (col.querySelector('[data-extracted-description]')) continue;
    try {
      if (window.elementorProFrontend && window.elementorProFrontend.modules && window.elementorProFrontend.modules.popup) {
        window.elementorProFrontend.modules.popup.showPopup({ id: id });
      }
    } catch(e){}

    var sel = '#elementor-popup-modal-' + id;
    var modal = null;
    for (var t=0;t<40;t++){
      modal = document.querySelector(sel);
      if (modal && (modal.textContent||'').trim().length > 80) break;
      await new Promise(function(r){ setTimeout(r,150); });
    }
    if (modal) {
      var descParts = [];
      var reqParts = [];
      var inReq = false;
      var widgets = modal.querySelectorAll('.elementor-widget-heading, .elementor-widget-text-editor');
      Array.prototype.forEach.call(widgets, function(wd){
        var txt = (wd.textContent||'').replace(/\s+/g,' ').trim();
        if (!txt) return;
        var isHeading = wd.classList.contains('elementor-widget-heading');
        if (isHeading && /\u05dc\u05d4\u05d2\u05e9\u05ea \u05de\u05d5\u05e2\u05de\u05d3\u05d5\u05ea/.test(txt)) { inReq = false; return; }
        if (isHeading && /\u05d3\u05e8\u05d9\u05e9/.test(txt)) { inReq = true; return; }
        if (isHeading) { inReq = false; }
        if (inReq) { reqParts.push(txt); } else { descParts.push(txt); }
      });
      var desc = descParts.join('\n').trim();
      var req = reqParts.join('\n').trim();
      if (desc && !col.querySelector('[data-extracted-description]')) {
        var d = document.createElement('span');
        d.setAttribute('data-extracted-description','1'); d.style.display='none';
        d.textContent = desc; col.appendChild(d);
      }
      if (req && !col.querySelector('[data-extracted-requirements]')) {
        var rq = document.createElement('span');
        rq.setAttribute('data-extracted-requirements','1'); rq.style.display='none';
        rq.textContent = req; col.appendChild(rq);
      }

      // Location (deterministic, scanning TITLE + DESC + REQ only — never the
      // apply form, whose "אזור מגורים" dropdown is the applicant's region):
      //   * an explicit "לאזור/באזור <region>" wins (field/technician roles),
      //   * otherwise default to HQ רמת גן (call-centre/office + multi-base roles).
      // We always inject so the value is fully under our control and the worker
      // gazetteer (which mis-reads "במשמרות"=shifts as the moshav משמרות) never runs.
      var heading = col.querySelector('.elementor-heading-title');
      var titleTxt = heading ? (heading.textContent||'') : '';
      var locText = (titleTxt + ' ' + desc + ' ' + req);
      var loc = '\u05e8\u05de\u05ea \u05d2\u05df'; // רמת גן
      var rm = locText.match(/[\u05dc\u05d1]\u05d0\u05d6\u05d5\u05e8\s+(\u05d4?(?:\u05de\u05e8\u05db\u05d6|\u05e6\u05e4\u05d5\u05df|\u05d3\u05e8\u05d5\u05dd|\u05e9\u05e8\u05d5\u05df|\u05e9\u05e4\u05dc\u05d4|\u05d2\u05dc\u05d9\u05dc|\u05e0\u05d2\u05d1))/);
      if (rm && rm[1]) { loc = rm[1]; }
      if (!col.querySelector('[data-extracted-location]')) {
        var lc = document.createElement('span');
        lc.setAttribute('data-extracted-location','1'); lc.style.display='none';
        lc.textContent = loc;
        col.appendChild(lc);
      }

      modal.style.display='none';
    }
  }
} catch(e){}
