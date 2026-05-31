$ErrorActionPreference = 'Stop'
$TOKEN = (Get-Content .\.claude\scrap-token -Raw).Trim()
$H = @{ Authorization = "Bearer $TOKEN" }
$BASE = 'https://scrapper.haide-jobs.co.il'
$SITE_ID = 'cmpmffi0i001d01mvbx6o3gpv'

function Get-Teva {
  $list = Invoke-RestMethod -Method Get -Uri "$BASE/api/sites?search=teva" -Headers $H -TimeoutSec 25
  return ($list.data | Where-Object { $_.id -eq $SITE_ID })
}

# PUT clean config
$cfg = Get-Content .\sites\teva\config.json -Raw
try {
  $put = Invoke-RestMethod -Method Put -Uri "$BASE/api/sites/$SITE_ID/config" -Headers $H -ContentType 'application/json' -Body $cfg -TimeoutSec 30
  Write-Host "PUT -> status=$($put.data.status)"
} catch {
  $resp=$_.Exception.Response; if($resp){$sr=New-Object System.IO.StreamReader($resp.GetResponseStream());Write-Host "PUT ERR: $($sr.ReadToEnd())"}; throw
}
$v = Get-Teva; $m = $v.fieldMappings._meta
Write-Host "VERIFY itemSelector=$($m.itemSelector) fields=$(($v.fieldMappings.PSObject.Properties|?{$_.Name -ne '_meta'}).Count) pagination=$($m.pagination.param)/$($m.pagination.step) pageFlow=$($v.pageFlow.Count) status=$($v.status)"

# Trigger scrape
$run = Invoke-RestMethod -Method Post -Uri "$BASE/api/sites/$SITE_ID/scrape" -Headers $H -ContentType 'application/json' -Body '{}' -TimeoutSec 30
Write-Host "scrape run=$($run.data.id) status=$($run.data.status)"

$final = $null
for ($i=0; $i -lt 75; $i++) {
  Start-Sleep -Seconds 8
  $lr = (Get-Teva).latestScrapeRun
  Write-Host "  [$i] $($lr.status) jobCount=$($lr.jobCount)"
  if ($lr.status -eq 'COMPLETED' -or $lr.status -eq 'FAILED') { $final=$lr; break }
}
Write-Host "FINAL $($final.status) jobCount=$($final.jobCount)"

$jobs = Invoke-RestMethod -Method Get -Uri "$BASE/api/jobs?siteId=$SITE_ID&pageSize=100" -Headers $H -TimeoutSec 30
$descs = $jobs.data | ForEach-Object { $_.description } | Where-Object { $_ }
Write-Host "jobs=$($jobs.data.Count) meta.total=$($jobs.meta.total) withDesc(>30)=$(($jobs.data|?{$_.description -and $_.description.Trim().Length -gt 30}).Count) distinctDesc=$(($descs|Select-Object -Unique).Count)"
Write-Host "--- sample first 5 ---"
$jobs.data | Select-Object -First 5 | ForEach-Object {
  $dl = if($_.description){$_.description.Trim().Length}else{0}
  Write-Host ("  id={0} loc={1} dept={2} descLen={3}" -f $_.externalJobId, $_.location, $_.department, $dl)
}