#!/usr/bin/env bash
set -e
TOKEN=$(cat /Users/oren/code/Private/scrapnew/.claude/scrap-token | tr -d '[:space:]')
BASE="https://scrapper.haide-jobs.co.il"

# Get all site ids
SITES_JSON=$(curl -sS "$BASE/api/sites" -H "Authorization: Bearer $TOKEN")
IDS=$(echo "$SITES_JSON" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print('\n'.join(s['id'] for s in d))")

echo "[]" > /tmp/audit-report.json
for SID in $IDS; do
  JOBS=$(curl -sS "$BASE/api/jobs?siteId=$SID&pageSize=3" -H "Authorization: Bearer $TOKEN")
  echo "$SITES_JSON" "$JOBS" | python3 -c "
import sys,json
parts=sys.stdin.read().split('\n')
# Trick: read both inputs together is messy, just do per-site
" >/dev/null
  # Save jobs to a file
  echo "$JOBS" > "/tmp/audit-jobs-$SID.json"
done

# Now combine and analyze
python3 - "$BASE" <<'PY'
import json, glob, sys
sites = json.load(open('/tmp/audit-sites.json'))['data']
sites.sort(key=lambda s: s['siteUrl'])

CORE = ['title', 'externalJobId', 'description', 'location', 'requirements', 'employmentType', 'applicationInfo', 'detailUrl', 'publishDate', 'department', 'company']

report = []
print(f'{"site":<38} {"status":<8} {"jobs":<5} {"fields populated (of 3 samples)"}')
print('-'*130)
for s in sites:
    sid = s['id']
    url = s['siteUrl']
    short = url.replace('https://','').replace('www.','').split('/')[0][:36]
    status = s['status']
    latest = s.get('latestScrapeRun') or {}
    jc = latest.get('jobCount') or 0
    try:
        jobs = json.load(open(f'/tmp/audit-jobs-{sid}.json'))['data']
    except Exception:
        jobs = []
    if not jobs:
        print(f'{short:<38} {status:<8} {jc!s:<5}  (no jobs in DB)')
        report.append({'id': sid, 'url': url, 'status': status, 'jobCount': jc, 'fieldCounts': {}, 'avgDescLen': 0, 'avgReqLen': 0})
        continue
    fc = {}
    descs, reqs = [], []
    for j in jobs:
        raw = j.get('rawData') or {}
        for f in CORE:
            v = j.get(f) or raw.get(f)
            if v and isinstance(v, str) and v.strip():
                fc[f] = fc.get(f, 0) + 1
        d = (j.get('description') or raw.get('description') or '').strip()
        r = (raw.get('requirements') or '').strip()
        if d: descs.append(len(d))
        if r: reqs.append(len(r))
    avg_d = round(sum(descs)/len(descs)) if descs else 0
    avg_r = round(sum(reqs)/len(reqs)) if reqs else 0
    summary = ' '.join(f'{f}={c}' for f,c in fc.items() if c > 0)
    print(f'{short:<38} {status:<8} {jc!s:<5}  {summary}')
    print(f'{"":<38} {"":<8} {"":<5}  desc_avg={avg_d}  req_avg={avg_r}')
    report.append({
        'id': sid, 'url': url, 'status': status, 'jobCount': jc,
        'fieldCounts': fc, 'avgDescLen': avg_d, 'avgReqLen': avg_r,
    })

with open('/tmp/audit-report.json','w') as f:
    json.dump(report, f, ensure_ascii=False, indent=2)
PY
