import json, os, sys, urllib.request

TOKEN = open('/Users/oren/code/Private/scrapnew/.claude/scrap-token').read().strip()
BASE = 'https://scrapper.haide-jobs.co.il'

def api(path):
    req = urllib.request.Request(f'{BASE}{path}', headers={'Authorization': f'Bearer {TOKEN}'})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

# Get all sites
sites = api('/api/sites')['data']
sites.sort(key=lambda s: s['siteUrl'])

print(f'Total sites: {len(sites)}\n')
print(f'{"id":<28} {"status":<10} {"jobs":<6} {"siteUrl"}')
print('-' * 110)

audit = []
for s in sites:
    sid = s['id']
    url = s['siteUrl']
    status = s['status']
    latest = s.get('latestScrapeRun') or {}
    jc = latest.get('jobCount')
    audit.append({'id': sid, 'siteUrl': url, 'status': status, 'jobCount': jc})
    print(f'{sid:<28} {status:<10} {str(jc):<6} {url}')

# Save
with open('/tmp/audit-sites.json', 'w') as f:
    json.dump(audit, f, ensure_ascii=False)
