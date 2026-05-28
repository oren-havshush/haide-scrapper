---
name: 'addsite'
description: 'Onboard a new jobs-listing site end-to-end: fetch the page, generate field-mapping JSON by analyzing the HTML, validate via Playwright dry-run, POST/PUT/PATCH against the prod scrapper API, trigger a scrape, sample results.'
platform: 'windows-powershell'
---

# /addsite — onboard a jobs site end-to-end (Windows / PowerShell)

You are operating as the scrapnew onboarding agent. The user invoked
`/addsite <URL>` (the argument may be missing — if so, ask once and stop).
Your job is to take that single URL all the way from "never seen" to
"first scrape returned valid jobs" without losing them in side-quests.

This is the **Windows / PowerShell** edition of the skill. All commands
below assume `powershell` (Windows PowerShell 5.1 or PowerShell 7+).
`curl.exe`, `node`, `npx`, and Playwright are expected to be installed
and on `PATH`. Use `Invoke-RestMethod` for API calls (cleaner than
escaping JSON through `curl.exe` on Windows) and `npx tsx` for the
Playwright dry-runs.

**Before doing anything else, run the doctor:**

```powershell
npm run doctor
```

It verifies playwright, chromium, the token file, the `.scratch/`
directory, and prod connectivity. If any check fails, fix that first
and don't proceed.

**Scratch directory:** all Playwright TS scripts and rendered HTML go
into `.\.scratch\` inside the project (NOT `$env:TEMP`). This is
mandatory: `tsx` resolves `import 'playwright'` based on the script's
location, so the script must live somewhere whose parent tree contains
`node_modules\playwright` — i.e. inside the project. The `.scratch/`
folder is gitignored.

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

In PowerShell, capture the argument early:

```powershell
$URL = '<the listing URL passed by the user>'
if (-not $URL) { Write-Host 'Usage: /addsite <listing-url>'; return }
```

## Credentials & endpoints

The prod API token lives in `.claude\scrap-token` at the project root
(gitignored). Read it:

```powershell
$tokenPath = '.\.claude\scrap-token'
if (-not (Test-Path $tokenPath)) {
  throw 'Missing .\.claude\scrap-token - paste the prod API token into that file and re-run /addsite.'
}
$TOKEN = ((Get-Content $tokenPath -Raw -ErrorAction Stop) -replace '\s','')
if (-not $TOKEN -or $TOKEN.StartsWith('REPLACE_ME')) {
  throw '.\.claude\scrap-token is empty or still contains the placeholder. Paste the real prod token.'
}
$HEADERS = @{ Authorization = "Bearer $TOKEN" }
```

- Base URL: `https://scrapper.haide-jobs.co.il`
- Auth header: `Authorization: Bearer $TOKEN`

Do NOT fall back to `.env.worker`'s `API_TOKEN`; that's the worker-side
literal "haideScrapper" used for internal event emits, not the prod API
bearer. If `.claude\scrap-token` is missing or empty, abort with the
message: "Missing .claude\scrap-token — paste the prod API token into
that file and re-run /addsite."

## Step 1 — Duplicate check

```powershell
$existing = Invoke-RestMethod -Method Get `
  -Uri "https://scrapper.haide-jobs.co.il/api/sites?siteUrl=$([uri]::EscapeDataString($URL))" `
  -Headers $HEADERS
```

If `$existing.data` has an entry, capture its `id` and `status`. Decide:
- Status is `ANALYZING` or `REVIEW`: reuse the existing siteId, skip to step 3.
- Status is `ACTIVE`: ask the user to confirm re-onboarding (it will trigger
  ACTIVE → REVIEW). Stop and report if not explicitly told to proceed.
- Status is `FAILED` / `SKIPPED`: reuse the id, skip to step 3.

```powershell
if ($existing.data -and $existing.data.Count -gt 0) {
  $SITE_ID = $existing.data[0].id
  $STATUS  = $existing.data[0].status
  Write-Host "Found existing site $SITE_ID (status=$STATUS)"
  if ($STATUS -eq 'ACTIVE') {
    Write-Host 'Site is ACTIVE. Stop and ask the user to confirm re-onboarding.'
    return
  }
}
```

Else (no existing site) go to step 2.

## Step 2 — Create site

```powershell
$body = @{ siteUrl = $URL } | ConvertTo-Json -Compress
$created = Invoke-RestMethod -Method Post `
  -Uri 'https://scrapper.haide-jobs.co.il/api/sites' `
  -Headers $HEADERS -ContentType 'application/json' `
  -Body $body
$SITE_ID = $created.data.id
Write-Host "Created site $SITE_ID"
```

Site is created in `ANALYZING`. **The server auto-creates an ANALYSIS
workerJob.** Do NOT wait for it — that wastes time and the analyzer's
selectors are usually wrong. Proceed immediately.

## Step 3 — Reachability gate (worker-parity check) — DO THIS FIRST

Before any structural work, prove the worker will actually be able to
reach the site. This is a fail-fast gate that takes ~5 seconds and saves
the rest of the onboarding if the site has a UA-keyed WAF (e.g.
bezeq.co.il, observed 2026-05-27 — bare Playwright gets
`ERR_CONNECTION_RESET` at the TCP layer; with a real Chrome UA the same
host returns 200).

The test mirrors the worker's defaults: bare
`chromium.launch({ headless: true })`, **no UA override**. If that
succeeds, proceed normally. If it fails, run one comparison test with a
real Chrome UA. The combination of bare-fail + chrome-UA-success means
the worker can't onboard this site today.

```powershell
$reach = @'
import { chromium } from 'playwright';

async function tryNav(label: string, opts: any) {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext(opts);
  const p = await ctx.newPage();
  const t0 = Date.now();
  try {
    const r = await p.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 15000 });
    const html = await p.content().catch(() => '');
    const challenged = /just a moment|cf-mitigated|reblaze|access denied|attention required|enable javascript and cookies/i.test(html);
    console.log(`${label}: status=${r?.status()} challenged=${challenged} elapsed=${Date.now() - t0}ms`);
    return { ok: !!r && r.status() < 400 && !challenged, status: r?.status(), challenged };
  } catch (e: any) {
    console.log(`${label}: FAIL ${e.message?.split('\n')[0]} elapsed=${Date.now() - t0}ms`);
    return { ok: false, error: String(e.message || e) };
  } finally {
    await b.close();
  }
}

