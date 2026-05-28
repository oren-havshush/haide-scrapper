# One-shot diagnostic: PUT bezeq config with a diagnostic setupScript that
# ALWAYS injects exactly one .haide-job, with the title field carrying a
# step-trace log. The worker will extract that job; we read it back via
# /api/jobs and we know exactly where the in-page logic broke.
#
# Outcome interpretation:
#   - jobs=0 -> setupScript itself never produced a .haide-job. Likely the
#     worker pre-extracts before setupScript runs (unlikely, code says no), or
#     the worker can't see #haide-jobs (CSP / sandbox / iframe context).
#   - jobs>=1 with title beginning "DEBUG:" -> the trace tells us which step
#     fired last. Look for:
#       * 'xhrSendThrew' -> CSP connect-src or network block on worker IP
#       * 'status=403' / 'status=503' -> WAF on the data API
#       * 'itemsInPayload=27' -> XHR succeeded; the production setupScript's
#         issue must be in the injection/extraction phase (SPA wipe).
#
# Restoring the production setupScript: re-run sites/bezeq/apply-overrides.ps1.

$ErrorActionPreference = 'Stop'

$SITE_ID = 'cmpmv882i001x01mvhf9qfaqy'
$URL     = 'https://www.bezeq.co.il/career_new/'
$BASE    = 'https://scrapper.haide-jobs.co.il'

$TOKEN = ((Get-Content .\.claude\scrap-token -Raw) -replace '\s','')
$HEADERS = @{ Authorization = "Bearer $TOKEN" }

Write-Host "==> Fetching existing bezeq config..."
$existing = Invoke-RestMethod -Method Get -Uri "$BASE/api/sites?siteUrl=$([uri]::EscapeDataString($URL))" -Headers $HEADERS
$site = $existing.data[0]
$meta = $site.fieldMappings._meta

function FieldMappingsToPSObject([object]$src) {
  $out = [ordered]@{}
  foreach ($prop in $src.PSObject.Properties) {
    if ($prop.Name -eq '_meta') { continue }
    $v = $prop.Value
    $entry = [ordered]@{
      selector       = $v.selector
      confidence     = $v.confidence
      source         = $v.source
      capturedOnUrl  = $v.capturedOnUrl
    }
    if ($v.extractAttr) { $entry.extractAttr = $v.extractAttr }
    $out[$prop.Name] = $entry
  }
  return $out
}

$diagSetup = @'
(function () {
  function add(parent, tag, field, value, attrs) {
    var el = document.createElement(tag);
    el.setAttribute('data-field', field);
    if (attrs) { for (var k in attrs) el.setAttribute(k, attrs[k]); }
    el.textContent = value == null ? '' : String(value);
    parent.appendChild(el);
  }
  var log = ['init'];
  function finalize() {
    var container = document.createElement('div');
    container.id = 'haide-jobs';
    container.style.display = 'none';
    var item = document.createElement('div');
    item.className = 'haide-job';
    add(item, 'span', 'externalJobId', 'DEBUG-' + Date.now());
    add(item, 'span', 'title', 'DEBUG: ' + log.join(' | '));
    add(item, 'span', 'description', JSON.stringify({ steps: log, url: location.href, bodyKids: (document.body ? document.body.children.length : -1) }));
    add(item, 'span', 'location', location.href);
    add(item, 'span', 'department', String(document.body ? document.body.children.length : -1));
    add(item, 'span', 'publishDate', new Date().toISOString());
    add(item, 'span', 'applicationInfo', '');
    add(item, 'span', 'subProfession', '');
    add(item, 'span', 'workArea', '');
    add(item, 'span', 'clientName', '');
    add(item, 'span', 'deadlineDate', '');
    add(item, 'span', 'manningType', '');
    add(item, 'span', 'recruiter', '');
    add(item, 'a',    'detailUrl', 'debug', { href: 'https://example.com/debug' });
    container.appendChild(item);
    (document.body || document.documentElement).appendChild(container);
  }
  try {
    log.push('preXhr');
    var xhr = new XMLHttpRequest();
    try { xhr.open('GET', 'https://d-api.bezeq.co.il/api/Adam/GetActiveJobs', false); log.push('xhrOpened'); }
    catch (oe) { log.push('xhrOpenThrew:' + (oe && oe.message ? oe.message : String(oe))); finalize(); return; }
    try { xhr.setRequestHeader('Accept', 'application/json'); } catch (he) { log.push('setHeaderThrew:' + he.message); }
    try { xhr.send(); log.push('xhrSent'); }
    catch (se) { log.push('xhrSendThrew:' + (se && se.message ? se.message : String(se))); finalize(); return; }
    log.push('status=' + xhr.status);
    if (xhr.status !== 200) { log.push('nonOkStatus'); finalize(); return; }
    var rt = xhr.responseText || '';
    log.push('bodyLen=' + rt.length);
    var json;
    try { json = JSON.parse(rt); log.push('parsedOk'); }
    catch (pe) { log.push('parseThrew:' + pe.message); finalize(); return; }
    var arr = (json && json.data) ? json.data : [];
    log.push('itemsInPayload=' + arr.length);
    finalize();
  } catch (e) {
    log.push('outerCatch:' + (e && e.message ? e.message : String(e)));
    try { finalize(); } catch (_) {}
  }
})();
'@

