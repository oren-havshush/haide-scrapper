await (async () => {
  // Electra prints a job's identity only inside the listing anchor's href
  // (//www.electra.co.il/career/משרות?job_id=12283). Mapping externalJobId to
  // that href stored the whole URL as the id. The only other attribute,
  // data-node-item, is a render-order index that shifts whenever a posting is
  // added or closed, so it cannot serve as identity. Expose the job_id query
  // param as its own element and let externalJobId map to it.
  //
  // .more_contnet (the requirements container) also ends with an apply/close
  // button row. domFieldExtract strips script/style/svg/iframe but has no
  // reason to drop links or divs, so "שליחת קו״ח" and "סגור" were landing in
  // every stored requirements value. Remove that row here.
  // .summary is deliberately kept - it is Electra's own ad copy, not chrome.
  var items = document.querySelectorAll('.job');
  var stamped = 0;
  items.forEach(function (item) {
    if (!item.querySelector('.haide-jobid')) {
      var a = item.querySelector('.title a');
      var href = a ? (a.getAttribute('href') || '') : '';
      var m = /[?&]job_id=(\d+)/.exec(href);
      if (m) {
        var span = document.createElement('span');
        span.className = 'haide-jobid';
        span.style.display = 'none';
        span.textContent = m[1];
        item.appendChild(span);
        stamped++;
      }
    }
    item.querySelectorAll('.more_contnet .btns').forEach(function (n) {
      n.remove();
    });
  });
  // Fail-safe: if the href shape ever changes and nothing gets stamped, remove
  // any partial markers so extraction falls back to its normal path rather
  // than silently writing an empty externalJobId for every job.
  if (stamped === 0) {
    document.querySelectorAll('.haide-jobid').forEach(function (n) { n.remove(); });
  }
})();