(async () => {
  const bare = await tryNav('bare-worker-parity', {});
  if (bare.ok) { console.log('GATE: PASS (worker can navigate this site).'); return; }
  const realUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  const realHeaders = { 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' };
  const real = await tryNav('real-chrome-UA', { userAgent: realUA, extraHTTPHeaders: realHeaders });
  if (real.ok) {
    console.log('GATE: UA-keyed WAF detected. Onboard with browserOverrides.');
    console.log('       Carry this into the Step 6 PUT as fieldMappings._meta.browserOverrides:');
    console.log(JSON.stringify({ userAgent: realUA, extraHeaders: realHeaders }, null, 2));
    process.exit(0);
  }
  console.log('GATE: FAIL (network/region/captcha). Neither the worker default nor a real Chrome UA could reach the site.');
  console.log('       Likely IL-IP requirement, captcha, or true outage. Stop and report.');
  process.exit(3);
})();
'@

$reachPath = '.\.scratch\scrap-reach.ts'
Set-Content -Path $reachPath -Value $reach -Encoding UTF8
npx tsx $reachPath $URL
```

Gate decisions:

- **PASS** (bare nav returned 200, no challenge markers): proceed to step
  3b below — the regular fetch + structural summary. No `browserOverrides`
  needed.
- **UA-keyed WAF** (bare nav failed AND real-Chrome-UA nav succeeded):
  **Continue onboarding normally** — but the site needs a per-site
  `browserOverrides` block on its config. Copy the `{ userAgent,
  extraHeaders }` payload the gate script printed and carry it into the
  Step 6 PUT (see "browserOverrides for WAF-protected sites" subsection
  there). The worker reads `fieldMappings._meta.browserOverrides` per
  scrape — no env changes, no risk to other sites. Reference: bezeq.co.il
  (siteId `cmpmv882i001x01mvhf9qfaqy`) is the canonical example. Note that
  step 3b's structural fetch and step 5's dry-run must also use the same
  UA + headers locally, otherwise they'll hit the same TCP reset; reuse
  the inline `userAgent` / `extraHTTPHeaders` from the gate snippet in
  each Playwright invocation for this site.
- **FAIL (both legs failed)**: the site is either IL-IP-only, behind a
  captcha/challenge that survives UA changes, or temporarily down. Stop
  and report — don't keep trying. The worker has IL IPs at runtime so it
  *might* still succeed in prod, but you have no way to verify locally;
  flag the uncertainty in your report and let the user decide whether to
  push through.

Once the gate passes (or you've captured the WAF override), continue with step 3b.

## Step 3b — Fetch and inspect the page

Use Playwright (already installed via this repo's `node_modules`) for
the fetch — it handles JS-heavy SPAs that `curl` misses. Save the rendered
HTML to `.\.scratch\scrap-page.html` for inspection, plus a JSON
"structural summary" you'll reason over.

Write the inline script to a `.ts` file in `.\.scratch\`, then run it.
This avoids PowerShell quoting headaches with `npx tsx -e` AND keeps the
script inside the project so Node can resolve `import 'playwright'`.

```powershell
$fetchScript = @'
import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

(async () => {
  const url = process.argv[2];
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    extraHTTPHeaders: { 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' },
  });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  const html = await p.content();
  const outPath = path.resolve('.scratch', 'scrap-page.html');
  fs.writeFileSync(outPath, html);

  // Structural summary: find the largest cluster of similarly-classed siblings.
  // This is a heuristic to surface candidate itemSelector parents.
  const summary = await p.evaluate(() => {
    const stats: Record<string, { count: number; sampleClass: string; parentTag: string }> = {};
    const all = document.querySelectorAll('*');
    for (const el of all) {
      if (!el.parentElement || !el.classList.length) continue;
      const sig = el.tagName + '|' + Array.from(el.classList).sort().join('.');
      const key = el.parentElement.tagName + ' > ' + sig;
      if (!stats[key]) stats[key] = { count: 0, sampleClass: Array.from(el.classList).join(' '), parentTag: el.parentElement.tagName };
      stats[key].count++;
    }
    return Object.entries(stats)
      .filter(([_, v]) => v.count >= 3 && v.count <= 500)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 20)
      .map(([sig, v]) => ({ sig, ...v }));
  });
  console.log(JSON.stringify({ summary, htmlBytes: html.length, htmlPath: outPath }, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
'@

$fetchPath = '.\.scratch\scrap-fetch.ts'
Set-Content -Path $fetchPath -Value $fetchScript -Encoding UTF8
npx tsx $fetchPath $URL
```

The rendered HTML now lives at `.\.scratch\scrap-page.html`. Read it with
the `Read` tool (or `Get-Content`) to inspect the markup.

## Step 4 — Pick selectors AND decide listing vs multi-page

Now you (the agent) read `$env:TEMP\scrap-page.html` and the structural
summary and decide:

- `itemSelector`: a CSS selector that matches one row per job. The clusters
  reported by step 3b are the best candidates — typically the highest-count
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

### When CSS alone isn't enough — `setupScript` fallback

Sometimes a value you want is buried inside a larger text node — e.g.
the location lives on the first line of the description paragraph as
"מיקום המשרה: תל אביב\n..." with no separate element wrapping just
"תל אביב". Pure CSS can't slice text nodes, and the worker does **not**
honor `regex` / `transform` / `extractRegex` / `postProcess` /
`extract` attributes on a field mapping — the API stores them but the
worker ignores them, so you'll get the whole paragraph dumped into the
field.

The supported escape hatch is `setupScript` (a top-level string in the
config; surfaces as `fieldMappings._meta.setupScript` when you read the
site back). The worker runs that JS in the page before extracting. The
pattern that works: tag the value you want with a `data-*` attribute,
then point a normal CSS selector at it.

Example (goldpro.co.il — extract location from the first line of the
description `<p>`):

```js
(function () {
  try {
    var sections = document.querySelectorAll('section.single_faq');
    sections.forEach(function (s) {
      var firstP = s.querySelector('.fqqcm p');
      if (!firstP) return;
      var m = (firstP.textContent || '').match(
        /מיקום המשרה:\s*([^\n\r]+?)(?:\s*תיאור|\s*מאפייני|\s*שעות|\s*$)/
      );
      if (m && m[1] && !s.querySelector('[data-extracted-location]')) {
        var span = document.createElement('span');
        span.setAttribute('data-extracted-location', '1');
        span.style.display = 'none';
        span.textContent = m[1].trim();
        s.appendChild(span);
      }
    });
  } catch (e) {}
})();
```

Then the field mapping is just:

```json
"location": {
  "selector": "[data-extracted-location]",
  "confidence": 100,
  "source": "MANUAL",
  "capturedOnUrl": "<listing URL>"
}
```

Second pattern — **hardcode a constant per-site value** (abt-industry.co.il —
small consulting firm with a single Tel Aviv office; the page never
writes the location per job but every role is at the same address).
Inject a hidden span into every item, then read it like any other
field:

```js
document.querySelectorAll('.p-team-item').forEach(function (el) {
  if (el.querySelector('.haide-location')) return;
  var s = document.createElement('span');
  s.className = 'haide-location';
  s.style.display = 'none';
  s.textContent = 'תל אביב';
  el.appendChild(s);
});
```

Paired field mapping:

```json
"location": {
  "selector": ".haide-location",
  "confidence": 100,
  "source": "MANUAL",
  "capturedOnUrl": "<listing URL>"
}
```

Use this whenever a field's value is implicit at the site level (one
office, one company name, one industry tag, etc.) but never spelled
out per row in the listing. Verified on abt-industry.co.il, scrape
run `cmp5ibrop000t01lsrqaasmq1` — both jobs returned
`location: "תל אביב"` in the normalized column.

Rules of thumb for `setupScript`:

- Wrap the whole thing in `try { ... } catch (e) {}` so a parse error
  on one item doesn't kill the whole extraction.
- Iterate over `itemSelector` matches (not `document` globally) so per-
  item context is preserved.
- Always check `!s.querySelector('[data-extracted-...]')` before
  inserting, otherwise re-runs (e.g. infinite-scroll loops) duplicate
  spans.
- Use a unique `data-extracted-<field>` attribute name per field —
  don't reuse `data-location` etc. because the page may already use
  those.
- Keep it small and pure-JS (no external libs, no `await`). The worker
  evaluates it synchronously in page context.
- **Multi-page caveat**: confirmed to work on single-page sites
  (`pageFlow: []`, e.g. goldpro.co.il). On multi-page sites
  (`pageFlow` with a detail step) the worker does **not** run
  `setupScript` on detail pages — re-verified on unitask-inc.com three
  times now: (1) markers on `document.body`, (2) markers on `article`,
  and (3) a dedicated probe field reading a `data-setup-ran` attribute
  the script injects unconditionally on every load. All three came
  back empty for every detail-page job. Treat `setupScript` as a
  single-page-only tool. If you need to extract structured data from
  the detail page, you must do it with a plain CSS selector; if no
  clean selector exists, accept the value embedded inside `description`
  (or, on a multi-page site, leave the field empty and clean it
  downstream of the scraper).
- **Multi-page listing caveat (added 2026-05-25)**: `setupScript`
  also does **not** appear to run on the **listing** page of a
  multi-page site. Verified on aman.co.il (siteId
  `cmp9uvymo001t01lsb6gwy6at`): PUT'd a `setupScript` that calls the
  site's own `/wp-admin/admin-ajax.php?action=data_fetch` endpoint
  (returns 111 jobs as rendered HTML) and rewrites the listing
  container with the response. With the same script in a single-page
  config (pattern proven on Assuta/NESS), this would have produced
  ~111 jobs. With `pageFlow` populated for detail-page visits, the
  scrape returned 10 — identical to the no-`setupScript` baseline. So
  the pattern "use `setupScript` to expand a paginated listing AND
  use multi-page detail-page enrichment" does not work today.
  Implication: **if a site has numbered pagination AND you need
  detail-page fields, neither option works without a worker change.**
  See `docs/engineer-notes-pagination.md` for the engineering ask.
  Workarounds:
  - If detail-page data is essential: stay multi-page, accept the
    page-1-only outcome, and file the gap in your report.
  - If full listing coverage is more important than detail fields:
    drop `pageFlow` to `[]`, use `setupScript` to expand the listing,
    accept truncated listing-only data.
  - Crude path-pagination shim: onboard the same site multiple times
    with `…/page/1/`, `…/page/2/`, etc.
- **Worker description-enrichment layer**: on multi-page sites the
  worker now runs a post-processor that parses the captured
  `description` text and writes `_enrichedFromDescription_<field>` keys
  into `rawData`. When the selector for a field returns empty, the
  enriched value becomes the top-level field value. Observed on
  unitask-inc.com: `requirements` and `externalJobId` are enriched
  automatically; `location` is **not** (as of 2026-05-14). The
  enrichment for `externalJobId` is greedy on this site — it includes
  trailing form-label text — so prefer a real CSS selector
  (e.g. `article h2`) over relying on enrichment if you can find one.
- **Prefer universal selectors over framework-specific ones on detail
  pages.** Many WordPress sites mix layouts (Elementor on some posts,
  plain Gutenberg/Classic on others). Elementor-only selectors like
  `.elementor-widget-wrap` or `h2.elementor-heading-title` will silently
  drop the non-Elementor posts. Universal fallbacks that survive the
  mix on unitask-inc.com:
  - description: `article .entry-content`
  - any heading (e.g. job-id label): `article h2` (no class)
  Always sample at least one detail page from each layout variant in
  your dry-run before pushing the config.

When you write a `setupScript`, validate it in your Playwright dry-run
the same way: paste it into the `evaluate()` block before reading
fields, and confirm the `[data-extracted-*]` elements appear with the
expected text.

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

Before any write to prod, validate the selectors hit real content.
Write the dry-run script to a `.ts` file in `.\.scratch\` (same pattern
as step 3b), embedding your chosen selectors:

```powershell
$dryRunScript = @'
import { chromium } from 'playwright';

(async () => {
  const url = process.argv[2];
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded' });
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
        rec[name] = (f as any).attr ? el.getAttribute((f as any).attr) : (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      }
      samples.push(rec);
    }
    return { count: items.length, samples };
  }, { itemSel, fields });

  console.log(JSON.stringify(out, null, 2));
  await b.close();
})();
'@

