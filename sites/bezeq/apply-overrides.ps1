# Phase 2 runner: PUT bezeq's existing config (with browserOverrides
# added), PATCH ACTIVE, trigger scrape, poll until complete.
#
# Prerequisites:
#   - .\.claude\scrap-token populated with the prod scrapper API token
#   - The web + worker have been redeployed with the browserOverrides
#     plumbing (otherwise the new field is silently dropped by the
#     validator and the worker still hits ERR_CONNECTION_RESET).

$ErrorActionPreference = 'Stop'

$SITE_ID = 'cmpmv882i001x01mvhf9qfaqy'
$URL     = 'https://www.bezeq.co.il/career_new/'
$BASE    = 'https://scrapper.haide-jobs.co.il'

$tokenPath = '.\.claude\scrap-token'
if (-not (Test-Path $tokenPath)) {
  throw "Missing $tokenPath - paste the prod API token into that file."
}
$TOKEN = ((Get-Content $tokenPath -Raw) -replace '\s','')
$HEADERS = @{ Authorization = "Bearer $TOKEN" }

Write-Host "==> Fetching existing bezeq config..."
$existing = Invoke-RestMethod -Method Get -Uri "$BASE/api/sites?siteUrl=$([uri]::EscapeDataString($URL))" -Headers $HEADERS
if (-not $existing.data -or $existing.data.Count -eq 0) {
  throw "No bezeq site found at $URL"
}
$site = $existing.data[0]
$meta = $site.fieldMappings._meta
if (-not $meta) {
  throw "Site has no _meta block - cannot rebuild config"
}

# Rebuild the SaveConfigPayload from the stored shape. We add browserOverrides.
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

$config = [ordered]@{
  listingSelector = $meta.listingSelector
  itemSelector    = $meta.itemSelector
  fieldMappings   = FieldMappingsToPSObject $site.fieldMappings
  pageFlow        = if ($site.pageFlow) { $site.pageFlow } else { @() }
  formCapture     = $meta.formCapture
}
if ($meta.revealSelector)   { $config.revealSelector   = $meta.revealSelector }
if ($meta.setupScript)      { $config.setupScript      = $meta.setupScript }
if ($meta.loadMoreSelector) { $config.loadMoreSelector = $meta.loadMoreSelector }
if ($meta.pagination)       { $config.pagination       = $meta.pagination }

# Per-site browser overrides that unblock bezeq:
#   - userAgent + Hebrew accept-language: needed for the page itself
#     (bare Playwright UA gets a TCP reset from the WAF on www.bezeq.co.il).
#   - bypassCSP: the page's Content-Security-Policy `connect-src` does NOT
#     allowlist `d-api.bezeq.co.il`, which is where the setupScript's XHR
#     for the active-jobs list goes. Without this flag Chromium aborts the
#     XHR before it leaves the network stack and the scrape COMPLETEs with
#     jobs=0. See addsite.md Step 6 "bypassCSP" subsection.
$config.browserOverrides = [ordered]@{
  userAgent    = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  extraHeaders = [ordered]@{
    'accept-language' = 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7'
  }
  bypassCSP    = $true
}

$configPath = '.\sites\bezeq\config.json'
$configJson = $config | ConvertTo-Json -Depth 30
# PowerShell 5.1's ConvertTo-Json serializes empty arrays wrapped inside an
# [ordered] hashtable as "{}", which trips the API validator (it expects an
# array). Fix pageFlow specifically — it's the only field here that can be
# legitimately empty and must remain a JSON array.
$configJson = $configJson -replace '"pageFlow"\s*:\s*\{\s*\}', '"pageFlow":  []'
$abs = (Resolve-Path '.\sites\bezeq').Path + '\config.json'
[System.IO.File]::WriteAllText($abs, $configJson, [System.Text.UTF8Encoding]::new($false))
Write-Host "    config written to $configPath ($((Get-Item $configPath).Length) bytes)"

Write-Host "==> PUT config (first pass)..."
Invoke-RestMethod -Method Put -Uri "$BASE/api/sites/$SITE_ID/config" -Headers $HEADERS -ContentType 'application/json' -InFile $configPath | Out-Null
Write-Host "    ok"

Start-Sleep -Seconds 5

Write-Host "==> PUT config (second pass, races auto-analyzer)..."
Invoke-RestMethod -Method Put -Uri "$BASE/api/sites/$SITE_ID/config" -Headers $HEADERS -ContentType 'application/json' -InFile $configPath | Out-Null
Write-Host "    ok"

Write-Host "==> Verifying browserOverrides was persisted..."
$verify = Invoke-RestMethod -Method Get -Uri "$BASE/api/sites?siteUrl=$([uri]::EscapeDataString($URL))" -Headers $HEADERS
$persistedBO = $verify.data[0].fieldMappings._meta.browserOverrides
if (-not $persistedBO -or -not $persistedBO.userAgent) {
  Write-Warning "browserOverrides was NOT persisted. Either the web service was not redeployed with the validator change, or the PUT was dropped. Check the deploy and re-run."
  exit 1
}
Write-Host "    browserOverrides present: userAgent='$($persistedBO.userAgent.Substring(0,60))...' headers=$($persistedBO.extraHeaders.PSObject.Properties.Name -join ',')"

Write-Host "==> PATCH to ACTIVE..."
$patch = @{ status = 'ACTIVE' } | ConvertTo-Json -Compress
$patchResp = Invoke-RestMethod -Method Patch -Uri "$BASE/api/sites/$SITE_ID" -Headers $HEADERS -ContentType 'application/json' -Body $patch
Write-Host "    status=$($patchResp.data.status)"

Write-Host "==> Triggering scrape..."
$run = Invoke-RestMethod -Method Post -Uri "$BASE/api/sites/$SITE_ID/scrape" -Headers $HEADERS
$RUN_ID = $run.data.id
Write-Host "    run id=$RUN_ID"

Write-Host "==> Polling..."
for ($i = 1; $i -le 36; $i++) {
  Start-Sleep -Seconds 5
  $j = Invoke-RestMethod -Method Get -Uri "$BASE/api/sites/$SITE_ID/scrape" -Headers $HEADERS
  $S = $j.data.status
  $C = $j.data.jobCount
  Write-Host ("    tick {0,2} status={1} jobs={2}" -f $i, $S, $C)
  if ($S -eq 'COMPLETED') { break }
  if ($S -eq 'FAILED')    { break }
}

if ($j.data.status -ne 'COMPLETED') {
  Write-Warning "Scrape did not complete. status=$($j.data.status) jobs=$($j.data.jobCount)"
  Write-Warning "If status=FAILED in <10s with no jobs, the worker likely still TCP-resets - either the worker was not redeployed OR the block is also geo/IP-based (Phase 3)."
  exit 1
}

Write-Host ""
Write-Host "==> Sampling 3 jobs..."
$jobs = Invoke-RestMethod -Method Get -Uri "$BASE/api/jobs?siteId=$SITE_ID&pageSize=3" -Headers $HEADERS
foreach ($jb in $jobs.data) {
  $desc = if ($jb.description) { $jb.description.Substring(0, [Math]::Min(60, $jb.description.Length)) } else { '' }
  $id = if ($jb.externalJobId) { $jb.externalJobId } else { '(no id)' }
  Write-Host "    - $id | $($jb.title) | $desc"
}

Write-Host ""
Write-Host "==> Done. siteId=$SITE_ID status=$($j.data.status) jobs=$($j.data.jobCount)"
Write-Host "==> Dashboard: $BASE/sites/$SITE_ID"
