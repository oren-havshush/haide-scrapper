#!/usr/bin/env bash
# Usage: .onboard.sh <SITE_ID>
set -e
TOKEN=$(cat /Users/oren/code/Private/scrapnew/.claude/scrap-token | tr -d '[:space:]')
SITE_ID="$1"
BASE="https://scrapper.haide-jobs.co.il"

# Get current status
CUR_STATUS=$(curl -sS "$BASE/api/sites" -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import sys,json
sites=json.load(sys.stdin)['data']
for s in sites:
  if s['id']=='$SITE_ID': print(s['status']); break
else: print('UNKNOWN')
")
echo "current status: $CUR_STATUS"

if [ "$CUR_STATUS" = "SKIPPED" ]; then
  echo ">>> SKIPPED -> ANALYZING"
  curl -sS -X PATCH "$BASE/api/sites/$SITE_ID" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"status":"ANALYZING"}' | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print('status:',d.get('status'))"
  echo ">>> waiting for analyzer to finish (so our PUT isn't overwritten)..."
  for i in $(seq 1 30); do
    sleep 5
    S=$(curl -sS "$BASE/api/sites" -H "Authorization: Bearer $TOKEN" \
      | python3 -c "
import sys,json
sites=json.load(sys.stdin)['data']
for s in sites:
  if s['id']=='$SITE_ID': print(s['status']); break
else: print('UNKNOWN')
")
    echo "analyzer tick $i status=$S"
    if [ "$S" != "ANALYZING" ]; then break; fi
  done
fi

echo ">>> PUT 1"
curl -sS -X PUT "$BASE/api/sites/$SITE_ID/config" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data-binary @/tmp/scrap-config.json | python3 -c "import sys,json;print(json.load(sys.stdin))"
sleep 5
echo ">>> PUT 2"
curl -sS -X PUT "$BASE/api/sites/$SITE_ID/config" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data-binary @/tmp/scrap-config.json | python3 -c "import sys,json;print(json.load(sys.stdin))"
echo ">>> PATCH ACTIVE"
curl -sS -X PATCH "$BASE/api/sites/$SITE_ID" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"ACTIVE"}' | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print('status:',d.get('status'))"
echo ">>> SCRAPE"
RUN=$(curl -sS -X POST "$BASE/api/sites/$SITE_ID/scrape" -H "Authorization: Bearer $TOKEN")
echo "$RUN" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print('runId:',d['id'])"
for i in $(seq 1 24); do
  sleep 5
  J=$(curl -sS "$BASE/api/sites/$SITE_ID/scrape" -H "Authorization: Bearer $TOKEN")
  S=$(echo "$J" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['status'])")
  C=$(echo "$J" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['jobCount'])")
  echo "tick $i status=$S jobs=$C"
  [ "$S" = "COMPLETED" ] && break
  [ "$S" = "FAILED" ] && break
done
echo ">>> SAMPLE"
curl -sS "$BASE/api/jobs?siteId=$SITE_ID&pageSize=3" -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
for j in d['data']:
    raw=j.get('rawData') or {}
    desc=(raw.get('description') or j.get('description') or '')[:60].replace(chr(10),' ')
    print(f'  - {j.get(\"externalJobId\") or \"(no id)\"} | {j.get(\"title\")} | {desc}')
"