$dryRunPath = '.\.scratch\scrap-dryrun.ts'
Set-Content -Path $dryRunPath -Value $dryRunScript -Encoding UTF8
npx tsx $dryRunPath $URL
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

## Step 5b — Capture the apply form (when applicable)

If the site has an HTML application form (CV upload, "Apply" / "שליחת
קורות חיים" button that opens a form, etc.), capture it now so the
dashboard surfaces an "Application Form" panel on every job row. This is
the headless equivalent of the Chrome extension's "Form Record" mode and
writes the same `formCapture` JSON shape the API expects.

**Why this exists**: without it, `Site._meta.formCapture` stays `null`,
the worker's form-capture pipeline never fires, and the dashboard's
"Application Form" panel never renders for any job on this site. The
historical assumption was that form capture only happened via the Chrome
extension's "Form Record" mode (one-click on any field inside the live
form). This step closes that gap so the agent-driven `/addsite` flow can
populate it too. Output goes into `Site.fieldMappings._meta.formCapture`
and is **site-level** — copied identically into every job's
`rawData._formData` during scrape via the worker's static-fallback path
(see `worker/jobs/scrape.ts:getFormCaptureConfig` — the worker prefers
live re-extraction but falls back to the saved static fields when the
live form can't be found, which is exactly what happens with
image-captured forms whose `formSelector` is a non-replayable
placeholder).

### Two ways to enter Step 5b

Step 5b can be invoked two ways. The 5b-1, 5b-2, 5b-3 substeps below are
identical in both cases; only what happens after 5b-3 changes.

- **As part of the linear /addsite flow** (steps 1 through 5 already ran
  in this session): 5b-1 / 5b-2 / 5b-3 produce
  `.\.scratch\scrap-form-capture.json` and control returns to Step 6,
  which builds the full PUT payload including the captured form.
- **Standalone for an already-onboarded site** (the user typed
  `run step 5b <URL>` without the prior /addsite steps): same capture
  flow, but after 5b-3 jump to the new 5b-4 instead of Step 6. 5b-4
  merges the form into the existing site config in-place, PATCHes back
  to ACTIVE, and fires a "Test 1"-equivalent scrape so per-job
  `rawData._formData` populates immediately.

Standalone mode requires the site to already exist. Check first, before
running the capture script:

```powershell
$existing = Invoke-RestMethod -Method Get `
  -Uri "https://scrapper.haide-jobs.co.il/api/sites?siteUrl=$([uri]::EscapeDataString($URL))" `
  -Headers $HEADERS
if (-not $existing.data -or $existing.data.Count -eq 0) {
  throw "Site not onboarded for $URL. Run /addsite <URL> first for full onboarding."
}
$SITE_ID = $existing.data[0].id
Write-Host "Standalone mode: targeting siteId=$SITE_ID (status=$($existing.data[0].status))"
```

If the site does NOT exist, the standalone shortcut isn't valid: stop
and tell the user to run `/addsite <URL>` first, because Step 5b alone
can't produce the per-field selectors needed to onboard.

In the rest of Step 5b, "standalone mode" means "the agent entered via
`run step 5b <URL>`"; "/addsite flow mode" means "the agent is doing
the linear steps 1 through 9 of /addsite".

### 5b-1 — Try automatic headless capture

Write the capture script (uses the same Playwright-in-headless pattern
as Step 3b / Step 5; ships a `__name` shim because tsx/esbuild's
keepNames helper otherwise breaks any named binding inside
`page.evaluate`):

