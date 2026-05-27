#!/usr/bin/env bash
# Put preserved config back, trigger scrape, verify. Assumes site is ACTIVE.
# Usage: ./.fix-config.sh <SITE_ID>
set -e
SID="$1"
[ -z "$SID" ] && { echo "usage: $0 <site_id>"; exit 2; }
TOKEN=$(cat /Users/oren/code/Private/scrapnew/.claude/scrap-token | tr -d '[:space:]')
BASE="https://scrapper.haide-jobs.co.il"
CFG="/tmp/skip-audit/$SID.config.json"
[ -f "$CFG" ] || { echo "missing $CFG"; exit 3; }

python3 -c "
import json, os
d=json.load(open('$CFG'))['data']
fm=d.get('fieldMappings') or {}
meta=fm.get('_meta') if isinstance(fm,dict) else None
meta=meta or {}
out={'fieldMappings': {k:v for k,v in fm.items() if k!='_meta'}, 'pageFlow': d.get('pageFlow') or [], 'formCapture': meta.get('formCapture') or None}
if meta.get('itemSelector'): out['itemSelector']=meta['itemSelector']
if meta.get('listingSelector'): out['listingSelector']=meta['listingSelector']
if meta.get('setupScript'): out['setupScript']=meta['setupScript']
if meta.get('pagination'): out['pagination']=meta['pagination']
if meta.get('revealSelector'): out['revealSelector']=meta['revealSelector']
json.dump(out, open('/tmp/skip-audit/$SID.put.json','w'))
print('itemSelector:', out.get('itemSelector'))
print('fieldCount:', len(out['fieldMappings']))
print('setupScript:', bool(out.get('setupScript')))
print('pageFlow:', len(out['pageFlow']))
"

echo "[PUT 1]"
curl -sS -X PUT "$BASE/api/sites/$SID/config" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data-binary @/tmp/skip-audit/$SID.put.json
echo
sleep 5
echo "[PUT 2]"
curl -sS -X PUT "$BASE/api/sites/$SID/config" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data-binary @/tmp/skip-audit/$SID.put.json
echo

echo "[trigger scrape]"
RUN_ID=$(curl -sS -X POST "$BASE/api/sites/$SID/scrape" -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('id') or d.get('error'))")
echo "  runId: $RUN_ID"

S="?"; C="?"
for i in $(seq 1 30); do
  sleep 5
  J=$(curl -sS "$BASE/api/sites/$SID/scrape" -H "Authorization: Bearer $TOKEN")
  S=$(echo "$J" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('status') or '?')" 2>/dev/null || echo "?")
  C=$(echo "$J" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('jobCount') or 0)" 2>/dev/null || echo 0)
  echo "  tick $i status=$S jobs=$C"
  [ "$S" = "COMPLETED" ] && break
  [ "$S" = "FAILED" ] && break
done

echo "[sample]"
curl -sS "$BASE/api/jobs?siteId=$SID&pageSize=3" -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
for j in d.get('data') or []:
    raw=j.get('rawData') or {}
    desc=(raw.get('description') or j.get('description') or '')[:60].replace(chr(10),' ')
    print(f'  - {(j.get(\"externalJobId\") or \"-\")[:20]:20}  {(j.get(\"title\") or \"\")[:40]:<40}  {desc}')
"
echo "RESULT: $SID status=$S jobs=$C"