$config = [ordered]@{
  listingSelector = $meta.listingSelector
  itemSelector    = $meta.itemSelector
  fieldMappings   = FieldMappingsToPSObject $site.fieldMappings
  pageFlow        = if ($site.pageFlow) { $site.pageFlow } else { @() }
  formCapture     = $meta.formCapture
  setupScript     = $diagSetup
}
if ($meta.revealSelector)   { $config.revealSelector   = $meta.revealSelector }
if ($meta.loadMoreSelector) { $config.loadMoreSelector = $meta.loadMoreSelector }
if ($meta.pagination)       { $config.pagination       = $meta.pagination }
if ($meta.browserOverrides) { $config.browserOverrides = $meta.browserOverrides }

$configJson = $config | ConvertTo-Json -Depth 30
$configJson = $configJson -replace '"pageFlow"\s*:\s*\{\s*\}', '"pageFlow":  []'
$abs = (Resolve-Path '.\sites\bezeq').Path + '\diag-config.json'
[System.IO.File]::WriteAllText($abs, $configJson, [System.Text.UTF8Encoding]::new($false))
Write-Host "    diag config written ($((Get-Item $abs).Length) bytes)"

Write-Host "==> PUT diag config..."
Invoke-RestMethod -Method Put -Uri "$BASE/api/sites/$SITE_ID/config" -Headers $HEADERS -ContentType 'application/json' -InFile $abs | Out-Null
Start-Sleep -Seconds 3
Invoke-RestMethod -Method Put -Uri "$BASE/api/sites/$SITE_ID/config" -Headers $HEADERS -ContentType 'application/json' -InFile $abs | Out-Null
Write-Host "    ok"

Write-Host "==> Triggering scrape..."
$run = Invoke-RestMethod -Method Post -Uri "$BASE/api/sites/$SITE_ID/scrape" -Headers $HEADERS
$RUN_ID = $run.data.id
Write-Host "    run id=$RUN_ID"

Write-Host "==> Polling..."
for ($i = 1; $i -le 48; $i++) {
  Start-Sleep -Seconds 5
  $j = Invoke-RestMethod -Method Get -Uri "$BASE/api/sites/$SITE_ID/scrape" -Headers $HEADERS
  Write-Host ("    tick {0,2} status={1} jobs={2}" -f $i, $j.data.status, $j.data.jobCount)
  if ($j.data.status -in @('COMPLETED','FAILED')) { break }
}

Write-Host ""
Write-Host "==> Reading extracted diagnostic job..."
$jobs = Invoke-RestMethod -Method Get -Uri "$BASE/api/jobs?siteId=$SITE_ID&pageSize=5" -Headers $HEADERS
if (-not $jobs.data -or $jobs.data.Count -eq 0) {
  Write-Warning "NO JOBS EXTRACTED. The setupScript never produced a .haide-job element."
  Write-Warning "This means the worker pre-extracts before setupScript runs OR cannot reach our injected container (sandbox/iframe/CSP)."
  exit 2
}
foreach ($jb in $jobs.data) {
  Write-Host ""
  Write-Host "  externalJobId : $($jb.externalJobId)"
  Write-Host "  title         : $($jb.title)"
  Write-Host "  description   : $($jb.description)"
  Write-Host "  location      : $($jb.location)"
  Write-Host "  department    : $($jb.department)"
  Write-Host "  publishDate   : $($jb.publishDate)"
}