```powershell
$captureFormScript = @'
import { chromium, Page } from "playwright";
import * as fs from "fs";

interface Args {
  listingUrl: string;
  detailUrl?: string;
  detailSelector?: string;
  applySelector?: string;
  formSelector?: string;
  expandSelector?: string;
  dismissPopupSelector?: string;
  outPath?: string;
  minFields: number;
  debug: boolean;
}

// Defaults cover the common IL "we use cookies" banners. Override with
// --dismiss-popup="<sel,sel,...>" for any other overlay that intercepts
// clicks. Hidden via style.display = "none" -- not removed, so any state
// listeners on the page still see the elements.
const DEFAULT_DISMISS_POPUP =
  ".cookies-popup-wrapper,.wrapper-popup,#cookie-consent,.cc-banner";

function parseArgs(argv: string[]): Args {
  const listingUrl = argv[2];
  if (!listingUrl) {
    console.error(
      "Usage: capture-form.ts <listingUrl> [--detail-selector=...] [--apply-selector=...] [--detail-url=...] [--form-selector=...] [--expand-selector=...] [--dismiss-popup=...] [--out=...] [--min-fields=N] [--debug]",
    );
    process.exit(64);
  }
  const out: Args = { listingUrl, minFields: 3, debug: false };
  for (const arg of argv.slice(3)) {
    const m = arg.match(/^--([\w-]+)(?:=(.*))?$/);
    if (!m) continue;
    const [, key, val] = m;
    if (key === "detail-url") out.detailUrl = val;
    else if (key === "detail-selector") out.detailSelector = val;
    else if (key === "apply-selector") out.applySelector = val;
    else if (key === "form-selector") out.formSelector = val;
    else if (key === "expand-selector") out.expandSelector = val;
    else if (key === "dismiss-popup") out.dismissPopupSelector = val;
    else if (key === "out") out.outPath = val;
    else if (key === "min-fields") out.minFields = parseInt(val || "3", 10);
    else if (key === "debug") out.debug = true;
  }
  return out;
}

interface FormCapture {
  formSelector: string;
  actionUrl: string;
  method: string;
  fields: Array<{
    name: string;
    label: string;
    fieldType: string;
    required: boolean;
    tagName: string;
  }>;
}

const captureLargestForm = async (
  page: Page,
  preferredSelector: string | undefined,
): Promise<FormCapture | null> => {
  // tsx/esbuild wraps named bindings with __name(...) which doesn't exist
  // in the page context. Shim it as identity so the serialized callback runs.
  await page.addInitScript(() => {
    (globalThis as { __name?: (fn: unknown) => unknown }).__name =
      (fn: unknown) => fn;
  });
  await page.evaluate(() => {
    (globalThis as { __name?: (fn: unknown) => unknown }).__name =
      (fn: unknown) => fn;
  });
  return await page.evaluate((preferred) => {
    const generateSelector = (el: Element): string => {
      if (el.id) return `#${CSS.escape(el.id)}`;
      const parts: string[] = [];
      let cur: Element | null = el;
      let depth = 0;
      while (cur && cur.tagName !== "HTML" && depth < 6) {
        let part = cur.tagName.toLowerCase();
        if ((cur as HTMLElement).id) {
          part = `#${CSS.escape((cur as HTMLElement).id)}`;
          parts.unshift(part);
          break;
        }
        const cls = Array.from(cur.classList).slice(0, 2);
        if (cls.length) part += "." + cls.map((c) => CSS.escape(c)).join(".");
        if (cur.parentElement) {
          const sibs = Array.from(cur.parentElement.children).filter(
            (s) => s.tagName === cur!.tagName,
          );
          if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(cur) + 1})`;
        }
        parts.unshift(part);
        cur = cur.parentElement;
        depth++;
      }
      return parts.join(" > ");
    };

    const inferLabel = (el: Element): string => {
      const h = el as HTMLElement;
      if (h.id) {
        const lab = document.querySelector(`label[for="${CSS.escape(h.id)}"]`);
        if (lab?.textContent) return lab.textContent.trim().slice(0, 100);
      }
      const parentLab = h.closest("label");
      if (parentLab) {
        const clone = parentLab.cloneNode(true) as HTMLElement;
        clone
          .querySelectorAll("input, select, textarea, button")
          .forEach((n) => n.remove());
        const t = clone.textContent?.trim();
        if (t) return t.slice(0, 100);
      }
      const ph = h.getAttribute("placeholder");
      if (ph) return ph.trim().slice(0, 100);
      const aria = h.getAttribute("aria-label");
      if (aria) return aria.trim().slice(0, 100);
      const nm = h.getAttribute("name");
      if (nm)
        return nm
          .replace(/([a-z])([A-Z])/g, "$1 $2")
          .replace(/[_-]/g, " ")
          .trim()
          .slice(0, 100);
      const prev = h.previousElementSibling;
      if (prev?.tagName === "LABEL" && prev.textContent)
        return prev.textContent.trim().slice(0, 100);
      const tag = h.tagName.toLowerCase();
      const type = h.getAttribute("type") || "";
      return type ? `${type} ${tag}` : tag;
    };

    const extractFields = (form: HTMLFormElement) => {
      const fields: FormCapture["fields"] = [];
      const els = form.querySelectorAll("input, select, textarea");
      for (const el of els) {
        const tag = el.tagName.toLowerCase();
        const name = el.getAttribute("name") || "";
        const type =
          el.getAttribute("type") ||
          (tag === "select" ? "select" : tag === "textarea" ? "textarea" : "text");
        if (
          type === "submit" ||
          type === "button" ||
          type === "image" ||
          type === "reset"
        )
          continue;
        fields.push({
          name,
          label: inferLabel(el),
          fieldType: type,
          required: el.hasAttribute("required"),
          tagName: tag,
        });
      }
      return fields;
    };

    const score = (form: HTMLFormElement): number => {
      const fields = extractFields(form);
      let s = fields.length * 10;
      const fieldText = (fields.map((f) => f.label + " " + f.name).join(" ") || "")
        .toLowerCase();
      if (/\bsearch\b|\bquery\b|\bחיפוש\b|^q$/.test(fieldText)) s -= 50;
      const ar = (form.getAttribute("action") || "").toLowerCase();
      if (/search|query|filter/.test(ar)) s -= 30;
      if (
        /apply|application|cv|resume|מועמד|הגשת|רישום|register|signup/i.test(
          form.outerHTML.slice(0, 2000),
        )
      )
        s += 20;
      return s;
    };

    let chosen: HTMLFormElement | null = null;
    if (preferred) {
      const el = document.querySelector(preferred);
      if (el && el.tagName === "FORM") chosen = el as HTMLFormElement;
    }
    if (!chosen) {
      const forms = Array.from(document.querySelectorAll("form")) as HTMLFormElement[];
      if (forms.length === 0) return null;
      forms.sort((a, b) => score(b) - score(a));
      chosen = forms[0];
    }
    if (!chosen) return null;

    const fields = extractFields(chosen);
    const actionRaw = chosen.getAttribute("action") || "";
    let actionUrl: string;
    try {
      actionUrl = actionRaw
        ? new URL(actionRaw, window.location.href).toString()
        : window.location.href;
    } catch {
      actionUrl = window.location.href;
    }
    const method = (chosen.getAttribute("method") || "GET").toUpperCase();
    return { formSelector: generateSelector(chosen), actionUrl, method, fields };
  }, preferredSelector);
};

(async () => {
  const args = parseArgs(process.argv);
  const debug: Record<string, unknown> = {};
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
    extraHTTPHeaders: { "accept-language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7" },
  });
  const page = await ctx.newPage();
  try {
    debug.step1_navigate = args.listingUrl;
    await page.goto(args.listingUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

    if (args.detailUrl) {
      debug.step2_detailUrl = args.detailUrl;
      await page.goto(args.detailUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    } else if (args.detailSelector) {
      debug.step2_detailSelector = args.detailSelector;
      const link = await page.$(args.detailSelector);
      if (!link) throw new Error(`detail selector matched no element: ${args.detailSelector}`);
      const href = await link.getAttribute("href");
      if (href) {
        const abs = new URL(href, page.url()).toString();
        debug.step2_detailHref = abs;
        await page.goto(abs, { waitUntil: "domcontentloaded", timeout: 30000 });
      } else {
        await link.click();
      }
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    }

    // Dismiss overlays (cookies banners etc.) that intercept pointer events
    // before any clicks. Hide via style.display = "none" -- not removed --
    // so any listeners that fire on page load remain bound.
    const dismissSel = args.dismissPopupSelector ?? DEFAULT_DISMISS_POPUP;
    if (dismissSel) {
      const dismissed = await page.evaluate((sel) => {
        let n = 0;
        try {
          document.querySelectorAll(sel).forEach((el) => {
            (el as HTMLElement).style.display = "none";
            n++;
          });
        } catch {
          /* ignore */
        }
        return n;
      }, dismissSel);
      debug.step2b_dismissedPopups = { selector: dismissSel, count: dismissed };
    }

    // Optional: expand an accordion / reveal a hidden form before reading
    // forms. Some sites (single-page job portals) only render the apply
    // form once a row is expanded. The click goes through page.evaluate so
    // leftover overlays don't block it.
    if (args.expandSelector) {
      const expanded = await page.evaluate((sel) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (!el) return false;
        el.click();
        return true;
      }, args.expandSelector);
      debug.step2c_expandSelector = args.expandSelector;
      debug.step2c_expanded = expanded;
      if (!expanded) {
        throw new Error(`expand selector matched no element: ${args.expandSelector}`);
      }
      await page.waitForTimeout(2500);
    }

    if (args.applySelector) {
      debug.step3_applySelector = args.applySelector;
      const apply = await page.$(args.applySelector);
      if (!apply) throw new Error(`apply selector matched no element: ${args.applySelector}`);
      const href = await apply.getAttribute("href");
      if (href && href !== "#" && !href.startsWith("javascript:")) {
        const abs = new URL(href, page.url()).toString();
        debug.step3_applyHref = abs;
        await page.goto(abs, { waitUntil: "domcontentloaded", timeout: 30000 });
      } else {
        // DOM-level click via evaluate() bypasses Playwright's "stable +
        // not intercepted" guard. The dismissPopup step above usually
        // covers the common case, but defensive: don't fail if a sneaky
        // overlay slips back in.
        await page.evaluate((sel) => {
          const el = document.querySelector(sel) as HTMLElement | null;
          el?.click();
        }, args.applySelector);
        await page.waitForTimeout(1500);
      }
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    }

    debug.finalUrl = page.url();
    debug.formCount = await page.evaluate(() => document.querySelectorAll("form").length);

    const capture = await captureLargestForm(page, args.formSelector);
    const ok = !!capture && capture.fields.length >= args.minFields;
    const out: Record<string, unknown> = { formCapture: capture };
    if (args.debug) out.debug = debug;
    console.log(JSON.stringify(out, null, 2));
    if (args.outPath && capture) {
      // Write directly via Node so the JSON never round-trips through a
      // shell pipe (PowerShell will mangle Hebrew labels otherwise).
      fs.writeFileSync(args.outPath, JSON.stringify(capture, null, 2), "utf8");
      console.error(`[capture-form] wrote formCapture to ${args.outPath}`);
    }
    if (!ok) {
      console.error(
        `[capture-form] no usable form found (need >= ${args.minFields} fields). Final URL: ${page.url()} formCount=${debug.formCount}`,
      );
      process.exit(2);
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("[capture-form] ERROR:", e?.message || e);
  process.exit(1);
});
'@

$capturePath = '.\.scratch\capture-form.ts'
Set-Content -Path $capturePath -Value $captureFormScript -Encoding UTF8

# Pick a sample detail URL. For a multi-page site use the actual detail URL
# you discovered during Step 5 (read it out of the dry-run sample's
# detailUrl or title_href). For a single-page site pass the listing URL.
$SAMPLE_DETAIL = '<paste one concrete detail URL here, or $URL if single-page>'
# Optional knobs (omit when not needed):
#   --apply-selector=...   click an "Apply" button to reveal the form
#   --expand-selector=...  click an accordion / row to reveal a hidden form
#                          (single-page job portals like cellcom.co.il)
#   --form-selector=...    target a specific <form> by id/class
#   --dismiss-popup=...    comma-separated CSS for popups to hide before
#                          interacting (defaults already cover the common
#                          IL cookies banners)
# The --out flag has Node write the JSON directly (bypasses PowerShell so
# Hebrew labels don't get re-encoded into mojibake on stdout).
npx tsx $capturePath $URL --detail-url=$SAMPLE_DETAIL `
  --out=.\.scratch\scrap-form-capture.json --debug
