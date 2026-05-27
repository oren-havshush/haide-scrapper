#!/usr/bin/env bash
set -e
TOKEN=$(cat /Users/oren/code/Private/scrapnew/.claude/scrap-token | tr -d '[:space:]')
BASE="https://scrapper.haide-jobs.co.il"

# Read sites
python3 - "$TOKEN" "$BASE" <<'PY'
import json, sys, urllib.request, ssl
TOKEN=sys.argv[1]; BASE=sys.argv[2]
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
def api(path):
    req = urllib.request.Request(f'{BASE}{path}', headers={'Authorization': f'Bearer {TOKEN}'})
    with urllib.request.urlopen(req, context=ctx) as r:
        return json.loads(r.read())

sites = api('/api/sites')['data']
sites.sort(key=lambda s: s['siteUrl'])

# Common useful fields
CORE = ['title', 'externalJobId', 'description', 'location', 'requirements', 'employmentType', 'applicationInfo', 'detailUrl', 'publishDate', 'department', 'company']

print(f'{"site":<35} {"jobs":<5} {"completeness summary"}')
print('-' * 130)

report = []
for s in sites:
    sid = s['id']
    url = s['siteUrl']
    short = url.replace('https://','').replace('www.','').split('/')[0][:32]
    latest = s.get('latestScrapeRun') or {}
    jc = latest.get('jobCount') or 0
    # Fetch 3 jobs
    jobs = api(f'/api/jobs?siteId={sid}&pageSize=3')['data']
    if not jobs:
        print(f'{short:<35} {jc!s:<5}  NO JOBS')
        report.append({'id': sid, 'url': url, 'jobCount': jc, 'fieldCounts': {}, 'sampleJobs': []})
        continue
    # For each job, check which fields are non-empty
    field_counts = {}
    samples = []
    for j in jobs:
        raw = j.get('rawData') or {}
        merged = {**raw, **{k:v for k,v in j.items() if v}}
        s_sample = {}
        for f in CORE:
            v = merged.get(f) or j.get(f) or raw.get(f)
            if v and isinstance(v, str) and v.strip():
                field_counts[f] = field_counts.get(f, 0) + 1
                s_sample[f] = v[:70]
        samples.append(s_sample)
    # Compute average length of description
    desc_lens = []
    req_lens = []
    for j in jobs:
        raw = j.get('rawData') or {}
        d = j.get('description') or raw.get('description') or ''
        r = raw.get('requirements') or ''
        if d: desc_lens.append(len(d))
        if r: req_lens.append(len(r))
    avg_desc = round(sum(desc_lens)/len(desc_lens),0) if desc_lens else 0
    avg_req = round(sum(req_lens)/len(req_lens),0) if req_lens else 0
    summary = ', '.join(f'{f}={c}' for f,c in field_counts.items())
    print(f'{short:<35} {jc!s:<5}  {summary}')
    print(f'{"":>40} avg description: {avg_desc} chars, avg requirements: {avg_req} chars')
    report.append({
        'id': sid, 'url': url, 'jobCount': jc,
        'fieldCounts': field_counts,
        'avgDescLen': avg_desc, 'avgReqLen': avg_req,
        'sampleJobs': samples,
    })

with open('/tmp/audit-report.json','w') as f:
    json.dump(report, f, ensure_ascii=False, indent=2)
print('\n\nWritten /tmp/audit-report.json')
PY
