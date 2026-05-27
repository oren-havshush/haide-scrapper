$URL = 'https://careers.iec.co.il/?referid=&freeText=&page=1'

$setupScript = @'
(function(){
  try {
    document.querySelectorAll('.job_link_and_share_wrap.job_item').forEach(function(item){
      function cleanAfterHidden(el) {
        if (!el) return '';
        var hidden = el.querySelector('.hidden_span1');
        var raw = el.textContent || '';
        if (hidden && hidden.textContent) raw = raw.replace(hidden.textContent, '');
        return raw.replace(/\s+/g, ' ').trim();
      }
      if (!item.querySelector('[data-x-location]')) {
        var loc = item.querySelector('.career_location');
        if (loc) {
          var s = document.createElement('span');
          s.setAttribute('data-x-location','1');
          s.style.display = 'none';
          s.textContent = cleanAfterHidden(loc);
          item.appendChild(s);
        }
      }
      if (!item.querySelector('[data-x-department]')) {
        var occ = item.querySelector('.career_occupation');
        if (occ) {
          var s = document.createElement('span');
          s.setAttribute('data-x-department','1');
          s.style.display = 'none';
          s.textContent = cleanAfterHidden(occ);
          item.appendChild(s);
        }
      }
      if (!item.querySelector('[data-x-deadline]')) {
        var dl = item.querySelector('.career_dead_line');
        if (dl) {
          var raw = cleanAfterHidden(dl);
          var m = raw.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
          var s = document.createElement('span');
          s.setAttribute('data-x-deadline','1');
          s.style.display = 'none';
          s.textContent = m ? m[1] : raw;
          item.appendChild(s);
        }
      }
      var oid = item.getAttribute('data-order_id');
      if (oid && !item.querySelector('[data-x-jobid]')) {
        var s = document.createElement('span');
        s.setAttribute('data-x-jobid','1');
        s.style.display = 'none';
        s.textContent = oid;
        item.appendChild(s);
      }
    });
  } catch (e) {}
})();
'@

function FM($selector, $extractAttr = $null) {
  $h = [ordered]@{
    selector      = $selector
    confidence    = 100
    source        = 'MANUAL'
    capturedOnUrl = $URL
  }
  if ($extractAttr) { $h.extractAttr = $extractAttr }
  return $h
}

$config = [ordered]@{
  listingSelector = '.wrap_careers'
  itemSelector    = '.job_link_and_share_wrap.job_item'
  setupScript     = $setupScript
  fieldMappings   = [ordered]@{
    title         = FM 'button.archive-job_item-title'
    externalJobId = FM '[data-x-jobid]'
    location      = FM '[data-x-location]'
    department    = FM '[data-x-department]'
    deadline      = FM '[data-x-deadline]'
    description   = FM '.career_short_description'
    detailUrl     = FM 'button.icon-share_link' 'data-copy'
  }
  pageFlow    = @()
  formCapture = $null
}

$configJson = $config | ConvertTo-Json -Depth 20
$configPath = (Resolve-Path '.\.scratch').Path + '\iec-config.json'
[System.IO.File]::WriteAllText($configPath, $configJson, [System.Text.UTF8Encoding]::new($false))
Write-Host "Wrote $configPath ($([System.IO.File]::ReadAllBytes($configPath).Length) bytes)"