$CAPTURE_EXIT = $LASTEXITCODE
```

**Gates**:

- `$CAPTURE_EXIT -eq 0` AND `.\.scratch\scrap-form-capture.json` exists with
  `fields.Count >= 3`: success. The file is the canonical output that
  Step 6 (or 5b-4 in standalone mode) reads. No further PowerShell
  copy step needed.
- `$CAPTURE_EXIT -eq 2` (no usable form): **STOP** and run 5b-2 below.
  Do NOT silently fall through to `formCapture=null` — that's the
  pre-existing failure mode this step is designed to fix.
- `$CAPTURE_EXIT -ne 0 -and $CAPTURE_EXIT -ne 2` (script crashed):
  iterate once with different selectors / URLs. If still failing,
  proceed to 5b-2.

### 5b-2 — When automatic capture fails: STOP and ask the user

Do not pick this branch silently. Print the headless-capture failure
output (URLs tried, form count per page) so the user has context, then
ask the following three questions **in this exact order** (one
`AskQuestion` invocation, three options). Do not invent a fourth option;
the three branches below are the only supported outcomes.

```
Q1: "I tried to capture the apply form headlessly but couldn't find a
     usable <form>. The script visited [<final URL>] and found
     <formCount> form elements there. Do you know a specific URL where
     the form is rendered? E.g. https://site/apply/123, or a dedicated
     apply page. If yes, paste the URL and I'll re-run capture against
     it."

Q2: "If the form opens in a JS modal that has to be clicked open (and
     you can't give me a direct URL), paste a screenshot of the form
     here. I'll read the field labels and types from the image and
     write them as static metadata."

Q3: "If there really is no apply form on this site (only a WhatsApp
     link, an email address, etc.), say 'skip' and I'll leave
     formCapture=null. The dashboard's 'Application Form' panel will
     just not render for this site."
```

Respond per branch:

- **Q1 — user pastes a URL**: re-run the capture script with that URL.
  ```powershell
  npx tsx $capturePath $URL --detail-url='<the URL the user pasted>' `
    --out=.\.scratch\scrap-form-capture.json --debug
  ```
  If it now succeeds (`$LASTEXITCODE -eq 0` and the JSON file has
  `fields.Count >= 3`), proceed. If it fails again, fall back to Q2.

- **Q2 — user pastes a screenshot of the form** (this is the
  image-only fallback): read each visible field in the image and
  produce a `FormCapture` object. For each field:
  - `label`: the visible Hebrew/English text next to the input (the
    on-screen label or placeholder). Hold to ≤ 100 chars.
  - `fieldType`: pick from `text | email | tel | textarea | select |
    checkbox | radio | file | date | number` based on visual cues —
    multi-line box → `textarea`; dropdown caret → `select`; square
    box → `checkbox`; round dot → `radio`; "Choose file" button →
    `file`; otherwise `text`.
  - `required`: `true` if you see a red asterisk, `*`, or "(חובה)" /
    "(required)" next to the label; else `false`.
  - `name`: leave as empty string `""`. You can't read this from a
    screenshot and the static fallback path doesn't use it.
  - `tagName`: `"input"` for everything except textareas and selects
    (which get `"textarea"` / `"select"`).

  Construct the JSON file directly (do NOT run the headless capture
  script for this path — there's nothing live to capture).

  **Important — bypass PowerShell for this write.** Hebrew labels travel
  agent → shell tool bytes → PowerShell parser → file, and PS 5.1's
  active code page on this machine can mangle non-ASCII at the parser
  step (same encoding axis as the `capture-form.ts` stdout bug that
  bit us live). Use the agent's file-write tool directly to create
  `.\.scratch\scrap-form-capture.json` with the JSON body. The file
  goes to disk as UTF-8 without ever touching PowerShell.

  Template — replace the `fields` array with one entry per visible
  field in the screenshot, keep the top-level keys as-is:

  ```json
  {
    "formSelector": "(image-captured, not auto-replayable)",
    "actionUrl": "(unknown - captured from screenshot)",
    "method": "POST",
    "fields": [
      { "name": "", "label": "שם פרטי",    "fieldType": "text",     "required": true, "tagName": "input" },
      { "name": "", "label": "שם משפחה",   "fieldType": "text",     "required": true, "tagName": "input" },
      { "name": "", "label": "טלפון",      "fieldType": "tel",      "required": true, "tagName": "input" },
      { "name": "", "label": "אימייל",     "fieldType": "email",    "required": true, "tagName": "input" },
      { "name": "", "label": "קורות חיים", "fieldType": "file",     "required": true, "tagName": "input" }
    ]
  }
  ```

  After the file is written, verify the encoding survived by reading
  it back — `formCapture.fields[0].label` must still match the
  Hebrew/English text from the screenshot byte-for-byte. If it
  doesn't, re-write the file via the file tool (do NOT try to
  re-encode via PowerShell — at that point the bytes on disk are
  already wrong).

  Flag this clearly in your final report: "Apply form for this site is
  STATIC metadata (captured from screenshot); the worker won't be able
  to re-validate it on each scrape. If the site's form changes you'll
  need to re-onboard."

