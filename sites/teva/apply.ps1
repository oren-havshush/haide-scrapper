$ErrorActionPreference = 'Stop'
$TOKEN = (Get-Content .\.claude\scrap-token -Raw).Trim()
$H = @{ Authorization = "Bearer $TOKEN" }
$BASE = 'https://scrapper.haide-jobs.co.il'
$SITE_ID = 'cmpmffi0i001d01mvbx6o3gpv'

function Get-Teva {
  $list = Invoke-RestMethod -Method Get -Uri "$BASE/api/sites?search=teva" -Headers $H -TimeoutSec 25
  return ($list.data | Where-Object { $_.id -eq $SITE_ID })
}

# 1. Capture the CURRENT (human-validated) config BEFORE re-analysis overwrites it.
$cfgResp = Invoke-RestMethod -Method Get -Uri "$BASE/api/sites/$SITE_ID/config" -Headers $H -TimeoutSec 25
$fm = $cfgResp.data.fieldMappings
$meta = $fm._meta
$pageFlow = $cfgResp.data.pageFlow

# Strip _meta from fieldMappings (server rebuilds it from top-level fields).
$fields = @{}
foreach ($p in $fm.PSObject.Properties) { if ($p.Name -ne '_meta') { $fields[$p.Name] = $p.Value } }

# Build the PUT body: preserve everything, ADD url pagination on startrow.
$body = @{
  itemSelector    = $meta.itemSelector
  listingSelector = $meta.listingSelector
  revealSelector  = $meta.revealSelector
  fieldMappings   = $fields
  pageFlow        = $pageFlow
  formCapture     = $meta.formCapture
  originalMappings= $meta.originalMappings
  setupScript     = $meta.setupScript
  loadMoreSelector= $meta.loadMoreSelector
  browserOverrides= $meta.browserOverrides
  pagination      = @{ type = 'url'; param = 'startrow'; start = 0; step = 25; maxPages = 3 }
}
# Drop null OPTIONAL keys; but formCapture is required-nullable so keep it.
$clean = @{}
foreach ($k in $body.Keys) { if ($null -ne $body[$k]) { $clean[$k] = $body[$k] } }
$clean['formCapture'] = $body['formCapture']   # may be $null -> serialized as null
$json = $clean | ConvertTo-Json -Depth 30
$json | Out-File .\sites\teva\put-body.json -Encoding utf8
Write-Host "captured config: itemSelector=$($meta.itemSelector) fields=$($fields.Keys.Count) pageFlowSteps=$($pageFlow.Count)"

# 2. SKIPPED -> ANALYZING (only exit from SKIPPED); analyzer rewrites config, so wait it out.
$cur = (Get-Teva).status
Write-Host "current status=$cur"
if ($cur -eq 'SKIPPED') {
  Invoke-RestMethod -Method Patch -Uri "$BASE/api/sites/$SITE_ID" -Headers $H -ContentType 'application/json' -Body (@{status='ANALYZING'}|ConvertTo-Json -Compress) -TimeoutSec 25 | Out-Null
  Write-Host "-> ANALYZING"
}
for ($i=0; $i -lt 40; $i++) {
  Start-Sleep -Seconds 6
  $s = (Get-Teva).status
  Write-Host "  [$i] status=$s"
  if ($s -ne 'ANALYZING') { break }
}

# 3. PUT our preserved config (+pagination). REVIEW/FAILED both scrapeable.
try {
  $put = Invoke-RestMethod -Method Put -Uri "$BASE/api/sites/$SITE_ID/config" -Headers $H -ContentType 'application/json' -Body $json -TimeoutSec 30
  Write-Host "PUT -> status=$($put.data.status)"
} catch {
  $resp = $_.Exception.Response
  if ($resp) { $sr = New-Object System.IO.StreamReader($resp.GetResponseStream()); Write-Host "PUT ERRBODY: $($sr.ReadToEnd())" }
  throw
}

# 4. Verify
$v = Get-Teva
$m = $v.fieldMappings._meta
Write-Host "VERIFY itemSelector=$($m.itemSelector) pagination.type=$($m.pagination.type) param=$($m.pagination.param) step=$($m.pagination.step) maxPages=$($m.pagination.maxPages) pageFlow=$($v.pageFlow.Count) status=$($v.status)"
