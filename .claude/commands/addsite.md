---
name: 'addsite'
description: 'Onboard a new jobs-listing site end-to-end: fetch the page, generate field-mapping JSON by analyzing the HTML, validate via Playwright dry-run, POST/PUT/PATCH against the prod scrapper API, trigger a scrape, sample results.'
---

# /addsite — onboard a jobs site end-to-end

You are operating as the scrapnew onboarding agent. The user invoked
`/addsite <URL>` (the argument may be missing — if so, ask once and stop).
Your job is to take that single URL all the way from "never seen" to
"first scrape returned valid jobs" without losing them in side-quests.

## What you must NOT do

- **Don't ask for permission step-by-step.** This skill is explicitly for
  autonomous, hands-off site addition. Only stop if a hard gate fails
  (dry-run finds < 3 items, every field empty, API returns 5xx, etc.) —
  then report and bail.
- **Don't invent selectors blind.** Every selector must be dry-run on the
  live page via Playwright before you POST anything to prod.
- **Don't hardcode credentials in your output.** Read them from the env
  files described below.
- **Don't skip the "PUT again after analyzer" step.** The server's auto
  analyzer overwrites your config in the few seconds after POST /api/sites.
  See "Race with auto-analyzer" below.

## Inputs

- `$1`: the listing URL (e.g. `https://hr.technion.ac.il/positions/`).
- If missing, respond once: "Usage: /addsite <listing-url>" and stop.

## Credentials & endpoints

The prod API token lives in `.claude/scrap-token` (gitignored). Read it:
```bash
TOKEN=$(cat /Users/oren/code/Private/scrapnew/.claude/scrap-token 2>/dev/null | tr -d '[:space:]')
```
- Base URL: `https://scrapper.haide-jobs.co.il`
- Auth header: `Authorization: Bearer $TOKEN`

Do NOT fall back to `.env.worker`'s `API_TOKEN`; that's the worker-side
literal "haideScrapper" used for internal event emits, not the prod API
bearer. If `.claude/scrap-token` is missing or empty, abort with the
message: "Missing /Users/oren/code/Private/scrapnew/.claude/scrap-token —
paste the prod API token into that file and re-run /addsite."

## Step 1 — Duplicate check

```bash
EXISTING=$(curl -sS "https://scrapper.haide-jobs.co.il/api/sites?siteUrl=$URL" \
  -H "Authorization: Bearer $TOKEN")
```

If `data[]` has an entry, capture its `id` and `status`. Decide:
- Status is `ANALYZING` or `REVIEW`: reuse the existing siteId, skip to step 3.
- Status is `ACTIVE`: ask the user to confirm re-onboarding (it will trigger
  ACTIVE → REVIEW). Stop and report if not explicitly told to proceed.
- Status is `FAILED` / `SKIPPED`: reuse the id, skip to step 3.

Else (no existing site) go to step 2.

## Step 2 — Create site

```bash
SITE_ID=$(curl -sS -X POST "https://scrapper.haide-jobs.co.il/api/sites" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"siteUrl\":\"$URL\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['id'])")
```

Site is created in `ANALYZING`. **The server auto-creates an ANALYSIS
workerJob.** Do NOT wait for it — that wastes time and the analyzer's
selectors are usually wrong. Proceed immediately.

## Step 3 — Fetch and inspect the page