- **Q3 — user says "skip"**: write the literal string `null` to the
  file (so Step 6 / 5b-4 knows to send `formCapture: null` explicitly).
  ASCII only — PowerShell is safe here:
  ```powershell
  Set-Content -Path '.\.scratch\scrap-form-capture.json' -Value 'null' -Encoding UTF8
  ```

### 5b-3 — Verify before Step 6

Print a one-line summary of what was captured (or skipped):
```powershell
$fcOnDisk = Get-Content '.\.scratch\scrap-form-capture.json' -Raw -ErrorAction SilentlyContinue
if (-not $fcOnDisk -or $fcOnDisk.Trim() -eq 'null') {
  Write-Host '5b: formCapture=null (no apply form on this site)'
} else {
  $parsed = $fcOnDisk | ConvertFrom-Json
  Write-Host ("5b: formCapture method={0} fields={1} selector={2}" -f `
    $parsed.method, $parsed.fields.Count, $parsed.formSelector)
}
```

If the summary looks wrong (e.g. 1 field for an apply form that
clearly has more), loop back to 5b-2 Q2 and re-do the image read. In
standalone mode, "looks wrong" should not block 5b-4 by default — only
re-loop if the field count is obviously off (zero, or far below what
the user expected). Minor label nits can be fixed by re-running step 5b
later.

After 5b-3, the path forks:

- **/addsite flow mode**: continue to Step 6 below. The PUT payload
  there picks up `.\.scratch\scrap-form-capture.json` automatically.
- **Standalone mode**: skip Steps 6 through 9 and run **5b-4** below.
  When 5b-4 finishes the site is ACTIVE with the new form attached and
  a fresh single-job Test scrape has run.

### 5b-4 — Standalone push to existing site

Standalone-mode only. Skip this section entirely when running as part
of the linear /addsite flow.

This step is the standalone equivalent of Steps 6 through 9 collapsed
into one Node script:

1. GET the current site (preserves itemSelector, fieldMappings,
   setupScript, pageFlow as-is).
2. Build a SaveConfigPayload with the new `formCapture` swapped in.
3. PUT `/api/sites/<id>/config` twice (5s sleep between, mirrors the
   analyzer-race pattern from Step 6).
4. PATCH `{status: 'ACTIVE'}` — the PUT auto-demotes ACTIVE to REVIEW.
5. POST `/api/sites/<id>/scrape` with body `{ maxJobs: 1 }` — same call
   the dashboard "Test 1" button makes. The worker's
   `prisma.job.deleteMany({ where: { siteId } })` runs before insert on
   every scrape, so this also wipes any pre-existing jobs (no separate
   "Clear Jobs" call needed).
6. Poll for COMPLETED, fetch the single resulting job, confirm
   `rawData._formData` is populated.

Everything is done in Node (not PowerShell) so Hebrew strings flow
through `JSON.parse`/`fetch`/`JSON.stringify` without round-tripping
through Windows code pages.

```powershell
$mergeScript = @'
import * as fs from "fs";
import * as path from "path";

const BASE = "https://scrapper.haide-jobs.co.il";

async function main() {
  const siteId = process.argv[2];
  const formCapturePath = process.argv[3] || ".scratch/scrap-form-capture.json";
  if (!siteId) {
    console.error("Usage: merge-form-capture.ts <siteId> [formCaptureJsonPath]");
    process.exit(64);
  }

  const TOKEN = fs
    .readFileSync(path.resolve(".claude", "scrap-token"), "utf8")
    .replace(/\s/g, "");
  if (!TOKEN || TOKEN.startsWith("REPLACE_ME")) {
    throw new Error(".claude/scrap-token empty or placeholder");
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
  };

  // Read the captured form. "null" or missing -> formCapture: null in
  // the payload (lets the user explicitly clear an existing capture).
  let formCapture: unknown = null;
  if (fs.existsSync(formCapturePath)) {
    const raw = fs.readFileSync(formCapturePath, "utf8");
    if (raw.trim() && raw.trim() !== "null") {
      formCapture = JSON.parse(raw);
    }
  }
  const fcSummary =
    formCapture && typeof formCapture === "object"
      ? `selector=${(formCapture as any).formSelector} method=${(formCapture as any).method} fields=${(formCapture as any).fields?.length ?? 0}`
      : "null";
  console.log(`[5b-4] Loaded formCapture: ${fcSummary}`);

  // GET the site via the list endpoint -- the single-resource path
  // /api/sites/<id> returns 405 (the API exposes id-filtered lists only).
  console.log(`[5b-4] Fetching site ${siteId}...`);
  const listUrl = `${BASE}/api/sites?id=${encodeURIComponent(siteId)}`;
  const siteResp = await fetch(listUrl, { headers });
  if (!siteResp.ok) throw new Error(`GET site failed: ${siteResp.status}`);
  const siteJson: any = await siteResp.json();
  let site: any = null;
  if (Array.isArray(siteJson.data)) {
    site = siteJson.data.find((s: any) => s.id === siteId) || siteJson.data[0];
  } else {
    site = siteJson.data || siteJson;
  }
  if (!site) throw new Error("site not found in list response");
  const cur = site.fieldMappings || {};
  const meta = cur._meta || {};

  // Build the PUT payload. The server stores top-level keys
  // (itemSelector, setupScript, etc.) inside _meta but the PUT shape
  // expects them flat. Field mappings (everything except _meta) copy
  // through verbatim so we don't disturb existing selectors.
  const fieldMappings: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cur)) {
    if (k === "_meta") continue;
    fieldMappings[k] = v;
  }
  const payload: Record<string, unknown> = {
    itemSelector: meta.itemSelector || ".item",
    fieldMappings,
    pageFlow: Array.isArray(site.pageFlow) ? site.pageFlow : [],
    formCapture,
  };
  if (meta.listingSelector) payload.listingSelector = meta.listingSelector;
  if (meta.setupScript) payload.setupScript = meta.setupScript;
  if (meta.loadMoreSelector) payload.loadMoreSelector = meta.loadMoreSelector;
  if (meta.revealSelector) payload.revealSelector = meta.revealSelector;
  if (meta.pagination) payload.pagination = meta.pagination;

  fs.writeFileSync(
    path.resolve(".scratch", "merge-config-payload.json"),
    JSON.stringify(payload, null, 2),
    "utf8",
  );
  console.log(
    `[5b-4] payload itemSelector=${payload.itemSelector} fieldKeys=[${Object.keys(fieldMappings).join(",")}] setupScriptBytes=${(payload.setupScript as string | undefined)?.length ?? 0}`,
  );

  const body = JSON.stringify(payload);
  const putUrl = `${BASE}/api/sites/${siteId}/config`;

  console.log("[5b-4] PUT #1...");
  const r1 = await fetch(putUrl, { method: "PUT", headers, body });
  if (!r1.ok)
    throw new Error(`PUT #1 failed: ${r1.status} ${(await r1.text()).slice(0, 500)}`);
  console.log("[5b-4] sleeping 5s before PUT #2 (race vs auto-analyzer)...");
  await new Promise((r) => setTimeout(r, 5000));
  console.log("[5b-4] PUT #2...");
  const r2 = await fetch(putUrl, { method: "PUT", headers, body });
  if (!r2.ok)
    throw new Error(`PUT #2 failed: ${r2.status} ${(await r2.text()).slice(0, 500)}`);

  // PUT auto-demotes ACTIVE to REVIEW; PATCH it back so the dashboard
  // and the worker scheduler treat the site as live.
  console.log("[5b-4] PATCH back to ACTIVE...");
  const patchResp = await fetch(`${BASE}/api/sites/${siteId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ status: "ACTIVE" }),
  });
  if (!patchResp.ok)
    throw new Error(
      `PATCH failed: ${patchResp.status} ${(await patchResp.text()).slice(0, 500)}`,
    );

  // Verify formCapture survived the PATCH.
  const verifyResp = await fetch(listUrl, { headers });
  const verifyJson: any = await verifyResp.json();
  const verifySite =
    (Array.isArray(verifyJson.data)
      ? verifyJson.data.find((s: any) => s.id === siteId)
      : verifyJson.data) || verifyJson;
  const verifyFC = verifySite?.fieldMappings?._meta?.formCapture;
  if (formCapture && !verifyFC) {
    throw new Error("VERIFY: _meta.formCapture missing after PATCH");
  }
  console.log(
    `[5b-4] verified status=${verifySite?.status} formCapture.fields=${verifyFC?.fields?.length ?? "n/a"}`,
  );

  // Trigger a "Test 1" scrape -- maxJobs: 1, same call the dashboard
  // button makes. The worker's deleteMany clears existing jobs first.
  console.log("[5b-4] POST /scrape { maxJobs: 1 } (Test 1 equivalent)...");
  const scrapeResp = await fetch(`${BASE}/api/sites/${siteId}/scrape`, {
    method: "POST",
    headers,
    body: JSON.stringify({ maxJobs: 1 }),
  });
  if (!scrapeResp.ok)
    throw new Error(
      `POST scrape failed: ${scrapeResp.status} ${(await scrapeResp.text()).slice(0, 500)}`,
    );
  const scrapeJson: any = await scrapeResp.json();
  const runId = scrapeJson.data?.id || scrapeJson.id;
  console.log(`[5b-4] scrape runId=${runId}`);

  // Poll up to 90s.
  let runStatus = "PENDING";
  for (let i = 0; i < 18; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const sResp = await fetch(`${BASE}/api/sites/${siteId}/scrape`, { headers });
    const sJson: any = await sResp.json();
    const run = sJson.data || sJson;
    runStatus = run?.status || "UNKNOWN";
    const jc = run?.jobCount;
    console.log(`[5b-4] tick ${i + 1} status=${runStatus} jobs=${jc}`);
    if (runStatus === "COMPLETED" || runStatus === "FAILED") break;
  }

  // Read the single job and report whether _formData populated.
  const jobsResp = await fetch(
    `${BASE}/api/jobs?siteId=${siteId}&pageSize=1`,
    { headers },
  );
  const jobsJson: any = await jobsResp.json();
  const job = jobsJson.data?.[0];
  const hasFormData =
    !!(job?.rawData && (job.rawData as any)._formData);
  const jobId = job?.id || "(none)";

  console.log(
    `\n5b-4: siteId=${siteId} status=${verifySite?.status} formCapture.fields=${verifyFC?.fields?.length ?? "n/a"} testScrape=${runId} ${runStatus} job=${jobId} hasFormData=${hasFormData}`,
  );
}

main().catch((e) => {
  console.error("[5b-4] ERROR:", e?.message || e);
  process.exit(1);
});
'@

$mergePath = '.\.scratch\merge-form-capture.ts'
Set-Content -Path $mergePath -Value $mergeScript -Encoding UTF8
npx tsx $mergePath $SITE_ID .scratch/scrap-form-capture.json
$MERGE_EXIT = $LASTEXITCODE
```

**Gates** (all must pass — else report and stop):

- `$MERGE_EXIT -eq 0`.
- The final summary line shows `status=ACTIVE` and a non-empty
  `formCapture.fields` count matching the local JSON.
- `hasFormData=true` on the single test-scraped job (when the worker
  successfully copies the static form into `rawData._formData`).

If `hasFormData=false` but everything else passed: the site is
configured correctly, but the static-fallback copy didn't happen on
this scrape. Possible causes:

- The worker's live form re-extraction tried and found the form (so it
  preferred the live data) — `_formData` is still present but the key
  shape may differ. Re-check the job's `rawData._formData` directly.
