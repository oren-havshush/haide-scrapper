#!/usr/bin/env bash
set -e
TOKEN=$(cat /Users/oren/code/Private/scrapnew/.claude/scrap-token | tr -d '[:space:]')
BASE="https://scrapper.haide-jobs.co.il"
curl -sS "$BASE/api/sites" -H "Authorization: Bearer $TOKEN" > /tmp/audit-sites.json
python3 - <<'PY'
import json
sites=json.load(open('/tmp/audit-sites.json'))['data']
sites.sort(key=lambda s: s['siteUrl'])
print(f'Total sites: {len(sites)}\n')
for s in sites:
    latest = s.get('latestScrapeRun') or {}
    print(f"{s['id']}  {s['status']:<9} jobs={str(latest.get('jobCount')):<5}  {s['siteUrl']}")
PY
