$ErrorActionPreference = 'Stop'
$TOKEN = (Get-Content .\.claude\scrap-token -Raw).Trim()
$H = @{ Authorization = "Bearer $TOKEN" }
$BASE = 'https://scrapper.haide-jobs.co.il'
$SITE_ID = 'cmpo335in002p01mvesps38uj'

# Trigger scrape
$run = Invoke-RestMethod -Method Post -Uri "$BASE/api/sites/$SITE_ID/scrape" -Headers $H -ContentType 'application/json' -Body '{}' -TimeoutSec 30
$runId = $run.data.id
Write-Host "scrape run id=$runId status=$($run.data.status)"

# Poll the run to completion
$final = $null
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 8
  $list = Invoke-RestMethod -Method Get -Uri "$BASE/api/sites?search=osem" -Headers $H -TimeoutSec 25
  $osem = $list.data | Where-Object { $_.id -eq $SITE_ID }
  $lr = $osem.latestScrapeRun
  Write-Host "  [$i] run.status=$($lr.status) jobCount=$($lr.jobCount)"
  if ($lr.status -eq 'COMPLETED' -or $lr.status -eq 'FAILED') { $final = $lr; break }
}
Write-Host "FINAL run.status=$($final.status) jobCount=$($final.jobCount)"

# Sample jobs from the latest run
$jobs = Invoke-RestMethod -Method Get -Uri "$BASE/api/jobs?siteId=$SITE_ID&pageSize=100" -Headers $H -TimeoutSec 30
Write-Host "total jobs returned=$($jobs.data.Count)  (meta.total=$($jobs.meta.total))"
$withDesc = ($jobs.data | Where-Object { $_.description -and $_.description.Trim().Length -gt 30 }).Count
Write-Host "jobs with description(>30 chars)=$withDesc"
Write-Host "--- sample (first 5) ---"
$jobs.data | Select-Object -First 5 | ForEach-Object {
  $d = if ($_.description) { $_.description.Trim() } else { '' }
  $dl = $d.Length
  $dprev = if ($dl -gt 80) { $d.Substring(0,80) } else { $d }
  Write-Host ("  title={0} | loc={1} | id={2} | descLen={3} | desc='{4}'" -f $_.title, $_.location, $_.externalJobId, $dl, $dprev)
}