- The form is hidden behind an expand/click that the worker doesn't
  perform — re-onboard with a `setupScript` that pre-expands jobs, or
  accept that the dashboard panel will only show the site-level
  formCapture (from `_meta.formCapture`) rather than per-job.

Report and continue — don't loop.

## Step 6 — PUT config (twice)

> **Standalone-mode exit**: if the agent was invoked via
> `run step 5b <URL>`, **skip Steps 6 through 9 entirely** — Step 5b-4
> is the standalone equivalent (it does the PUTs, the PATCH back to
> ACTIVE, the Test 1 scrape, and the verification). Steps 6-9 below
> apply only to the linear /addsite flow.

Build the SaveConfigPayload JSON (shape below) and PUT it. Then sleep 5s
and PUT it AGAIN. The second PUT is critical because the server's auto
analyzer (from step 2) will finish around now and overwrite your config
with its bad selectors. The second PUT wins.

JSON shape (omit any key that's null — `revealSelector` is optional, not
nullable per the zod schema; `formCapture` IS nullable but you should
include the object produced by Step 5b when one exists; `setupScript`
is optional, only include if you actually need a DOM-mutating script
per the "setupScript fallback" guidance in step 4):

```json
{
  "listingSelector": "<optional>",
  "itemSelector": "<your itemSelector>",
  "setupScript": "<optional JS string; omit if not needed>",
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
  "formCapture": null   // or { formSelector, actionUrl, method, fields[] } from Step 5b
}
```

Per-field mapping attributes the worker actually honors:
`selector`, `extractAttr`, `confidence`, `source`, `capturedOnUrl`.
The API will silently accept `regex`, `transform`, `extractRegex`,
`postProcess`, `extract`, etc., but the worker ignores them — don't
waste a PUT trying to use them. Use `setupScript` instead.

In PowerShell, build the payload as a hashtable, convert to JSON, save
to a temp file, then PUT it twice:

```powershell
# Load the formCapture from Step 5b (if you ran it). Defaults to $null when
# the file is missing or contains the literal "null".
$formCaptureRaw = $null
if (Test-Path '.\.scratch\scrap-form-capture.json') {
  $raw = Get-Content '.\.scratch\scrap-form-capture.json' -Raw
  if ($raw -and $raw.Trim() -ne 'null') {
    $formCaptureRaw = $raw | ConvertFrom-Json
  }
}

$config = [ordered]@{
  listingSelector = '<optional>'
  itemSelector    = '<your itemSelector>'
  # setupScript = '<JS string>'   # only if you need the fallback from step 4
  fieldMappings   = [ordered]@{
    title = [ordered]@{
      selector       = '.foo .bar'
      confidence     = 100
      source         = 'MANUAL'
      capturedOnUrl  = $URL
    }
    externalJobId = [ordered]@{
      selector       = '.row'
      extractAttr    = 'data-job'
      confidence     = 100
      source         = 'MANUAL'
      capturedOnUrl  = $URL
    }
    detailUrl = [ordered]@{
      selector       = 'a.apply'
      extractAttr    = 'href'
      confidence     = 100
      source         = 'MANUAL'
      capturedOnUrl  = $URL
    }
    # ... add more fields ...
  }
  pageFlow    = @()
  formCapture = $formCaptureRaw   # populated by Step 5b; $null if you skipped it
}

$configPath = '.\.scratch\scrap-config.json'
$configJson = $config | ConvertTo-Json -Depth 20
# Write UTF-8 without BOM so the server's JSON parser doesn't choke.
[System.IO.File]::WriteAllText((Resolve-Path .).Path + '\' + ($configPath -replace '^\.\\',''), $configJson, [System.Text.UTF8Encoding]::new($false))

# First PUT
Invoke-RestMethod -Method Put `
  -Uri "https://scrapper.haide-jobs.co.il/api/sites/$SITE_ID/config" `
  -Headers $HEADERS -ContentType 'application/json' `
  -InFile $configPath | Out-Null

