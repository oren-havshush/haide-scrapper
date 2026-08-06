(function(){
  try {
    var ORDERS = (typeof orders !== 'undefined' && orders) ? orders : (window.orders || {});
    function htmlToText(html){
      var d = document.createElement('div');
      d.innerHTML = html || '';
      Array.prototype.forEach.call(d.querySelectorAll('br'), function(b){
        b.parentNode.replaceChild(document.createTextNode('\n'), b);
      });
      Array.prototype.forEach.call(d.querySelectorAll('p,div,li,tr,h1,h2,h3,h4,h5,h6'), function(b){
        b.appendChild(document.createTextNode('\n'));
      });
      return (d.textContent || '')
        .replace(/ /g, ' ')
        .replace(/[^\S\n]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/ \n/g, '\n')
        .replace(/\n /g, '\n')
        .trim();
    }
    function put(item, attr, text){
      if (!text || item.querySelector('[' + attr + ']')) return;
      var s = document.createElement('span');
      s.setAttribute(attr, '1');
      s.style.display = 'none';
      s.textContent = text;
      item.appendChild(s);
    }
    // Heading positions inside the ad body. Advantage must be found before the
    // generic mandatory match, otherwise "דרישות יתרון" is swallowed by "דרישות".
    var RE_ADV = /(?:^|\n)\s*(?:דרישות\s+יתרון|יתרון)\s*:?\s*(?=\n|$)/;
    var RE_REQ = /(?:^|\n)\s*(?:דרישות\s+חובה|דרישות\s+המשרה|דרישות\s+התפקיד|דרישות)\s*:?\s*(?=\n|$)/;
    var RE_DESC_HEAD = /^\s*(?:תיאור\s+המשרה|תיאור\s+התפקיד)\s*:?\s*\n/;
    function splitBody(text){
      var adv = text.search(RE_ADV);
      var req = text.search(RE_REQ);
      // A requirements heading found after the advantage heading is part of the
      // advantage block, not a separate section — ignore it.
      if (adv > -1 && req > adv) req = -1;
      var descEnd = req > -1 ? req : (adv > -1 ? adv : text.length);
      var desc = text.slice(0, descEnd).trim().replace(RE_DESC_HEAD, '').trim();
      var mand = '';
      if (req > -1) {
        var mEnd = (adv > -1 && adv > req) ? adv : text.length;
        mand = text.slice(req, mEnd).trim();
      }
      var advBody = '';
      if (adv > -1) {
        advBody = text.slice(adv).trim().replace(RE_ADV, '').trim();
      }
      var reqOut = mand;
      if (advBody) reqOut = (reqOut ? reqOut + '\n\n' : '') + 'יתרון:\n' + advBody;
      return { description: desc, requirements: reqOut.trim() };
    }
    Array.prototype.forEach.call(document.querySelectorAll('.job_link_and_share_wrap.job_item'), function(item){
      function cleanAfterHidden(el) {
        if (!el) return '';
        var hidden = el.querySelector('.hidden_span1');
        var raw = el.textContent || '';
        if (hidden && hidden.textContent) raw = raw.replace(hidden.textContent, '');
        return raw.replace(/[^\S\n]+/g, ' ').trim();
      }
      var loc = item.querySelector('.career_location');
      if (loc) put(item, 'data-x-location', cleanAfterHidden(loc));
      var occ = item.querySelector('.career_occupation');
      if (occ) put(item, 'data-x-department', cleanAfterHidden(occ));
      var dl = item.querySelector('.career_dead_line');
      if (dl) {
        var raw = cleanAfterHidden(dl);
        var dm = raw.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
        put(item, 'data-x-deadline', dm ? dm[1] : raw);
      }
      var oid = item.getAttribute('data-order_id');
      if (oid) put(item, 'data-x-jobid', oid);
      // Full ad body lives in the page-level `orders` map, keyed by order_id.
      // The listing itself only carries a truncated blurb.
      var o = oid ? ORDERS[oid] : null;
      if (o && o.content) {
        var parts = splitBody(htmlToText(o.content));
        put(item, 'data-x-description', parts.description);
        put(item, 'data-x-requirements', parts.requirements);
      }
      if (o && o.areas && !item.querySelector('[data-x-location]')) {
        put(item, 'data-x-location', htmlToText(o.areas));
      }
    });
  } catch (e) {}
})();
