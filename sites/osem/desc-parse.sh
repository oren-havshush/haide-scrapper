UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
hdr=(-sS --max-time 25 -H "User-Agent: $UA"
  -H 'sec-ch-ua: "Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"'
  -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"'
  -H 'sec-fetch-dest: document' -H 'sec-fetch-mode: navigate'
  -H 'sec-fetch-site: none' -H 'sec-fetch-user: ?1'
  -H 'upgrade-insecure-requests: 1'
  -H 'accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  -H 'accept-language: he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7')

for ID in 400609 400607; do
  curl "${hdr[@]}" -o /tmp/$ID.html "https://www.osem-nestle.co.il/career/open-positions/$ID"
done

python3 - <<'PY'
from html.parser import HTMLParser
import re

class ClassText(HTMLParser):
    # Aggregate visible text per class token.
    def __init__(self):
        super().__init__(); self.depth=0; self.open=[]  # (depth, classtokens)
        self.agg={}
    def handle_starttag(self, tag, attrs):
        self.depth+=1
        cls=dict(attrs).get('class','') or ''
        toks=[t for t in cls.split() if t]
        self.open.append((self.depth, toks))
    def handle_startendtag(self, tag, attrs): pass
    def handle_endtag(self, tag):
        self.open=[(d,t) for (d,t) in self.open if d<self.depth]
        self.depth-=1
    def handle_data(self, data):
        t=data.strip()
        if not t: return
        seen=set()
        for (d,toks) in self.open:
            for tok in toks:
                if tok in seen: continue
                seen.add(tok)
                self.agg.setdefault(tok,[]).append(t)

agg={}
for ID in ('400609','400607'):
    html=open(f'/tmp/{ID}.html',encoding='utf-8',errors='replace').read()
    c=ClassText(); c.feed(html)
    agg[ID]={k:' '.join(v) for k,v in c.agg.items()}

a,b=agg['400609'],agg['400607']
common=set(a)&set(b)
diffs=[]
for k in common:
    if a[k]!=b[k] and min(len(a[k]),len(b[k]))>=120:
        diffs.append((k,len(a[k]),len(b[k])))
diffs.sort(key=lambda x:min(x[1],x[2]))
print("=== classes whose text DIFFERS between the two jobs (len>=120), smallest first ===")
for k,la,lb in diffs[:25]:
    print(f"  .{k:42} len609={la:6} len607={lb:6}")
# Show the smallest differing block's text (likely the tightest description wrapper)
if diffs:
    k=diffs[0][0]
    print(f"\n=== tightest differing class: .{k}")
    print("  609 head:", a[k][:160])
    print("  607 head:", b[k][:160])
PY
exit 0
python3 - <<'PY2'
from html.parser import HTMLParser

class Blocks(HTMLParser):
    # Capture innerText of every element whose class contains `needle`,
    # tracking nesting so each matched element gets its own bucket.
    def __init__(self, needle):
        super().__init__(); self.needle=needle; self.depth=0
        self.open=[]   # (start_depth, idx)
        self.buckets=[]  # list of text-lists
    def handle_starttag(self, tag, attrs):
        self.depth+=1
        cls=dict(attrs).get('class','') or ''
        if self.needle in cls.split():
            self.buckets.append([]); self.open.append((self.depth, len(self.buckets)-1))
    def handle_endtag(self, tag):
        self.open=[(d,i) for (d,i) in self.open if d<self.depth]
        self.depth-=1
    def handle_data(self, data):
        t=data.strip()
        if not t: return
        for (d,i) in self.open: self.buckets[i].append(t)

texts={}
for ID in ('400609','400607'):
    html=open(f'/tmp/{ID}.html',encoding='utf-8',errors='replace').read()
    b=Blocks('field--name-body'); b.feed(html)
    texts[ID]=[' '.join(x) for x in b.buckets]
    print(f"\n===== {ID}: {len(b.buckets)} field--name-body blocks")
    for i,t in enumerate(texts[ID]):
        print(f"  [{i}] len={len(t):5} head={t[:70]!r}")

print("\n=== per-index differs between the two jobs? ===")
n=min(len(texts['400609']),len(texts['400607']))
for i in range(n):
    same = texts['400609'][i]==texts['400607'][i]
    print(f"  [{i}] identical={same}  len609={len(texts['400609'][i])} len607={len(texts['400607'][i])}")
PY
exit 0
python3 - <<'PY'
from html.parser import HTMLParser

class Grab(HTMLParser):
    def __init__(self, want_classes):
        super().__init__()
        self.want = want_classes
        self.stack = []          # list of (tag, matched_label or None, depth)
        self.captures = {c: [] for c in want_classes}
        self.active = []         # (label, depth_when_opened)
        self.depth = 0
    def handle_starttag(self, tag, attrs):
        self.depth += 1
        cls = dict(attrs).get('class','')
        for label, needle in self.want.items():
            if needle in cls.split() or needle in cls:
                self.active.append((label, self.depth))
    def handle_endtag(self, tag):
        self.active = [(l,d) for (l,d) in self.active if d < self.depth]
        self.depth -= 1
    def handle_data(self, data):
        t = data.strip()
        if not t: return
        for (label, d) in self.active:
            self.captures[label].append(t)

want = {
  'field--name-body': 'field--name-body',
  'text-with-summary': 'field--type-text-with-summary',
  'node-job': 'node--type-job-offer',
  'job-offer': 'job-offer',
}
for ID in ('400609','400607'):
    html = open(f'/tmp/{ID}.html', encoding='utf-8', errors='replace').read()
    g = Grab(want); g.feed(html)
    print(f"\n===== {ID} (htmlbytes={len(html)})")
    for label in want:
        txt = ' '.join(g.captures[label])
        # crude class count
        cnt = html.count('field--type-text-with-summary') if label=='text-with-summary' else (html.count('node--type-job-offer') if label=='node-job' else (html.count('class="job-offer') if label=='job-offer' else html.count('field--name-body')))
        print(f"  {label:18} occ={cnt:2} textlen={len(txt):5} head={txt[:80]!r}")
PY