Use Playwright (already installed via this repo's `node_modules`) for
the fetch — it handles JS-heavy SPAs that `curl` misses. Save the rendered
HTML to `/tmp/scrap-<safe-host>.html` for inspection, plus a JSON
"structural summary" you'll reason over.

```bash
npx tsx -e "
import { chromium } from 'playwright';
(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    extraHTTPHeaders: { 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' },
  });
  const p = await ctx.newPage();
  await p.goto(process.argv[1], { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  const html = await p.content();
  require('fs').writeFileSync('/tmp/scrap-page.html', html);

  // Structural summary: find the largest cluster of similarly-classed siblings.
  // This is a heuristic to surface candidate itemSelector parents.
  const summary = await p.evaluate(() => {
    const stats: Record<string, { count: number; sampleClass: string; parentTag: string }> = {};
    const all = document.querySelectorAll('*');
    for (const el of all) {
      if (!el.parentElement || !el.classList.length) continue;
      // signature = parent tag + child tag + sorted classlist
      const sig = el.tagName + '|' + Array.from(el.classList).sort().join('.');
      const key = el.parentElement.tagName + ' > ' + sig;
      if (!stats[key]) stats[key] = { count: 0, sampleClass: Array.from(el.classList).join(' '), parentTag: el.parentElement.tagName };
      stats[key].count++;
    }
    // top 20 by count
    return Object.entries(stats)
      .filter(([_, v]) => v.count >= 3 && v.count <= 500)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 20)
      .map(([sig, v]) => ({ sig, ...v }));
  });
  console.log(JSON.stringify({ summary, htmlBytes: html.length }, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
" "$URL"
```

## Step 4 — Pick selectors AND decide listing vs multi-page

Now you (Claude) read `/tmp/scrap-page.html` and the structural summary
and decide:

- `itemSelector`: a CSS selector that matches one row per job. The clusters
  reported by step 3 are the best candidates — typically the highest-count
  one between 10 and 500 that lives inside a recognizable container.
- `listingSelector`: optional, the parent of the items. Use the parent's
  tag + most distinctive class.
- Per-field selectors **relative** to the item (because the worker calls
  `item.querySelector(selector)` per item):
  - **title** — usually `h1`/`h2`/`h3`/`a` with the job name.
  - **department** / **location** — secondary text on the row.
  - **externalJobId** — common patterns:
    - element with `data-job`, `data-job-id`, `data-id` attr → set
      `extractAttr` to that attribute name.
    - text in a column like `"REQ-1234"` — extract as text.
    - if the listing only links to detail pages with no separate ID, use
      the same `<a href="...">` as a stable per-job id (the worker will
      store the URL path as `externalJobId`).
  - **description** / **requirements** — see "listing vs multi-page" below.
  - **detailUrl** — anchor `<a>` to the detail page → `extractAttr: "href"`.
  - **publishDate** — *always look for this*. Common patterns:
    - `<time datetime="2026-01-15">` → use `extractAttr: "datetime"`.
    - "פורסם בתאריך 15/01/2026" / "Posted 3 days ago" / "Published: …" →
      extract text from the containing element.
    - Hidden in a `meta[itemprop="datePosted"]` or `<script type="application/ld+json">`
      JobPosting structured data. The ld+json path requires post-processing
      so prefer visible HTML.
    - If truly absent from both listing and detail, skip it — don't invent
      one.
- `extractAttr` rule of thumb: any field whose value is in an attribute
  (most often `href`, `data-*`, `datetime`) needs `extractAttr` set.
  Leaving it unset means "extract textContent."

Standard field names (these match the worker's normalizer mapping):
`title`, `location`, `department`, `description`, `requirements`,
`externalJobId`, `detailUrl`, `applicationInfo`, `publishDate`.
Use them when applicable so jobs land in normalized columns; use other
names freely for site-specific fields (they go into `rawData`).

### Listing vs multi-page — decide before step 5

**This is the most commonly-missed step.** Look at the listing page HTML
you fetched. Ask:

1. Is the **full job description** visible on the listing (expanded
   accordion, hidden details panel in DOM, or fully-inline summary)?
2. Or does the listing only show a title/location/short summary, with
   "click for more" linking to a per-job detail page?

If (1) — single-page site like Technion: keep `pageFlow: []`, put all
fields on the listing.

If (2) — multi-page site like ashtrom.co.il/career: you MUST set up
`pageFlow` so the worker visits each detail page, OR you'll get empty
`description` / `requirements` columns. Set up:

- `pageFlow[0]` = `{ url: "<listing URL>", action: "navigate" }`
- `pageFlow[1]` = `{ url: "<detail URL pattern with * wildcard>", action: "navigate" }`
  - Example: `https://www.ashtrom.co.il/career/*` matches `/career/4509`.
  - `action: "navigate"` lets the worker fall back to "follow first `<a>`
    inside each item" — works when `itemSelector` is `<a>` or contains
    an `<a>` linking to the detail.
  - If the link is a non-`<a>` button that calls JS, set
    `action: "<CSS selector for that button>"` instead.

For multi-page, fields get **page-routed by `capturedOnUrl`**:
- Listing-side fields: `capturedOnUrl` = the listing URL (literal, not
  pattern).
- Detail-side fields: `capturedOnUrl` = a real example detail URL
  (`https://.../career/4509`). The worker matches it against `pageFlow[1].url`
  via wildcard, so any concrete detail URL that fits the pattern works.

To validate detail-page selectors, **visit one detail URL** in Playwright
during step 5 and run those selectors there (separately from the listing
dry-run).

### Listing completeness — count check + dynamic-loading detection

After your dry-run, check whether the item count you got matches the
visible total on the page. Many sites display "Showing 15 of 47 jobs"
or similar. If they differ:

1. **Infinite scroll** — items appear as you scroll. **Supported out of the
   box** by `worker/jobs/scrape.ts:autoScrollUntilStable` (max 30 scrolls,
   200 items). No config change needed; the worker handles it. The
   dry-run won't see them all, but the real scrape will. Validate by
   doing a second dry-run that scrolls before counting:
   ```ts
   await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
   await p.waitForTimeout(2000);
   // repeat 5x or until count stops growing
   ```
   If the scrolled count matches the page's "of N" total, proceed normally.
2. **"Load more" button** — explicit click required (no scroll trigger).
   **Not supported by the worker yet.** Add the site anyway and warn in
   the report: only the initial items will be scraped. Track in the issue
   "worker: add loadMoreSelector config".
3. **Numbered pagination** (page 1/2/3) — **not supported by the worker yet.**
   For the MVP: scrape only page 1. Note this in the report so the user
   can decide. If the listing is sorted by recency (most recent first),
   page 1 may be sufficient.
4. **URL-param pagination** (`?page=2`) — same as numbered. Workaround:
   onboard the same site multiple times with different `?page=N` URLs
   (each becomes its own site row). Crude but works.
5. **Filters** (dropdowns/checkboxes for category, location, etc.) — for
   MVP, **always scrape the unfiltered URL.** That's usually the parent
   listing showing all jobs. Setting filters means more work and
   shouldn't be necessary if the unfiltered list is complete.

Document any of (2)/(3)/(4) you hit in your final report so the user
knows it's incomplete and can prioritize the worker change.

## Step 5 — Dry-run

Before any write to prod, validate the selectors hit real content:

```bash
npx tsx -e "
import { chromium } from 'playwright';
(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const p = await ctx.newPage();
  await p.goto('$URL', { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

  const itemSel = '<your itemSelector>';
  const fields: Record<string, { selector: string; attr?: string }> = {
    title:         { selector: '.foo .bar' },
    externalJobId: { selector: '.row',  attr: 'data-job' },
    detailUrl:     { selector: 'a.apply', attr: 'href' },
    // ...
  };

  const out = await p.evaluate((args) => {
    const items = document.querySelectorAll(args.itemSel);
    const samples: Record<string, string | null>[] = [];
    for (let i = 0; i < Math.min(3, items.length); i++) {
      const it = items[i];
      const rec: Record<string, string | null> = {};
      for (const [name, f] of Object.entries(args.fields as any)) {
        const el = it.querySelector((f as any).selector);
        if (!el) { rec[name] = null; continue; }
        rec[name] = (f as any).attr ? el.getAttribute((f as any).attr) : (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
      }
      samples.push(rec);
    }
    return { count: items.length, samples };
  }, { itemSel, fields });

  console.log(JSON.stringify(out, null, 2));
  await b.close();
})();
"
```

**Gates** (all must pass — else stop, print the failing sample, and bail):
- `count >= 3`
- For each of the first 3 sample records: at least 3 fields are non-null
  AND not the empty string.
- `title` is non-empty in every sample (this is the hard requirement —
  no title means we picked the wrong itemSelector).
- **If multi-page (pageFlow set)**: also run a second mini-dry-run on one
  detail URL (e.g. `<base>/<path-of-first-item>`). Every detail-page
  field must return non-null on that page. Use the same `page.evaluate`
  structure but with `document.querySelector` (no item scope).

If any gate fails, iterate: re-read the HTML, pick different selectors,
re-run. You get up to 3 iterations before aborting.

## Step 6 — PUT config (twice)

Build the SaveConfigPayload JSON (shape below) and PUT it. Then sleep 5s
and PUT it AGAIN. The second PUT is critical because the server's auto
analyzer (from step 2) will finish around now and overwrite your config
with its bad selectors. The second PUT wins.

JSON shape (omit any key that's null — `revealSelector` is optional, not
nullable per the zod schema; `formCapture` IS nullable):
```json
{
  "listingSelector": "<optional>",
  "itemSelector": "<your itemSelector>",
  "fieldMappings": {
    "<fieldName>": {
      "selector": "<relative CSS>",
      "extractAttr": "<optional attr name>",
      "confidence": 100,
      "source": "MANUAL",
      "capturedOnUrl": "<URL>"
    }
  },
  "pageFlow": [],
  "formCapture": null
}
```

```bash
curl -sS -X PUT "https://scrapper.haide-jobs.co.il/api/sites/$SITE_ID/config" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data-binary @/tmp/scrap-config.json
sleep 5
curl -sS -X PUT "https://scrapper.haide-jobs.co.il/api/sites/$SITE_ID/config" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data-binary @/tmp/scrap-config.json
```

## Step 7 — PATCH to ACTIVE

```bash
curl -sS -X PATCH "https://scrapper.haide-jobs.co.il/api/sites/$SITE_ID" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"ACTIVE"}'
```

Verify the response contains `"fieldMappings":{...}` with YOUR selectors,
not the analyzer's. If the analyzer's are still in there, repeat step 6.

## Step 8 — Trigger scrape and wait

```bash
RUN_ID=$(curl -sS -X POST "https://scrapper.haide-jobs.co.il/api/sites/$SITE_ID/scrape" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['id'])")
```

Poll status (max 90s — scrapes that take longer are usually fine, just
let the user know they can check later):
```bash
for i in $(seq 1 18); do
  sleep 5
  J=$(curl -sS "https://scrapper.haide-jobs.co.il/api/sites/$SITE_ID/scrape" \
    -H "Authorization: Bearer $TOKEN")
  S=$(echo "$J" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['status'])")
  C=$(echo "$J" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['jobCount'])")
  echo "tick $i status=$S jobs=$C"
  [ "$S" = "COMPLETED" ] && break
  [ "$S" = "FAILED" ] && break
done
```

## Step 9 — Sample and report

Fetch 3 jobs, print a one-line summary per job (title + externalJobId +
first 60 chars of description) so the user can eyeball correctness.

```bash
curl -sS "https://scrapper.haide-jobs.co.il/api/jobs?siteId=$SITE_ID&pageSize=3" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import sys,json
d = json.load(sys.stdin)
for j in d['data']:
    raw = j.get('rawData') or {}
    desc = (raw.get('description') or j.get('description') or '')[:60]
    print(f\"  - {j.get('externalJobId') or '(no id)'} | {j.get('title')} | {desc}\")
"
```

End with a 3-line wrap-up:
```
✓ siteId=<ID>  status=ACTIVE  jobs=<N>
✓ config: <fieldCount> fields, itemSelector=<sel>
✓ dashboard: https://scrapper.haide-jobs.co.il/sites/<ID>
```

## Notes on failure modes you'll hit

- **JS-rendered SPAs (React/Vue):** `domcontentloaded` may fire before
  items render. The `waitForLoadState('networkidle', { timeout: 8000 })`
  in step 3 covers most cases. For stubborn ones, add
  `await p.waitForSelector('<itemSelector candidate>', { timeout: 10000 })`
  before reading.
- **Cloudflare / Reblaze challenge pages:** the scraper handles these at
  runtime, but your dry-run might hit one. If `count === 0` AND the HTML
  contains "challenge" / "just a moment", report that the site needs IL
  IP / cookies and stop — the worker will handle it during the real scrape.
- **Paginated sites:** if the page shows only N rows but there are more,
  the rest will be missed. For MVP, set itemSelector to what's visible;
  pagination support is a separate feature (`pageFlow`).
- **Hebrew/RTL sites:** locale matters. Always set `locale: 'he-IL'` in
  the Playwright context for IL sites.
- **`<br>` between every char** (rare, content-side bug): describe in
  the report but proceed. Not your problem to fix per the user.