Start-Sleep -Seconds 5

# Second PUT — wins the race against the auto-analyzer
Invoke-RestMethod -Method Put `
  -Uri "https://scrapper.haide-jobs.co.il/api/sites/$SITE_ID/config" `
  -Headers $HEADERS -ContentType 'application/json' `
  -InFile $configPath | Out-Null
```

Note: `Invoke-RestMethod -InFile` reads the file as the request body
(equivalent to `curl --data-binary @file`). If you prefer `curl.exe`:

```powershell
curl.exe -sS -X PUT "https://scrapper.haide-jobs.co.il/api/sites/$SITE_ID/config" `
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" `
  --data-binary "@$configPath"
```

### browserOverrides for WAF-protected sites

If Step 3's gate reported "UA-keyed WAF detected", add the `browserOverrides`
field that the gate script printed to the config payload. Shape:

```jsonc
{
  "itemSelector": "...",
  "fieldMappings": { ... },
  "pageFlow": [],
  "formCapture": null,
  "browserOverrides": {
    "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "extraHeaders": {
      "accept-language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7"
    }
  }
}
```

In PowerShell, building on the `$config` hashtable from above:

```powershell
$config.browserOverrides = [ordered]@{
  userAgent    = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  extraHeaders = [ordered]@{
    'accept-language' = 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7'
  }
}
```

Validation (per
[src/lib/validators.ts](src/lib/validators.ts) `updateSiteConfigSchema`):
both `userAgent` and `extraHeaders` are optional; either may be omitted.
`userAgent` caps at 500 chars, each header value at 1000 chars. The API
persists the block under `fieldMappings._meta.browserOverrides` next to
`setupScript` and `loadMoreSelector`. The worker reads it in
[worker/lib/playwright.ts](worker/lib/playwright.ts) `createPage()` —
per-site `userAgent` wins over `SCRAPE_USER_AGENT`, per-site headers
merge on top of the default `Accept-Language`. Nothing else needs to
change about the rest of the config.

Reference: bezeq.co.il (siteId `cmpmv882i001x01mvhf9qfaqy`) is the
canonical case — TCP-resets bare Playwright but loads cleanly with the
Chrome 131 UA above.

## Step 7 — PATCH to ACTIVE

```powershell
$patch = @{ status = 'ACTIVE' } | ConvertTo-Json -Compress
$patchResp = Invoke-RestMethod -Method Patch `
  -Uri "https://scrapper.haide-jobs.co.il/api/sites/$SITE_ID" `
  -Headers $HEADERS -ContentType 'application/json' `
  -Body $patch
```

Verify the response's `fieldMappings` contains YOUR selectors, not the
analyzer's:

```powershell
$patchResp.data.config.fieldMappings | ConvertTo-Json -Depth 10
```

If the analyzer's selectors are still in there, repeat step 6.

## Step 8 — Trigger scrape and wait

```powershell
$run = Invoke-RestMethod -Method Post `
  -Uri "https://scrapper.haide-jobs.co.il/api/sites/$SITE_ID/scrape" `
  -Headers $HEADERS
$RUN_ID = $run.data.id
Write-Host "Triggered scrape run $RUN_ID"
```

Poll status (max 90s — scrapes that take longer are usually fine, just
let the user know they can check later):

```powershell
for ($i = 1; $i -le 18; $i++) {
  Start-Sleep -Seconds 5
  $j = Invoke-RestMethod -Method Get `
    -Uri "https://scrapper.haide-jobs.co.il/api/sites/$SITE_ID/scrape" `
    -Headers $HEADERS
  $S = $j.data.status
  $C = $j.data.jobCount
  Write-Host "tick $i status=$S jobs=$C"
  if ($S -eq 'COMPLETED') { break }
  if ($S -eq 'FAILED')    { break }
}
```

## Step 9 — Sample and report

Fetch 3 jobs, print a one-line summary per job (title + externalJobId +
first 60 chars of description) so the user can eyeball correctness.

```powershell
$jobs = Invoke-RestMethod -Method Get `
  -Uri "https://scrapper.haide-jobs.co.il/api/jobs?siteId=$SITE_ID&pageSize=3" `
  -Headers $HEADERS

foreach ($j in $jobs.data) {
  $raw  = $j.rawData
  $desc = if ($raw -and $raw.description) { $raw.description } else { $j.description }
  if ($desc) { $desc = $desc.Substring(0, [Math]::Min(60, $desc.Length)) } else { $desc = '' }
  $id = if ($j.externalJobId) { $j.externalJobId } else { '(no id)' }
  Write-Host "  - $id | $($j.title) | $desc"
}
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
  in step 3b covers most cases. For stubborn ones, add
  `await p.waitForSelector('<itemSelector candidate>', { timeout: 10000 })`
  before reading.
- **Cloudflare / Reblaze challenge pages:** the scraper handles these at
  runtime, but your dry-run might hit one. If `count === 0` AND the HTML
  contains "challenge" / "just a moment", report that the site needs IL
  IP / cookies and stop — the worker will handle it during the real scrape.
- **UA-keyed WAF (TCP-level reset):** distinct from a challenge page —
  the host rejects default-Playwright UA strings *before* any HTTP
  response (`ERR_CONNECTION_RESET` in 2–5 seconds). The Step 3
  reachability gate catches this; when it reports "UA-keyed WAF", carry
  the `{ userAgent, extraHeaders }` payload it prints into the Step 6
  PUT as `browserOverrides` (see Step 6's "browserOverrides for
  WAF-protected sites" subsection). The worker applies the override per
  scrape, no env changes required. Reference site: bezeq.co.il
  (`cmpmv882i001x01mvhf9qfaqy`).
- **Paginated sites:** if the page shows only N rows but there are more,
  the rest will be missed. For MVP, set itemSelector to what's visible;
  pagination support is a separate feature (`pageFlow`).
- **Hebrew/RTL sites:** locale matters. Always set `locale: 'he-IL'` in
  the Playwright context for IL sites.
- **`<br>` between every char** (rare, content-side bug): describe in
  the report but proceed. Not your problem to fix per the user.

## Windows-specific gotchas

- **`curl` vs `curl.exe`:** in PowerShell, `curl` is an alias for
  `Invoke-WebRequest`, which doesn't accept `-sS`. Always write `curl.exe`
  (with the extension) when you want the real curl. Better yet, prefer
  `Invoke-RestMethod` — it returns parsed JSON directly, no `python3`
  needed.
- **Quoting:** PowerShell expands `$variables` inside double-quoted
  strings but not single-quoted ones. When embedding inline JSON in a
  shell argument, use single quotes around literal JSON or build the
  object with `@{...} | ConvertTo-Json` to avoid escape hell.
- **Here-strings (`@' ... '@`):** the closing `'@` MUST be at column 0
  (no indentation) or PowerShell won't recognize it. Same for `@" ... "@`.
- **Temp paths:** always write Playwright `.ts` scripts to `.\.scratch\`
  (inside the project), NOT `$env:TEMP`. Node resolves bare imports like
  `import 'playwright'` by walking up from the script's location; if the
  script lives outside the project tree it can't find `node_modules\playwright`.
  Other scratch artifacts (rendered HTML, JSON configs) live in `.\.scratch\`
  too for consistency. The folder is gitignored.
- **Line endings in JSON files:** `Set-Content -Encoding UTF8` writes a
  BOM on Windows PowerShell 5.1, which some servers reject. If the PUT
  fails with a parse error, switch to `[System.IO.File]::WriteAllText($path, $json, [System.Text.UTF8Encoding]::new($false))`
  to write UTF-8 without BOM.
- **`npx tsx` first run:** on a fresh machine it may pull `tsx` from the
  registry on first invocation. Run it once interactively before the
  skill kicks off to warm the cache, otherwise the first dry-run can
  appear to hang for 10-20s.
- **Playwright browsers:** if `chromium.launch()` fails with "Executable
  doesn't exist", run `npx playwright install chromium` once.
