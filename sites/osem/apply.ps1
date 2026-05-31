$ErrorActionPreference = 'Stop'
$TOKEN = (Get-Content .\.claude\scrap-token -Raw).Trim()
$H = @{ Authorization = "Bearer $TOKEN" }
$BASE = 'https://scrapper.haide-jobs.co.il'
$SITE_ID = 'cmpo335in002p01mvesps38uj'

function Get-Osem {
  $list = Invoke-RestMethod -Method Get -Uri "$BASE/api/sites?search=osem" -Headers $H -TimeoutSec 25
  return ($list.data | Where-Object { $_.id -eq $SITE_ID })
}

$cur = Get-Osem
Write-Host "current status=$($cur.status)"

# 1. SKIPPED -> ANALYZING (only allowed transition out of SKIPPED). This enqueues
#    an ANALYSIS worker job that will rewrite fieldMappings; we wait it out, then
#    overwrite with our config.
if ($cur.status -eq 'SKIPPED') {
  $b = @{ status = 'ANALYZING' } | ConvertTo-Json -Compress
  Invoke-RestMethod -Method Patch -Uri "$BASE/api/sites/$SITE_ID" -Headers $H -ContentType 'application/json' -Body $b -TimeoutSec 25 | Out-Null
  Write-Host "-> ANALYZING (analysis job enqueued)"
}

# 2. Wait for analyzer to finish (status leaves ANALYZING -> REVIEW/FAILED/ACTIVE).
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Seconds 6
  $s = (Get-Osem).status
  Write-Host "  [$i] status=$s"
  if ($s -ne 'ANALYZING') { break }
}
$postAnalyze = (Get-Osem).status
Write-Host "post-analyze status=$postAnalyze"

# 3. PUT our config. On REVIEW/FAILED/SKIPPED this saves config without changing
#    status; all of REVIEW/FAILED are scrapeable.
$cfg = Get-Content .\sites\osem\config.json -Raw
$put = Invoke-RestMethod -Method Put -Uri "$BASE/api/sites/$SITE_ID/config" -Headers $H -ContentType 'application/json' -Body $cfg -TimeoutSec 30
Write-Host "PUT config -> status=$($put.data.status)"

# 4. Verify stored config is ours.
$v = Get-Osem
$meta = $v.fieldMappings._meta
Write-Host "VERIFY: itemSelector=$($meta.itemSelector)  pagination.type=$($meta.pagination.type)  pagination.param=$($meta.pagination.param)  maxPages=$($meta.pagination.maxPages)"
Write-Host "VERIFY: pageFlow steps=$($v.pageFlow.Count)  desc.selector=$($v.fieldMappings.description.selector)"
Write-Host "VERIFY: overrides.sec-fetch-site present=$([bool]$meta.browserOverrides.extraHeaders.'sec-fetch-site')  referer present=$([bool]$meta.browserOverrides.extraHeaders.referer)"
Write-Host "DONE status=$($v.status)"
