---
name: 'addsite'
description: 'Onboard one or many jobs-listing sites end-to-end: accepts a single URL, multiple URLs, a plain-text file, or a CSV/Google-Sheets export; auto-skips blockers (login walls, unreachable, 0-item dry-runs, etc.) with SKIPPED + adminNote; prints an end-of-run summary table. Single-URL and batch modes share the same pipeline.'
platform: 'windows-powershell'
---

<!-- CANONICAL SOURCE — do not edit copies directly.
     Edit THIS file (addsite.md at the repo root), then run `pnpm sync:addsite`.
     Copies kept in sync:
       • .claude/commands/addsite.md  (CI-checked — drift blocks merges to main)
       • ~/.cursor/skills/addsite/SKILL.md  (hardlinked locally by sync script)
     If you see this comment in a copy, that copy is stale — run `pnpm sync:addsite`. -->

# /addsite — onboard a jobs site end-to-end (Windows / PowerShell)

You are operating as the scrapnew onboarding agent. The user invoked
`/addsite` with one URL, multiple URLs, or a file/CSV path.
Your job is to take each URL all the way from "never seen" to
"first scrape returned valid jobs" without losing them in side-quests.
In batch mode (more than one URL) you NEVER pause for user input — every
blocker is auto-skipped with a note and you continue to the next URL.

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

**Single URL** (original mode):
```
/addsite https://hr.technion.ac.il/positions/
```

**Multiple URLs** (batch mode — space-separated):
```
/addsite https://a.com/jobs https://b.com/careers https://c.co.il/משרות
```

**From a plain-text file** (one URL per line, `#` for comments):
```
/addsite --file urls.txt
```

**From a CSV or Google Sheets export** (Google Sheets → File → Download → CSV):
```
/addsite --csv career_pages.csv --column "Career Page"
/addsite --csv career_pages.csv --column "Career Page" --company-col "Company Name" --limit 20 --start 5
```

**Common batch flags** (all optional):
- `--force` — re-attempt URLs already in `SKIPPED` or `FAILED` status
- `--max-urls N` — safety cap (default 50; refuse larger batches without this flag)
- `--limit N` / `--start N` — slice into the file/CSV for cheap partial runs
- `--resume <path>` — path to a previous `batch-results.jsonl`; skip already-processed URLs

If invoked with no arguments, respond once: "Usage: /addsite <URL> [URL…] [options]" and stop.

**Detect batch vs single-URL mode** by counting the effective URLs after parsing. If ≥ 2 URLs: batch mode. If 1 URL: single-URL mode (Steps 1–9 as before, no batch log required, though you may still use `addsite-batch.ts log` for consistency).

## Batch mode — autonomous multi-URL onboarding

> Skip this section entirely when running single-URL mode.

### B0 — Parse URL list and initialise batch context

Run `addsite-batch.ts parse` to normalise, deduplicate, and classify all
input URLs, then record the batch directory for use in subsequent steps.

```powershell
# Example — adapt flags to match actual invocation:
$parsedOut = npx tsx scripts/addsite-batch.ts parse `
  --csv 'career_pages.csv' --column 'Career Page' --limit 20

# Capture the batch dir from the last stdout line (format: BATCH_DIR:<path>)
$BATCH_DIR = ($parsedOut | Select-String 'BATCH_DIR:').ToString() -replace 'BATCH_DIR:',''
Write-Host "Batch dir: $BATCH_DIR"

# Read the work list to iterate
$workList = Get-Content (Join-Path $BATCH_DIR 'work-list.json') | ConvertFrom-Json
```

`parse` automatically logs `ALREADY_ACTIVE`, `SKIP_PRIOR`, `DUPLICATE_IN_BATCH`,
and `INVALID_URL` entries to `batch-results.jsonl`. Only entries with
`preStatus = "PROCEED"` need to be run through Steps 1–9.

### B1 — Iterate

For each entry in `$workList` where `preStatus -eq 'PROCEED'`:
1. Set `$URL = $entry.normalizedUrl` and `$SITE_ID = $entry.existingId` (may be `$null`).
2. Run Steps 1–9 with the **batch overrides** below.
3. At every gate failure: call `addsite-batch.ts skip` + `addsite-batch.ts log`, then `continue`.
4. On success: call `addsite-batch.ts log --outcome ACTIVE --jobs <N>`.

```powershell
foreach ($entry in ($workList | Where-Object { $_.preStatus -eq 'PROCEED' })) {
  $URL     = $entry.normalizedUrl
  $SITE_ID = $entry.existingId     # may be $null (new site)

  # ... Steps 1-9 with batch overrides below ...
  # On any auto-skip gate (see matrix):
  #   npx tsx scripts/addsite-batch.ts skip --url $URL --reason "<reason>" --batch-dir $BATCH_DIR [--site-id $SITE_ID]
  #   continue
  # On success:
  #   npx tsx scripts/addsite-batch.ts log --batch-dir $BATCH_DIR --url $URL --outcome ACTIVE --reason "" --site-id $SITE_ID --jobs $jobCount
}
```

### B1.5 — Reactivating an existing SKIPPED / FAILED site (`--force`)

When `$SITE_ID` points to an **existing** site that is currently `SKIPPED`
(re-onboarded via `--force`) or `FAILED`, you cannot just PUT config and PATCH
ACTIVE — two traps:
- **Transition rules:** `SKIPPED` may ONLY transition to `ANALYZING`
  (`SKIPPED → REVIEW`/`ACTIVE` are rejected with 400). A fresh-from-`SKIPPED`
  site must route `SKIPPED → ANALYZING → REVIEW → ACTIVE`.
- **Analyzer clobber:** the `→ ANALYZING` transition **queues a new ANALYSIS
  job** that re-derives and **overwrites `fieldMappings`**. If you PUT your
  config before the analyzer finishes, it gets clobbered.

So the **only reliable order** is: force re-analysis, wait for it to settle,
THEN write your config so it wins the race:

```powershell
# Only when the existing site is SKIPPED (or FAILED and you want a clean re-run):
$cur = ((Invoke-RestMethod -Method Get -Uri "$BASE/api/sites?id=$SITE_ID" -Headers $HEADERS).data |
        Where-Object { $_.id -eq $SITE_ID } | Select-Object -First 1).status
if ($cur -eq 'SKIPPED') {
  Invoke-RestMethod -Method Patch -Uri "$BASE/api/sites/$SITE_ID" -Headers $HEADERS `
    -ContentType 'application/json' -Body (@{ status = 'ANALYZING' } | ConvertTo-Json -Compress) | Out-Null
  for ($i = 1; $i -le 30; $i++) {              # wait for analyzer to leave ANALYZING (~30-60s)
    Start-Sleep -Seconds 5
    $cur = ((Invoke-RestMethod -Method Get -Uri "$BASE/api/sites?id=$SITE_ID" -Headers $HEADERS).data |
            Where-Object { $_.id -eq $SITE_ID } | Select-Object -First 1).status
    if ($cur -ne 'ANALYZING') { break }        # settled to REVIEW (or FAILED)
  }
}
# Now proceed with Step 6 (PUT config) + Step 7 (verify gate) + activate.
# Because the analyzer has already run, your PUT wins; the Step 7 gate covers any residual race.
```

The `createScrapeRun` API accepts `ACTIVE`, `REVIEW`, or `FAILED`, so after the
PUT you can PATCH `REVIEW → ACTIVE` and scrape normally. **Prefer deleting the
site and re-adding it fresh** if you don't need to preserve its id — a brand-new
site starts at `ANALYZING` and avoids this dance entirely (the analyzer still
runs once up front, but the skill's Step 6 PUT naturally lands after it).

### B2 — Auto-skip gate matrix

**Every blocker uses this one-liner pattern** (adapt `--reason`):

```powershell
npx tsx scripts/addsite-batch.ts skip --url $URL --reason "<reason>" --batch-dir $BATCH_DIR [--site-id $SITE_ID]
npx tsx scripts/addsite-batch.ts log  --batch-dir $BATCH_DIR --url $URL --outcome SKIPPED --reason "<reason>" [--site-id $SITE_ID]
continue   # move to next URL
```

| Step | Trigger | Reason string |
|------|---------|---------------|
| Step 3 reachability | Gate exit 3 (network/captcha/IL-IP) | `Auto-skipped: unreachable (gate exit 3)` |
| Step 3 reachability | UA-WAF detected | First **apply the UA override within budget** (B2a/B2b Incapsula entry). Only if the block survives the override: `Auto-skipped: WAF survives UA override` |
| Step 3b fetch | Bot challenge page (Cloudflare/Reblaze in HTML) | `Auto-skipped: bot challenge page detected` |
| Step 4 structure | No repeating job-listing structure in HTML | `Auto-skipped: no jobs listing detected in page structure` |
| Step 5 dry-run | < 3 items after **2 selector iterations** | `Auto-skipped: dry-run found N items after 2 iterations` |
| 5b exit 7 | Login-gated apply flow | `Auto-skipped: apply requires login (signal)` — see 5b-LOGIN |
| 5b exit 2 | Form capture fail | Do **not** skip; continue with `formCapture: null` |
| Step 7 verify | Config never sticks after 3 re-PUTs (analyzer race) | `Auto-skipped: analyzer kept overwriting config (3 attempts)` |
| Step 8 scrape | FAILED, or low jobs vs dry-run | First run the Step 8 mismatch re-verify (re-PUT + re-scrape **once**). Only if it still fails: `Auto-skipped: test scrape produced 0 jobs` |
| Step 9 completeness | Only partial data extractable (see B2.5) | `Auto-skipped: only partial data (no description + no apply path); detail pages blocked` |
| Step 9 apply-usability | Descriptions OK but apply is login- or bot-challenge-gated with no alternative (see B2.5) | `Auto-skipped: no usable apply path (login/bot-challenge blocks apply)` |
| Any step | Remediation budget exhausted — 3 fixes used, 2 no-progress steps, or 15 min cap (see B2a) | `Auto-skipped: remediation budget exhausted (<what was tried>)` |

### B2a — Remediation budget (give fixes room, stay bounded)

Batch mode is allowed — and expected — to **fix** the problems it
recognizes (not just give up at the first blocker). The old rigid
"one re-scrape, two iterations" caps conflated two different things:
*blind retries* (re-running the same failing action — always bad) and
*signal-triggered remediations* (recognizing a specific failure
signature and applying a known fix — good). The budget below permits the
second while making the first impossible.

**Three guardrails — these make the budget provably terminate:**

1. **Signal-gated.** A remediation may run **only** when a recognized
   failure signature is present, and the fix must come from the
   **Remediation catalog (B2b)**. No improvising fixes that aren't in the
   catalog — if you can't name the signal and the matching catalog entry,
   don't act, SKIP.
2. **One-shot per distinct fix.** Each catalog remediation is attempted
   **at most once** per URL. If you apply it and the signal persists
   unchanged, that fix is **exhausted** — never repeat the same fix
   hoping for a different result.
3. **Total cap + progress requirement.** Hard ceilings per URL:
   - **≤ 3 distinct remediations** per URL.
   - **≤ 1 re-scrape per applied remediation** (a re-scrape is only
     justified by a config change from a remediation, never blind).
   - **Stop after 2 consecutive no-progress steps** — if two
     remediations in a row don't change the observed signal/state
     (same block markers, same item count, same missing fields), stop
     and SKIP.
   - **15-minute wall-clock backstop per site** — if you've spent ~15 min
     on one URL, SKIP even if remediations remain. (The count + no-progress
     rules normally stop you well before this; it's just a backstop so one
     stubborn site can't eat the whole batch.)

When the budget is exhausted (count, no-progress, or time), SKIP with
`Auto-skipped: remediation budget exhausted (<what was tried>)` and
`continue`.

**Invariants that always hold (independent of the budget):**

- **Doctor runs once** at batch start, not per URL.
- **No scrape for SKIPPED paths.** Sites that hit a B2 gate are skipped
  without a scrape.
- **Per-URL scratch isolation.** Create `.scratch/batch-<id>/<host>/`
  per URL so Playwright artifacts don't clobber each other.
- **Partial data ⇒ SKIPPED, never ACTIVE** (see B2.5). A scrape that
  returns only title/location stubs because the detail pages
  (descriptions + apply form) couldn't be reached is NOT a success — log
  it `SKIPPED`.

### B2b — Remediation catalog (the only sanctioned fixes)

Each entry: **trigger signal → sanctioned fix → exhausted when.** Drawing
a fix from this catalog counts as one remediation against the B2a budget.
Anything **not** listed here → do **not** improvise → SKIP.

- **Incapsula/Imperva `HeadlessChrome` block** (tiny HTML with
  `Request unsuccessful` / `_Incapsula_Resource` / incident id, on listing
  or detail pages) → add `browserOverrides.userAgent` real-desktop-Chrome
  UA (Step 3 "Incapsula/Imperva on detail pages" recipe) → **exhausted**
  if the block markers persist after the override.
- **Lazy / infinite-scroll / 0-items-but-JS-list** (HTML has the framework
  shell but the dry-run finds 0–1 items) → longer `networkidle` wait +
  scroll loop, or the matching framework recipe in Step 4 → **exhausted**
  if the item count is unchanged after the wait/scroll.
- **Wrong / low-yield itemSelector** (dry-run < 3 items but the page
  clearly lists more) → re-pick the `itemSelector` (this is where the
  prior "2 selector iterations" live) → **exhausted after 2 selector
  picks**.
- **Analyzer clobber** (config doesn't stick — Step 7 verify shows the
  stored config overwritten) → re-PUT + re-verify (Step 7 loop) →
  **exhausted after 3 re-PUTs**.
- **Description / apply on detail pages** (B2.5 partial data: listing has
  only title/snippet, the real content is on per-job pages) → switch to a
  multi-page `pageFlow` config + capture the detail-page description and
  `formCapture` → **exhausted** if the detail pages stay blocked after the
  Incapsula UA remediation above.
- **Paginated listing missing jobs** (dry-run yields only the first page
  while the site paginates) → follow pagination / "next" in `pageFlow` →
  **exhausted** if following pages yield no new items.
- **Form capture fails** (5b exit 2) → **not** a remediation; continue
  once with `formCapture: null` (no retry loop).
- **Catch-all:** any failure whose signature is **not** in this catalog →
  do NOT improvise a fix → SKIP with the appropriate B2 reason.

### B2.5 — Data-completeness gate (partial data ⇒ SKIPPED)

**A site is only ACTIVE-worthy if the scraped jobs are actually useful to a
job seeker.** "Useful" means each job has, at minimum, a **description**
*and* a **usable apply path**. A *usable* apply path is one the product can
actually act on: an apply form via `formCapture`, OR an `applicationInfo`
email, OR a plain external apply URL/form **reachable without a login or a
bot-challenge**, OR a reachable `detailUrl` that contains one of those.

Two distinct ways a site fails this gate:

- **Partial data** — a scrape that returns rows with only `title` + `location`
  because the per-job detail pages that hold the description and apply form were
  blocked (WAF/Incapsula/challenge). (The bankhapoalim lesson: wrongly shipped
  ACTIVE as 3 title-only stubs on the first batch pass.)
- **No *usable* apply path** — the jobs have full descriptions, but the only way
  to apply is blocked for us: a **login/account wall** (see 5b-LOGIN) OR a
  **bot-challenge (Cloudflare Turnstile / reCAPTCHA) our submit runtime can't
  pass today**, with no alternative (email / plain URL / inline form). A
  clickable apply URL that dead-ends at such a gate does **NOT** count as an
  apply path — leaving the site ACTIVE would falsely imply it's appliable. (The
  L'Oréal lesson: shipped ACTIVE with a Turnstile-gated apply; the Turnstile
  fires right after the resume-method step, so the apply is unusable for
  auto-submit — siteId `cmq6gxn3g001r01m9pfjejdhe`, later flipped to SKIPPED.)

In batch mode, either failure is logged **`SKIPPED`, not `ACTIVE`** — even when
the scrape itself succeeded and the descriptions are complete. It's fine to let
the scrape run first; the apply-usability verdict sets the **final** status to
SKIPPED.

Decision procedure, run right before you would log `ACTIVE` (Step 9):

1. **Is the site genuinely single-page?** If the full description is on the
   listing AND a **usable** apply path is on the listing (inline form, or an
   email / plain external apply link reachable without a login/challenge), the
   data is **complete** — log `ACTIVE`. Sites like halilit (apply-by-email) and
   eimsys (inline accordion form) are complete, NOT partial. Do not skip these.
2. **Does the site have per-job detail pages** (the listing only shows a
   title/snippet and links to `/job/123`-style pages) that hold the
   description / apply form? If yes and your config did **not** capture a
   description AND did not capture any apply path, the detail pages are the
   problem.
3. **Before skipping, try to actually reach the detail pages** — this is
   cheap and deterministic and is what would have saved bankhapoalim. Draw
   the relevant fixes from the **remediation budget (B2a/B2b)** — they
   count against the per-URL budget, each one-shot:
   - Run the **Incapsula/HeadlessChrome UA-override probe** from Step 3
     ("Incapsula/Imperva on detail pages") against one concrete detail URL
     (catalog: *Incapsula UA override*).
   - If the real-UA override unblocks it, add `browserOverrides.userAgent`,
     switch to a multi-page (`pageFlow`) config with the detail-page
     description + `formCapture` (catalog: *description/apply on detail
     pages*), re-PUT, and re-scrape (the one re-scrape that remediation
     permits). If jobs now have descriptions + apply form → log `ACTIVE`.
   - These are signal-gated, one-shot remediations within the budget — not
     a loop. Once exhausted (block survives the override, or budget spent),
     stop and SKIP.
4. **If the detail pages are still blocked** after the UA-override attempt
   (true IP/captcha wall, or a challenge that survives UA changes), the site
   can only yield title/location stubs → **`SKIPPED`** with reason
   `Auto-skipped: only partial data (no description + no apply path); detail pages blocked`.
   Use the standard skip+log one-liner from B2 and `continue`.
5. **Is the apply path usable?** Independently of data completeness — run this
   even when descriptions are complete and the scrape succeeded. If the only
   apply route is a **login/account wall** or a **bot-challenge
   (Turnstile/reCAPTCHA) our submit runtime can't pass today**, with no email /
   plain-URL / inline-form alternative, the site is **not appliable** →
   **`SKIPPED`** with reason
   `Auto-skipped: no usable apply path (login/bot-challenge blocks apply)`.
   Set the **final** status to SKIPPED rather than ACTIVE. To confirm a
   challenge (rather than assume one), drive the apply one step past the
   method/Apply button: an interstitial titled e.g. "verify you are human" with
   a Cloudflare Ray ID is a Turnstile. If our runtime later gains
   Turnstile-solving, such sites requalify as ACTIVE.

In single-URL mode, do the same assessment but instead of auto-skipping,
report the finding (partial data, or no usable apply path) to the user and ask
whether to ship the listing-only config anyway or stop.

### B3 — Print summary (mandatory last step in batch mode)

After iterating all URLs:

```powershell
npx tsx scripts/addsite-batch.ts summary --batch-dir $BATCH_DIR
```

This prints the summary table to stdout and writes `$BATCH_DIR/summary.md`:

```
======================================================================
Batch complete — 12 URLs processed
======================================================================
  ACTIVE                  4
  SKIPPED                 6
  ALREADY_ACTIVE          1
  ERROR                   1
  API scrapes triggered:  4
======================================================================

|   # | URL                                                    | Outcome          | Site ID          | Reason / Jobs                              |
|-----|--------------------------------------------------------|------------------|------------------|--------------------------------------------|
|   1 | https://cisecurity.wd1.myworkdayjobs.com/CIS_External  | SKIPPED          | cmq55ac8p000m... | Auto-skipped: apply requires login (pas... |
|   2 | https://example.com/careers                            | SKIPPED          | cmq12345...      | Auto-skipped: dry-run found 0 items        |
|   3 | https://good-site.co.il/jobs                           | ACTIVE           | cmq99999...      | 47 jobs scraped                            |
|   4 | https://existing.com/jobs                              | ALREADY_ACTIVE   | cmq77777...      | existing site is ACTIVE; skipped           |
```

### B4 — Cost visibility

Include in your final batch report:
- Total Playwright browser sessions launched (one per PROCEED URL that passes reachability)
- Total scrapes triggered (ACTIVE count)
- Link to `$BATCH_DIR/summary.md` for the full table
- **Candidate learnings** — after the summary table, append ONE consolidated
  block per **"Declaring candidate learnings (both modes)"** (near the end of
  this skill): a `LEARNING (candidate): …` block for each generalizable fix you
  applied anywhere in the batch (deduplicated across URLs), or the single line
  `No candidate learnings this run.` if none qualify.

---

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
- Status is `ACTIVE`:
  - **Single-URL mode**: ask the user to confirm re-onboarding (it will trigger
    ACTIVE → REVIEW). Stop and report if not explicitly told to proceed.
  - **Batch mode**: log `ALREADY_ACTIVE` and `continue` to next URL — never ask.
    (`addsite-batch.ts parse` already logs this; no extra action needed here.)
- Status is `FAILED` / `SKIPPED`: reuse the id, skip to step 3.

```powershell
if ($existing.data -and $existing.data.Count -gt 0) {
  $SITE_ID = $existing.data[0].id
  $STATUS  = $existing.data[0].status
  Write-Host "Found existing site $SITE_ID (status=$STATUS)"
  if ($STATUS -eq 'ACTIVE') {
    # BATCH MODE: already handled by parse; this branch only runs in single-URL mode.
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

Site is created in `ANALYZING`, and **the server enqueues an ANALYSIS
workerJob into the same FIFO queue the scraper uses.** The worker process
is single-threaded and FIFO — one job at a time, oldest first (see
`worker/index.ts`: a single `isProcessing` guard plus a
`findFirst({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" } })`
poll every 5s). When that ANALYSIS job runs it **re-derives
`fieldMappings`, overwrites whatever config you PUT, and resets the site to
`REVIEW`.**

You may proceed **immediately** to the *local* discovery work (Steps 3–5b:
reachability, fetch, dry-run, form capture) — those run in your own
Playwright, cost the analyzer nothing, and overlapping them with the
analysis is free and fast.

**But you MUST NOT PUT config (Step 6) until the site has left
`ANALYZING`.** The "double-PUT wins the race" trick in Step 6 only works if
the analyzer has *already* run before your PUT. The worker is slow and FIFO,
so for a freshly-created site the ANALYSIS job is usually still pending when
you'd PUT — it then runs *after* your PUT and clobbers it, and your scrape
runs against the analyzer's bad selectors (0 jobs, or junk like nav/menu
rows). This bit a real 4-site batch on 2026-06-09: all four shipped
0/garbage on the first pass because scrapes were triggered before the
analyzer had run; re-PUTting after it settled fixed all four (msh, hamat,
loreal, rad).

So, right before Step 6, **gate on the analyzer settling**:

```powershell
# Wait for the auto-analyzer to leave ANALYZING (-> REVIEW) before Step 6.
for ($i = 1; $i -le 60; $i++) {
  $st = ((Invoke-RestMethod -Method Get -Uri "$BASE/api/sites?id=$SITE_ID" -Headers $HEADERS).data |
         Where-Object { $_.id -eq $SITE_ID } | Select-Object -First 1).status
  if ($st -ne 'ANALYZING') { Write-Host "[analyzer] settled to $st"; break }
  Start-Sleep -Seconds 5
}
```

Because the worker serializes everything, a single in-flight scrape/analysis
elsewhere can make this wait several minutes — that's expected. Doing your
local Steps 3–5b first usually means the analyzer has already finished by the
time you reach this gate. Note this is the *creation-time* analyzer only;
PUTting config and PATCHing `REVIEW -> ACTIVE` do **not** re-trigger it, so
once it has run your config is the last writer and sticks. (The Step 7
verify gate stays as a backstop for any residual race.)

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

> **⚠️ The gate only proves the LISTING is reachable — it does NOT
> prove detail/apply pages are.** A site can PASS bare on the listing
> URL yet have *secondary* pages (per-job detail pages, the apply form
> page) behind a WAF that rejects the default headless UA. This is the
> exact trap that shipped bankhapoalim.co.il as listing-only on the
> first pass. For any multi-page (`pageFlow`) site, OR any site where
> the apply form lives on a detail page, **re-run the same bare-vs-
> real-UA comparison against one concrete detail URL** before deciding
> the detail pages are unreachable. See the
> "Incapsula/Imperva on detail pages" recipe below.

#### Incapsula/Imperva (`HeadlessChrome` UA block) on detail pages

The single most common reason a detail/apply page "can't be reached"
while the listing loads fine is **Imperva/Incapsula blocking the
bundled Chromium's default `HeadlessChrome` user-agent.** The default
UA Playwright sends is literally
`Mozilla/5.0 (...) HeadlessChrome/<version> Safari/537.36` — the
`HeadlessChrome` token (and the matching `sec-ch-ua` brand) is a strong
automation signal that Incapsula returns a challenge page for
(`<iframe ... _Incapsula_Resource ...>Request unsuccessful. Incapsula
incident ID: ...`). The worker masks `navigator.webdriver` but does
**not** override the UA by default (see `worker/lib/playwright.ts`), so
these pages block.

How to recognise it (vs a true IP/captcha wall):
- The blocked HTML is tiny (≈800–1000 bytes) and contains
  `Request unsuccessful` / `_Incapsula_Resource` / an `incident_id`.
- It blocks even when you navigate to the listing first (same context,
  cookies set) and then `goto` the detail page.

The fix — **`browserOverrides.userAgent` set to a normal desktop Chrome
UA** (drop the `HeadlessChrome` token; keep the major version close to
the bundled Chromium so `sec-ch-ua` stays self-consistent). Find the
bundled version with:

```powershell
npx tsx -e "const {chromium}=require('playwright');(async()=>{const b=await chromium.launch({headless:true});const c=await b.newContext();const p=await c.newPage();console.log(await p.evaluate(()=>navigator.userAgent));await b.close();})();"
```

If it prints `... HeadlessChrome/148.0.7778.96 ...`, use
`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML,
like Gecko) Chrome/148.0.0.0 Safari/537.36` as the override (just
`HeadlessChrome/<full>` → `Chrome/<major>.0.0.0`). Verify it actually
unblocks a detail page using the **worker-parity stealth** (the worker
already launches with `--disable-blink-features=AutomationControlled`
and an init script that sets `navigator.webdriver=false`):

```powershell
$probe = @'
import { chromium } from 'playwright';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';
async function test(label: string, useUA: boolean) {
  const b = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-blink-features=AutomationControlled','--lang=he-IL'] });
  const c = await b.newContext({ viewport:{width:1280,height:800}, ...(useUA?{userAgent:UA}:{}), locale:'he-IL', timezoneId:'Asia/Jerusalem', extraHTTPHeaders:{ 'Accept-Language':'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' } });
  await c.addInitScript(() => { Object.defineProperty(navigator,'webdriver',{get:()=>false}); });
  const p = await c.newPage();
  await p.goto(process.argv[2], { waitUntil:'domcontentloaded' });                 // listing first (set cookies)
  await p.waitForLoadState('networkidle',{timeout:6000}).catch(()=>{});
  await p.goto(process.argv[3], { waitUntil:'domcontentloaded' });                 // a concrete detail URL
  await p.waitForTimeout(4000);
  const html = await p.content();
  console.log(`${label}: blocked=${/Request unsuccessful|_Incapsula_Resource/i.test(html)} bytes=${html.length}`);
  await b.close();
}
(async () => { await test('worker-parity (no UA)', false); await test('+ real-UA override', true); })();
'@
Set-Content .\.scratch\detail-ua-probe.ts $probe -Encoding UTF8
npx tsx .\.scratch\detail-ua-probe.ts "<listing URL>" "<one detail URL>"
```

If `worker-parity` is `blocked=true` but `+ real-UA override` is
`blocked=false`, add the `browserOverrides.userAgent` (plus
`accept-language` header) to the Step 6 config and proceed with a normal
multi-page onboarding — descriptions and apply form will work. Your
Step 5 detail dry-run and Step 5b form capture for this site must also
use the same UA + stealth locally, or they'll hit the same block.
Reference: bankhapoalim.co.il (siteId `cmq68fw91001101m9jpejoc9x`) —
lobby passes bare, `/he/node/*` detail pages need the UA override; once
set, all jobs get full descriptions + the live Drupal apply webform.

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
  - **department** / **location** — secondary text on the row. If the
    listing has **no** structured location field and the city only appears
    in prose, the worker's IL gazetteer auto-fills `location` from the
    description for *some* jobs (only those naming a token it recognizes),
    so coverage is partial and inconsistent. For a **single-office**
    employer where every role is at the same site, inject a **constant**
    location via `setupScript` (a hidden `[data-loc]` span on each item,
    mapped as `location: { selector: '[data-loc]' }`) so all jobs get it.
    Verified on msh.co.il Migdal Capital Markets (siteId
    `cmq6gxm6y001p01m9k3k3pwyv`): only 2/6 jobs got a gazetteer location;
    injected a constant `תל אביב`. Caveat: only do this when you're
    confident every posting shares that location.
  - **externalJobId** — the worker dedupes jobs across re-scrapes on this
    value, so it MUST be **stable** (same job → same id every scrape) and
    **unique** per job. Prefer, in order:
    - element with `data-job`, `data-job-id`, `data-id` attr → set
      `extractAttr` to that attribute name.
    - **per-item hidden form input** carrying a CMS post id — common on
      WordPress/Elementor "now hiring" pages where each job's inline apply
      form has `<input type="hidden" name="queried_id" value="215">` (the
      job's post id, unique per item even though `post_id`/`referer_title`
      are page-level constants). Map it with
      `selector: 'input[name="queried_id"]'`, `extractAttr: 'value'`. This
      is a true native id — prefer it over any synthesized hash. Verified
      on eimsys.co.il (siteId `cmq68viva001b01m902an8gzs`).
    - text in a column like `"REQ-1234"` — extract as text.
    - if the listing only links to detail pages with no separate ID, use
      the same `<a href="...">` as a stable per-job id (the worker will
      store the URL path as `externalJobId`).
    - **Don't map a framework-internal anchor as the id.** A Bootstrap
      accordion toggle `href="#collapse-21421"` or a tab `aria-controls`
      is an *internal widget id*, NOT the job's id — and it usually differs
      from the visible job number. If the header shows a real
      `"מס' משרה: NNNN"`, extract that number via `setupScript` (regex
      `/משרה\D*?(\d+)/` against the header text) rather than mapping the
      `#collapse-…` href. Verified on msh.co.il Migdal Capital Markets
      (siteId `cmq6gxm6y001p01m9k3k3pwyv`): the accordion href was
      `#collapse-21421` while the real `מס' משרה` was `4066`. (A single
      page-level apply form — e.g. one shared Contact Form 7 for the whole
      careers page, with no per-job apply link or hidden job-id input —
      means `externalJobId` is pure dedup metadata and safe to change
      without touching the apply flow.)
    - **Native id on SOME items but not all?** Don't discard the real ids
      just because they're sparse. Build a **hybrid** in `setupScript`: use
      the native id when present, fall back to a content hash otherwise (see
      "Synthesizing a stable externalJobId" → hybrid recipe below). This is
      common on IL sites that print a `"מס' משרה: NNN"` for a few postings
      and nothing for the rest — scan for the native id first, hash only the
      remainder. Verified on hamat-group.co.il (siteId
      `cmq6gxlnk001n01m99axjfu8u`): 2/12 jobs carry a number (`002`/`003`),
      the other 10 get `h-<hash(title)>`.
    - **No native id anywhere?** Synthesize one from **stable content**
      via `setupScript` (see "Synthesizing a stable externalJobId" below).
      **Never include the row index / position** in a synthesized id —
      reordering or adding/removing a job shifts every index and re-keys
      unrelated jobs on the next scrape (mass duplicate/churn). Hash
      `title` + a disambiguator (location/branch/company) instead.
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

Third pattern — **synthesize a stable `externalJobId` when the site has
no native id.** Some listings (a plain `<table>`, a `<ul>` of `<div>`s
with no ids/links) expose nothing usable as a job id. The worker dedupes
on `externalJobId`, so you must produce one — but it has to be
**reorder-proof**. The wrong way is `index + title` (the row position
re-keys every job the moment the site adds/removes/reorders a posting,
and an empty id collapses all rows into one deduped job). The right way
is a deterministic hash of **stable content only** — the title plus a
disambiguator (branch/location/company) so two same-title roles at
different sites stay distinct:

```js
function haideHash(s){var h=5381,i=s.length;while(i){h=(h*33)^s.charCodeAt(--i);}return (h>>>0).toString(36);}
document.querySelectorAll('#page_show_content table').forEach(function (t) {
  if (t.querySelector('[data-ex-id]')) return;
  var tds = t.querySelectorAll('td');
  if (tds.length < 2) return;
  var titleEl = tds[0].querySelector('h2');
  var title = titleEl ? titleEl.textContent.replace(/\s+/g, ' ').trim() : '';
  if (!title) return;
  var branch = '';                                   // disambiguator (here: red-styled branch span)
  tds[0].querySelectorAll('span').forEach(function (s) {
    if (/ff0000/i.test(s.getAttribute('style') || '')) {
      var t2 = (s.textContent || '').replace(/\s+/g, ' ').trim();
      if (t2) branch = t2;
    }
  });
  var key = (title + '|' + branch).toLowerCase().replace(/\s+/g, ' ').trim();
  var idspan = document.createElement('span');
  idspan.setAttribute('data-ex-id', '1');
  idspan.style.display = 'none';
  idspan.textContent = 'h-' + haideHash(key);         // e.g. "h-1a2b3c" — stable across reorders
  tds[0].appendChild(idspan);
});
```

Paired mapping is just `"externalJobId": { "selector": "[data-ex-id]", ... }`.
Notes:
- The hash makes the id compact and ASCII-safe (avoids RTL/Hebrew bytes
  in the id column). Any small deterministic hash works; keep it pure-JS.
- Choose the disambiguator to match how the site distinguishes otherwise-
  identical postings (branch, city, department, company). If titles are
  already globally unique, hashing the title alone is fine.
- This is **last resort** — always prefer a native id / detail-URL first.
- Trade-off to accept: the id still changes if the site *edits the title
  text*. There's no fix for that when the site exposes nothing more
  stable; it's strictly better than an index-based id.
- Verified on halilit.com (siteId `cmq68mpnq001501m9p50vwgee`) — a plain
  id-less branch table; switched from `index-title` to `h-hash(title+branch)`.

**Hybrid: native id when present, hash fallback otherwise.** When a site
prints a real job number on *some* items but not all (e.g. a `"מס' משרה: 002"`
row that only a few postings carry), don't hash everything — that throws away
the genuine ids. Scan each item for the native id first; only fall back to the
content hash when it's missing. The native ids stay canonical (`002`, `003`)
while the unnumbered jobs get a stable `h-<hash>`:

```js
function haideHash(s){var h=5381,i=s.length;while(i){h=(h*33)^s.charCodeAt(--i);}return (h>>>0).toString(36);}
document.querySelectorAll('div.job').forEach(function (job) {
  if (job.querySelector('[data-ex-id]')) return;
  var titleEl = job.querySelector('.h3.cursor-pointer');
  var title = titleEl ? titleEl.textContent.replace(/\s+/g, ' ').trim() : '';
  var jobNum = '';                                   // native id, if this item has one
  job.querySelectorAll('.job__attribute').forEach(function (a) {
    var full = a.textContent.replace(/\s+/g, ' ').trim();
    if (/מס'?\s*משרה/.test(full)) {                  // "מס' משרה: 002" → "002"
      var d = full.replace(/\D/g, '');
      if (d) jobNum = d;
    }
  });
  if (!title) return;
  var idspan = document.createElement('span');
  idspan.setAttribute('data-ex-id', '1');
  idspan.style.display = 'none';
  idspan.textContent = jobNum ? jobNum : ('h-' + haideHash(title.toLowerCase()));
  job.appendChild(idspan);
});
```

Notes on the hybrid:
- The two id shapes never collide: the hash branch is always `h-`-prefixed,
  so a native `002` can't clash with a synthesized id.
- Accept one trade-off: if the site *later* assigns a number to a
  currently-unnumbered job, that job's id flips from `h-…` to the number once
  and is re-tracked as new. That's a rare, one-time churn — worth it to keep
  the real ids for the jobs that have them.
- Verified on hamat-group.co.il (siteId `cmq6gxlnk001n01m99axjfu8u`).

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
- **Append injected spans to the item root, NOT to an element another
  field already reads.** If `title` maps to `.panel-title__el` and you
  append a hidden `[data-ex-id]`/`[data-loc]` span *inside* that same
  element, its hidden text leaks into the title's `textContent` and
  corrupts the title. Append to the `itemSelector` node (or a child no
  other field reads) instead. (Bit us on msh.co.il, where the id/location
  spans had to go on `.panel.panel-default`, not `.panel-title__el`.)
- Keep it small and pure-JS (no external libs). `await` **is** supported:
  the worker runs the script body as an `AsyncFunction` and awaits it
  (2026-05-31 fix), so top-level `await fetch(...)` enrichments work. Do
  NOT wrap an awaiting script in a self-invoking IIFE — the worker awaits
  the body, and an IIFE would resolve before its inner promise.
- **Multi-page support (fixed 2026-06-03)**: `setupScript` now runs on
  BOTH the listing page AND every detail page of a multi-page
  (`pageFlow`) site. On each detail page the worker runs it right after
  navigation, before field extraction — so detail-scope
  `[data-extracted-*]` injections (slice a job-id out of a heading,
  read an apply email from a `mailto:` link, normalize a description)
  now work the same way they do on the listing. The script runs in
  whatever DOM it lands in, so write it to handle both contexts: e.g.
  `document.querySelectorAll('li.jobItemRow').forEach(...)` is a no-op
  on detail pages (no rows), and a `document.querySelector('a.applyBtn')`
  block is a no-op on the listing. Verified on mei-avivim.co.il (siteId
  `cmpxma4wd000001qnyogf85tl`, `pageFlow=2`): `externalJobId` injected on
  the listing + `applicationInfo` injected on each detail page both
  returned clean values. Reference commit `4fe63e2` in
  `worker/jobs/scrape.ts` (`extractRawFieldsWithPageFlow`).
  - **Cost**: each `runSetupScript` call adds ~1.5s, and on multi-page it
    fires once per detail page. A 10-job multi-page site with a
    setupScript that also `fetch`es each detail took ~65s. Only sites
    that actually set a setupScript pay this; plain multi-page sites are
    unaffected (the calls are gated behind a presence check).
  - **Implication**: the old workaround of "go single-page + async
    `setupScript` that `fetch`es every detail page" is no longer
    necessary just to get clean detail-scope fields — prefer a normal
    multi-page `pageFlow` config and inject detail fields via
    setupScript on the detail page. The single-page+fetch pattern is
    still valid when you ALSO need it for listing expansion (see below).
- **Paginated-listing expansion via `setupScript`**: rewriting a
  paginated listing container with all results (e.g. aman.co.il calling
  its own `/wp-admin/admin-ajax.php?action=data_fetch` to pull 111 jobs)
  works in a **single-page** config (`pageFlow: []`, proven on
  Assuta/NESS). With the 2026-06-03 fix `setupScript` also runs on a
  multi-page listing, so combining listing-expansion with multi-page
  detail visits should now work too — but that specific combination has
  not been re-verified since the fix, so dry-run/scrape-verify it before
  trusting it. If a site has numbered pagination AND needs detail-page
  fields, this is the path to try first.
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
expected text. For a multi-page setupScript, dry-run it on BOTH a
listing page and one detail page (navigate to each, run the script,
then read the injected attrs) since the worker now executes it on both.
Because the worker awaits async scripts, run it via an `AsyncFunction`
in the dry-run too (and ship the `globalThis.__name = (f) => f;` shim
before `evaluate`, or tsx/esbuild's keepNames helper will throw
`__name is not defined`).

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

### Listing completeness — MANDATORY coverage gate

**This is a hard gate, not advice.** You MUST establish the site's true
total job count and compare it to what your config will extract. Skipping
this is how sites silently ship with only page 1 (e.g. NVIDIA Workday
onboarded 2026-05-31 first shipped 20 of 480 jobs because this check was
skipped). Do not mark a site done until one of these holds:

1. `extracted >= total` (full coverage), OR
2. you implemented full coverage (see framework recipes below), OR
3. you got **explicit user sign-off** to ship partial coverage.

**How to find the true total** (in priority order):
- The results header / count element on the page ("480 Results",
  "Showing 1-20 of 480", "47 jobs found"). Read it in your dry-run.
- For known SPA frameworks, the list API returns it directly (see below).
- As a fallback, paginate/scroll to exhaustion and count.

**Every onboarding MUST end with a `coverage: <extracted>/<total>` line**
in the Step 9 report. If you cannot determine the total, say so
explicitly (`coverage: <extracted>/unknown`) rather than omitting it.

#### Known SPA frameworks — detect by host, enumerate via their API

If the listing host matches one of these, the page is an offset-paginated
SPA. The page URL does NOT change between pages, so the worker's `url`
pagination CANNOT drive it. The right approach is a single-page config
(`pageFlow: []`) whose `setupScript` calls the framework's list API to
enumerate ALL postings, rebuilds the listing container with one row per
posting, then (optionally) fetches each detail/description endpoint with
**bounded concurrency + retry/backoff** (these APIs throttle bursts —
HTTP 429 — so cap concurrency ~6 and retry up to 3x; expect ~90-95%
description coverage on a few-hundred-job site, 100% on list-level fields).

- **Workday** (`*.myworkdayjobs.com`): list = `POST /wday/cxs/{tenant}/{site}/jobs`
  with body `{appliedFacets:{}, limit:20, offset:N, searchText:"<q>"}`,
  returns `{ total, jobPostings:[{ title, externalPath, locationsText, postedOn, bulletFields:[reqId] }] }`.
  Per-job detail = `GET /wday/cxs/{tenant}/{site}{externalPath}` →
  `jobPostingInfo.{ jobDescription(HTML), location, additionalLocations,
  startDate, jobReqId, externalUrl }`. Reveal selector
  `a[data-automation-id="jobTitle"]`; item selector
  `[data-automation-id="jobResults"] li:has(a[data-automation-id="jobTitle"])`.
  Reference: NVIDIA (siteId `cmplb58zt000601mvvpvedp8g`) — 480/480 jobs,
  450 descriptions. The working setupScript + paired config is committed
  at `sites/nvidia/setup.js`.
- **Greenhouse** (`boards.greenhouse.io`, `*.greenhouse.io`): list JSON =
  `https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true`
  (one call returns all jobs with `content` = full description HTML).
- **Lever** (`jobs.lever.co`): list JSON =
  `https://api.lever.co/v0/postings/{company}?mode=json` (all postings,
  each with `descriptionPlain`).
- **iCIMS / SmartRecruiters / Ashby**: also API-backed; inspect the
  network tab (filter XHR) for the JSON endpoint and its `total`/paging.
- **Comeet / Spark Hire** (`comeet.com/jobs/...`, `comeet.co`,
  `*.comeet.co`): **NOT an offset-API SPA — do NOT use the enumeration
  recipe, and do NOT auto-skip it as "SPA renders client-side".** Comeet
  embeds all positions in the initial HTML document and Angular hydrates
  them client-side; they render reliably (present even at
  `domcontentloaded`). Use a normal **single-page DOM config** with a
  guarded polling `setupScript` as render-timing insurance:
  - `itemSelector`: `li:has(> a.positionItem)`
  - `title`: `.positionLink`  ·  `detailUrl` + `externalJobId`:
    `a.positionItem` (attr `href`)  ·  `department`:
    `ul.positionDetails li:first-child`
  - **Detail-page fields** (all stable `data-qa` hooks, `capturedOnUrl` = a
    detail URL): `description`: `[data-qa="positionDescription"]` ·
    `requirements`: `[data-qa="positionRequirements"]` (a SEPARATE block from
    description — map it) · `location`: `[data-qa="headerLocation"]`
    (per-position, e.g. "Yiftah, North District, IL") · `employmentType`:
    `[data-qa="headerEmploymentType"]` (e.g. "Full-time" — non-standard key,
    lands in `rawData`/Additional Fields).
  - `pageFlow`: listing URL + a `<listing>/*` detail glob (it's multi-page,
    one detail page per position).
  - **Apply form — use a HARDCODED `formCapture` template, do NOT auto-capture.**
    The Comeet/Spark Hire apply form is a real application form (First/Last
    name, Email, Phone, CV upload, LinkedIn, website, cover letter, portfolio,
    personal note) — NOT login-gated. BUT the `"Apply for this job"` button
    (`[data-qa="applyButton"]`) does **not** mount the form in headless
    Chromium (bot/headless gating) even with scroll + click + 20s wait, so
    capture-form.ts / Step 5b cannot grab it live. Instead, ship the static
    template below as `formCapture`. The worker's `extractFormDataOrFallback`
    tries the live `formSelector` (`form#applyForm`), fails headlessly, and
    falls back to the static `fields[]` blob — surfacing the Application Form
    panel on every job. The form is identical across all Comeet sites, so this
    template is reusable verbatim:
    ```json
    "formCapture": {
      "formSelector": "form#applyForm",
      "actionUrl": "<site listing URL>",
      "method": "POST",
      "fields": [
        { "name": "firstName", "label": "First name", "fieldType": "text", "required": true, "tagName": "input" },
        { "name": "lastName", "label": "Last name", "fieldType": "text", "required": true, "tagName": "input" },
        { "name": "email", "label": "Email", "fieldType": "email", "required": true, "tagName": "input" },
        { "name": "phone", "label": "Phone", "fieldType": "tel", "required": true, "tagName": "input" },
        { "name": "cv", "label": "Resume", "fieldType": "file", "required": true, "tagName": "input" },
        { "name": "linkedin", "label": "LinkedIn Profile URL", "fieldType": "url", "required": false, "tagName": "input" },
        { "name": "websiteUrl", "label": "Personal website", "fieldType": "url", "required": false, "tagName": "input" },
        { "name": "coverLetter", "label": "Cover Letter", "fieldType": "file", "required": false, "tagName": "input" },
        { "name": "portfolio", "label": "Portfolio", "fieldType": "file", "required": false, "tagName": "input" },
        { "name": "comment", "label": "Personal note", "fieldType": "textarea", "required": false, "tagName": "textarea" }
      ]
    }
    ```
  - `setupScript` (waits for the listing to hydrate, no-ops on detail
    pages so it costs nothing on the per-job fetches):
    ```js
    await new Promise((resolve) => {
      if (document.querySelector('[data-qa="positionDescription"]')) { resolve(); return; }
      let tries = 0;
      const timer = setInterval(() => {
        if (document.querySelectorAll('a.positionItem').length > 0 || tries++ > 40) { clearInterval(timer); resolve(); }
      }, 250);
    });
    ```
  - **Always set an `adminNote` on Comeet sites** (PATCH `adminNote` after the
    site is ACTIVE) so the caveat is visible in the dashboard:
    `Comeet/Spark Hire site. Apply form shipped as a static formCapture
    template (it does NOT mount in headless Chromium). Auto-submit will need a
    real/stealth browser session.`
  - Reference: Netafim (siteId `cmq57x5gm000201qpvxa2grkv`) — 6/6 jobs, each
    with title, department, location, employmentType, requirements,
    description, and the 10-field apply-form template above. Earlier this site
    was wrongly auto-skipped as "SPA chrome only" — the real cause was the
    analyzer clobber (Step 7 guard) + the Step 8 dry-run/scrape mismatch (see
    below), not the SPA.

For these, the setupScript pattern is: (1) loop the list API by offset/page
until you've collected `total` postings, (2) `ul.innerHTML=''` then append
one `<li>` per posting with a title `<a>` plus hidden
`[data-extracted-*]` spans (id, detailUrl, location, date), (3) enrich
descriptions via the detail endpoint with concurrency ≤6 and retry. Because
the worker now awaits async `setupScript` (2026-05-31 fix), top-level
`await` works directly in the script body — do NOT wrap it in a
self-invoking IIFE (the worker runs the script source as an AsyncFunction
body and awaits it; an IIFE would resolve before its inner promise).

#### Dynamic-loading detection (when NOT a known API framework)

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
   **Supported** via the `loadMoreSelector` config field
   (`worker/jobs/scrape.ts:clickLoadMoreUntilStable`): the worker clicks
   it repeatedly until the button disappears/disables or item count
   stops growing. Set `loadMoreSelector: "<css>"` in the config PUT.
3. **Numbered pagination** (page 1/2/3) — **Supported** via the
   `pagination` config field (`worker/jobs/scrape.ts:getPaginationConfig`
   / `advanceToNextPage`). Two modes:
   - **`type: "click"`** — `{ type: "click", nextSelector: "<css for Next>",
     maxPages, settleMs }`. Best for SPAs (MUI pagination, etc.) that
     don't change the URL. Worker clicks Next until it disappears/disables
     or the first item stops changing.
   - **`type: "url"`** — `{ type: "url", param: "page"|"paged", start, step,
     maxPages, settleMs }`. Worker re-navigates the listing with an
     incrementing query param (Drupal `start=0`, WordPress `start=1`).
     This **composes with `pageFlow`** — each paginated listing page still
     gets its detail pages visited. Auto-stops when a page repeats the
     previous one or has no items, so a slightly-too-large `maxPages` is
     safe. Verified on unitask-inc.com (`?paged=N`, 31 jobs across 4 pages).
4. **URL-param pagination** (`?page=2`) — same as (3), use `type: "url"`
   with the right `param`. Do NOT onboard the same site multiple times per
   page; one site row with a `pagination` block covers all pages.
5. **Filters** (dropdowns/checkboxes for category, location, etc.) — for
   MVP, **always scrape the unfiltered URL.** That's usually the parent
   listing showing all jobs. Setting filters means more work and
   shouldn't be necessary if the unfiltered list is complete.

**Establish the true total and configure pagination to cover it** — do
NOT silently ship page 1. If the page shows "N of M" or numbered pages,
add the matching `loadMoreSelector` / `pagination` block and re-verify
the scrape count against M.

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

**Batch mode**: remember the passing dry-run `count` as `$DRYRUN_N`. Step 8
compares the test-scrape `jobCount` against it — a scrape returning `<=1`
while `$DRYRUN_N >= 3` is the analyzer-clobber / render-timing signature and
triggers the Step 8 re-verify (NOT an immediate skip).

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

    // Login-wall detection. If the apply destination forces sign-in / account
    // creation before the application form is reachable (Workday "Create
    // Account/Sign In", Greenhouse-via-login, etc.), the auto-submit product
    // can't use this site — flag it so Step 5b/6 marks the site SKIPPED instead
    // of ACTIVE. Mirrors worker/lib/applyGate.ts strong signals (kept inline so
    // this script stays self-contained / runnable from .scratch via tsx).
    const LOGIN_URL_RE =
      /\/(login|log-in|signin|sign-in|sign_in|register|signup|sign-up|sign_up|create-account|createaccount|auth|authentication|sso|oauth2?)(\/|\?|#|$)/i;
    const OAUTH_HOST_RE =
      /(accounts\.google\.|login\.microsoftonline\.|github\.com\/login|linkedin\.com\/(oauth|uas\/login)|\.okta\.com|\.auth0\.com|\.onelogin\.com|login\.salesforce\.)/i;
    const LOGIN_CTA_RE =
      /\b(sign in|log ?in|create an? account|register now|sign up)\b|התחבר|הרשמ|צור חשבון/i;
    let applyRequiresLogin = false;
    let applyLoginReason: string | null = null;
    const finalUrl = page.url();
    if (LOGIN_URL_RE.test(finalUrl) || OAUTH_HOST_RE.test(finalUrl)) {
      applyRequiresLogin = true;
      applyLoginReason = "login-url";
    } else {
      const lw = await page.evaluate(() => {
        const passwordInputs = document.querySelectorAll('input[type="password"]').length;
        const signInAutomation = !!document.querySelector(
          '[data-automation-id="signInContent"],[data-automation-id="signInLink"],[data-automation-id="signInSubmitButton"],[data-automation-id="createAccountLink"],[data-automation-id="createAccountSubmitButton"],[data-automation-id="createAccountCheckbox"]',
        );
        let hasApplyForm = false;
        for (const f of Array.from(document.querySelectorAll("form"))) {
          const file = f.querySelectorAll('input[type="file"]').length;
          const email = f.querySelectorAll('input[type="email"]').length;
          const textish = f.querySelectorAll('input[type="text"],input:not([type]),textarea').length;
          if (file > 0 && (email > 0 || textish > 0)) { hasApplyForm = true; break; }
        }
        const bodyText = (document.body?.textContent || "").replace(/\s+/g, " ").slice(0, 6000);
        return { passwordInputs, signInAutomation, hasApplyForm, bodyText };
      });
      if (lw.passwordInputs > 0) {
        applyRequiresLogin = true;
        applyLoginReason = `password-field(${lw.passwordInputs})`;
      } else if (lw.signInAutomation) {
        applyRequiresLogin = true;
        applyLoginReason = "signin-automation-id";
      } else if (!lw.hasApplyForm && LOGIN_CTA_RE.test(lw.bodyText)) {
        applyRequiresLogin = true;
        applyLoginReason = "login-cta-no-apply-form";
      }
    }
    debug.applyRequiresLogin = applyRequiresLogin;
    debug.applyLoginReason = applyLoginReason;

    const capture = await captureLargestForm(page, args.formSelector);
    const ok = !!capture && capture.fields.length >= args.minFields;
    const out: Record<string, unknown> = { formCapture: capture, applyRequiresLogin, applyLoginReason };
    if (args.debug) out.debug = debug;
    console.log(JSON.stringify(out, null, 2));
    // Always write the apply-gate sidecar so Step 5b/6 can branch to SKIPPED
    // even when no form was captured (a login wall typically has no apply form).
    fs.writeFileSync(
      ".scratch/scrap-apply-gate.json",
      JSON.stringify({ applyRequiresLogin, applyLoginReason, finalUrl }, null, 2),
      "utf8",
    );
    if (args.outPath && capture) {
      // Write directly via Node so the JSON never round-trips through a
      // shell pipe (PowerShell will mangle Hebrew labels otherwise).
      fs.writeFileSync(args.outPath, JSON.stringify(capture, null, 2), "utf8");
      console.error(`[capture-form] wrote formCapture to ${args.outPath}`);
    }
    if (applyRequiresLogin) {
      // Distinct exit code 7 = login-gated apply flow. Step 5b/6 must mark the
      // site SKIPPED (do NOT proceed to ACTIVE or trigger a scrape).
      console.error(
        `[capture-form] LOGIN-GATED apply flow detected (${applyLoginReason}). Final URL: ${page.url()} — site should be SKIPPED, not scraped.`,
      );
      process.exit(7);
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
- `$CAPTURE_EXIT -eq 7` (**login-gated apply flow**): the apply path forces
  sign-in / account creation before the form is reachable (Workday "Create
  Account/Sign In", etc.). This site is unusable for auto-submit. **STOP the
  normal flow and run 5b-LOGIN below** — the site is marked `SKIPPED`, NOT
  `ACTIVE`, and NO scrape is triggered. `.\.scratch\scrap-apply-gate.json`
  holds `{ applyRequiresLogin: true, applyLoginReason, finalUrl }`.
- `$CAPTURE_EXIT -eq 2` (no usable form): **STOP** and run 5b-2 below.
  Do NOT silently fall through to `formCapture=null` — that's the
  pre-existing failure mode this step is designed to fix.
- `$CAPTURE_EXIT -ne 0 -and $CAPTURE_EXIT -ne 2 -and $CAPTURE_EXIT -ne 7`
  (script crashed): iterate once with different selectors / URLs. If still
  failing, proceed to 5b-2.

> **Reaching the apply flow for capture.** Login walls only show up once you
> actually click "Apply". For ATS sites that gate behind an account (Workday
> is the canonical case) drive the script to the apply page, e.g. for Workday:
> `--detail-url=<job detail URL>` plus an `--apply-selector` chain isn't enough
> because Workday's apply is multi-step — instead pass the direct
> `.../job/.../apply/applyManually` URL as `--detail-url`. The script's login
> detection runs on whatever page it lands on, so landing on the
> account-creation step is exactly what trips the `password-field` /
> `signin-automation-id` signal and returns exit 7.

### 5b-LOGIN — Login-gated apply flow → mark SKIPPED

The apply form is behind a sign-in / account-creation wall, so the auto-submit
product can't use this site. Do **not** set it ACTIVE and do **not** scrape.
Instead persist the flag in the site config (so the worker also refuses any
future scrape) and move the site to `SKIPPED`.

1. Read the reason for the report:
   ```powershell
   $gate = Get-Content '.\.scratch\scrap-apply-gate.json' -Raw | ConvertFrom-Json
   Write-Host ("5b-LOGIN: applyRequiresLogin={0} reason={1} url={2}" -f `
     $gate.applyRequiresLogin, $gate.applyLoginReason, $gate.finalUrl)
   ```
2. In the Step 6 config payload (below), set `"formCapture": null`,
   `"applyRequiresLogin": true`, and `"applyLoginReason": "<reason>"`. These
   fold into `fieldMappings._meta` and the worker's `getApplyRequiresLogin()`
   short-circuit reads them.
3. PUT the config (Step 6) as usual so the listing mappings + the
   `applyRequiresLogin` flag are saved.
4. **Skip Step 7's `ACTIVE` PATCH.** Instead PATCH the site to `SKIPPED`:
   ```powershell
   $patch = @{ status = 'SKIPPED' } | ConvertTo-Json -Compress
   Invoke-RestMethod -Method Patch -Uri "$BASE/api/sites/$SITE_ID" `
     -Headers $HEADERS -ContentType 'application/json' -Body $patch
   ```
5. **Do not run Step 8 (scrape).** Report the site as SKIPPED with the login
   reason. Done.

> **Bot-challenge apply gates are the same class of blocker.** A Cloudflare
> Turnstile / reCAPTCHA in front of the apply flow makes the site just as
> unusable for auto-submit as a login wall — but capture usually does NOT
> report it as exit 7 (it tends to return no usable form / exit 2, because the
> challenge appears *after* the method/Apply step). So it isn't caught here;
> it's caught by the **B2.5 "no usable apply path" gate** at end of run. Same
> outcome: SKIPPED, not ACTIVE. See the Avature note below for the canonical
> example.

### Known apply-flow: Avature `ApplicationMethods` (paste method + post-method Turnstile)

L'Oréal-style careers sites on the Avature ATS open apply as a 4-step wizard
(`/jobs/ApplicationMethods?jobId=…`): **method → enter details → additional
questions → consent & submit**. Two things worth knowing:

- **Guest apply via "Copy & Paste" resume.** The method step exposes
  `#methodButton--paste` ("Copy & Paste") → a `textarea#resumePaste` →
  Continue `#uploadPasteResume`, with no login/account required (the "Already
  have an account? Login" box is optional). For auto-submit this is the ideal
  input: paste CV **text**, no file upload. (Avoid the social
  `Continue with Google/Facebook/…` buttons — clicking one bounces into an
  OAuth flow.)
- **But a Cloudflare Turnstile gates step 1 → step 2.** It does **not** appear
  on initial page load — it fires the instant you click Continue past the
  method step, blocking the "Enter application details" form from rendering.
  Headless capture can't pass it, so `formCapture` stays null and the form is
  unreachable. Per the B2.5 usable-apply gate, such a site is **SKIPPED**, not
  ACTIVE (unless our submit runtime can solve Turnstile). Verified on L'Oréal
  Israel, siteId `cmq6gxn3g001r01m9pfjejdhe`.

### 5b-2 — When automatic capture fails

**Batch mode override**: In batch mode, form-capture failure (exit code 2) is NOT
a stopping condition. Continue with `formCapture: null` in the config. Do NOT
log a SKIPPED outcome — log the reason as a note in the final result but keep
the site moving through the pipeline. The apply form will be absent from the
dashboard for this site. Proceed directly to Step 6 with `formCapture: null`.

**Single-URL mode**: Do not pick this branch silently. Print the headless-capture
failure output (URLs tried, form count per page) so the user has context, then
ask the following three questions **in this exact order** (one `AskQuestion`
invocation, three options). Do not invent a fourth option; the three branches
below are the only supported outcomes.

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

**Login-gated apply flow (`applyRequiresLogin`).** Only set when Step 5b
returned exit 7 (see 5b-LOGIN). Add `applyRequiresLogin: true` and
`applyLoginReason: '<reason from .scratch/scrap-apply-gate.json>'` to the
payload, alongside `formCapture: null`. They fold into
`fieldMappings._meta` and the worker's `getApplyRequiresLogin()`
short-circuit (`worker/jobs/scrape.ts`) reads them — any scrape of a flagged
site is turned into a `SKIPPED` transition instead of running. In PowerShell,
building on the `$config` hashtable:
```powershell
$config.formCapture        = $null
$config.applyRequiresLogin = $true
$config.applyLoginReason   = $gate.applyLoginReason   # from 5b-LOGIN step 1
```
After PUT, finish via 5b-LOGIN (PATCH `SKIPPED`, no scrape) — do NOT run
Step 7's ACTIVE PATCH or Step 8's scrape.

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
`userAgent`, `extraHeaders`, and `bypassCSP` are all optional; any may be
omitted. `userAgent` caps at 500 chars, each header value at 1000 chars.
The API persists the block under `fieldMappings._meta.browserOverrides`
next to `setupScript` and `loadMoreSelector`. The worker reads it in
[worker/lib/playwright.ts](worker/lib/playwright.ts) `createPage()` —
per-site `userAgent` wins over `SCRAPE_USER_AGENT`, per-site headers
merge on top of the default `Accept-Language`. Nothing else needs to
change about the rest of the config.

#### `bypassCSP` — when the data API is on a separate subdomain

Some sites render their listing via a setupScript that XHRs a different
host (e.g. `www.bezeq.co.il` → `https://d-api.bezeq.co.il/...`). The page
ships a Content-Security-Policy whose `connect-src` does NOT allowlist
that data host, so Chromium aborts the XHR before it leaves the network
stack and the setupScript silently produces zero items. CORS is unrelated
— the network response is fine; CSP is what's killing it.

Symptom: scrape runs to `COMPLETED` (not `FAILED`) but `jobs=0`. A
diagnostic setupScript that captures `xhr.send()` exceptions reports
`xhrSendThrew: Failed to execute 'send' on 'XMLHttpRequest': Failed to
load 'https://...'` — the "Failed to load" wording is the CSP signature.

Fix: add `bypassCSP: true` to the `browserOverrides` block. The worker
passes it straight to `browser.newContext({ bypassCSP: true })`, which
disables CSP enforcement for that browsing context only. Per-site,
opt-in — no global change, no impact on any other site.

```jsonc
"browserOverrides": {
  "userAgent": "...",
  "extraHeaders": { "accept-language": "..." },
  "bypassCSP": true
}
```

Reference: bezeq.co.il (siteId `cmpmv882i001x01mvhf9qfaqy`) is the
canonical case — TCP-resets bare Playwright (UA fix) and its setupScript
hits `d-api.bezeq.co.il`, which the page CSP blocks (bypassCSP fix).

## Step 7 — PATCH to ACTIVE

```powershell
$patch = @{ status = 'ACTIVE' } | ConvertTo-Json -Compress
$patchResp = Invoke-RestMethod -Method Patch `
  -Uri "https://scrapper.haide-jobs.co.il/api/sites/$SITE_ID" `
  -Headers $HEADERS -ContentType 'application/json' `
  -Body $patch
```

### MANDATORY config-verification gate (analyzer-race guard)

**This is a hard gate — do not scrape until it passes.** The double-PUT in
Step 6 is supposed to win the race against the auto-analyzer, but it does NOT
always win: the analyzer job (created at POST in Step 2) can finish *after*
your second PUT and silently overwrite your `itemSelector`, field selectors,
and `formCapture` with its own bad guesses. Observed live 2026-06-08 on
yazamco.co.il — the analyzer replaced `itemSelector=div.job` with a broken
`div.title-job.active-s > h3` that only matched the single expanded accordion
row, so the scrape returned 1 job (all rows deduped on an empty externalJobId)
instead of 12. A printed-only check (the old behaviour here) does not catch
this reliably because it inspects the PATCH response, not the persisted config.

Re-read the **persisted** config via GET and assert YOUR selectors survived.
If they didn't, re-PUT and re-verify (up to 2 attempts), THEN scrape:

```powershell
function Get-StoredConfig($siteId) {
  $s = Invoke-RestMethod -Method Get -Uri "$BASE/api/sites?id=$siteId" -Headers $HEADERS
  return ($s.data | Where-Object { $_.id -eq $siteId } | Select-Object -First 1).fieldMappings
}

$expectedItemSel = '<your itemSelector>'                      # e.g. 'div.job'
$expectedFields  = @('title','externalJobId','description')   # keys you PUT
$expectFormFields = 0                                          # set to your formCapture field count, or 0

for ($attempt = 1; $attempt -le 3; $attempt++) {
  $fm = Get-StoredConfig $SITE_ID
  $itemOk  = ($fm._meta.itemSelector -eq $expectedItemSel)
  $fieldsOk = $true
  foreach ($k in $expectedFields) {
    if (-not $fm.$k -or -not $fm.$k.selector) { $fieldsOk = $false; break }
  }
  $formOk = ($expectFormFields -eq 0) -or ($fm._meta.formCapture.fields.Count -ge $expectFormFields)

  if ($itemOk -and $fieldsOk -and $formOk) {
    Write-Host "[verify] config OK (itemSelector=$($fm._meta.itemSelector), fields=[$($expectedFields -join ',')], formFields=$($fm._meta.formCapture.fields.Count))"
    break
  }

  Write-Host "[verify] attempt $attempt: analyzer clobber detected (itemOk=$itemOk fieldsOk=$fieldsOk formOk=$formOk). Re-PUT + re-PATCH ACTIVE."
  if ($attempt -eq 3) { throw 'Config never stuck after 3 attempts — analyzer keeps winning. Stop and report.' }

  # Re-PUT the same config file from Step 6, then PATCH back to ACTIVE
  # (a PUT auto-demotes ACTIVE -> REVIEW).
  Invoke-RestMethod -Method Put -Uri "$BASE/api/sites/$SITE_ID/config" `
    -Headers $HEADERS -ContentType 'application/json' -InFile $configPath | Out-Null
  Start-Sleep -Seconds 3
  Invoke-RestMethod -Method Patch -Uri "$BASE/api/sites/$SITE_ID" `
    -Headers $HEADERS -ContentType 'application/json' `
    -Body (@{ status = 'ACTIVE' } | ConvertTo-Json -Compress) | Out-Null
}
```

Only proceed to Step 8 once this gate prints `config OK`.

**Batch mode**: this gate runs inside the per-URL pipeline like any other.
If it still fails after 3 attempts, do NOT `throw` — instead auto-skip per the
gate matrix with `reason: "Auto-skipped: analyzer kept overwriting config (3 attempts)"`
and `continue` to the next URL.

## Step 8 — Trigger scrape and wait

**One scrape at a time.** The worker is single-threaded FIFO (see Step 2 /
`worker/index.ts`), so triggering several scrapes "in parallel" buys NO
speedup — they just queue and drain one-by-one, and a backlog makes runs
slow and hard to attribute. Onboard sites sequentially on the prod side
(the batch loop in B1 already does this — one URL fully through Steps 1–9
before the next). It's fine — and encouraged — to parallelize the *local*
discovery work (Steps 3–5b) across URLs, but issue prod scrapes one at a
time and let each finish before starting the next.

**Batch mode — dry-run/scrape mismatch re-verify (do this BEFORE auto-skipping):**
A test scrape that returns far fewer jobs than your Step 5 dry-run saw is the
signature of an analyzer clobber or a render-timing miss — NOT a dead site.
This is exactly what wrongly skipped Comeet/Netafim (dry-run 6, scrape 1).
So when the poll loop finishes with `$C` suspiciously low relative to the
dry-run count `$DRYRUN_N` (rule of thumb: `$DRYRUN_N -ge 3 -and $C -le 1`):
1. Re-run the **Step 7 verification gate** (re-PUT config, confirm `config OK`).
   If the stored config was clobbered, this fixes it.
2. Re-trigger the scrape **exactly once** and re-poll.
3. If the second scrape still returns `$C -le 1` while `$DRYRUN_N -ge 3`, THEN
   auto-skip with `reason: "Auto-skipped: scrape returned $C vs dry-run $DRYRUN_N (config/render mismatch)"`.

Only after that single re-verify+re-scrape: if `$S -eq 'FAILED'` or `$C -eq 0`,
call the auto-skip pattern from the gate matrix
(`reason: "Auto-skipped: test scrape produced 0 jobs"`) and `continue` to the
next URL. Do not report a low/zero scrape as success.

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

End with a wrap-up. The `coverage` line is REQUIRED (see the mandatory
coverage gate in Step 4) — state extracted-vs-total explicitly so a
shortfall can never hide:

```
✓ siteId=<ID>  status=ACTIVE  jobs=<N>
✓ coverage: <extracted>/<total> jobs   (or <extracted>/unknown if total couldn't be determined)
✓ config: <fieldCount> fields, itemSelector=<sel>
✓ dashboard: https://scrapper.haide-jobs.co.il/sites/<ID>
```

If `coverage` is partial and the user did NOT sign off on partial
coverage, the onboarding is NOT done — go back and implement full
coverage (see the framework recipes / dynamic-loading options in Step 4).

**Data-completeness check (separate from coverage).** Coverage is about
*how many* jobs; completeness is about *how much per job*. Before declaring
success, run the **B2.5 data-completeness gate**: if the jobs have only
title/location and are missing BOTH a description AND an apply path because
the detail pages were blocked, that is partial data. In **batch mode** that
means log `SKIPPED` (after the one permitted Incapsula/HeadlessChrome
UA-override re-attempt from B2.5); in **single-URL mode** report it and ask
the user before shipping a listing-only config. Add a completeness line to
the wrap-up, e.g. `✓ completeness: title+location+description+applyForm` or
`✗ completeness: title+location only (detail pages blocked) → SKIPPED`.

**Candidate learnings.** As the final part of the wrap-up, append a candidate
learnings block per **"Declaring candidate learnings (both modes)"** below — a
`LEARNING (candidate): …` block for each generalizable fix you applied this run,
or the single line `No candidate learnings this run.` if none qualify.

## Declaring candidate learnings (both modes)

This skill keeps a deliberately **closed** fix set (the B2b remediation
catalog: "the only sanctioned fixes... do not improvise"). When a real run
turns up a fix that would help *future* runs, capture it here as a **candidate
catalog entry** so it doesn't get lost as one-off prose. This is **summary-only
and advisory**: you PRINT the candidate in the end-of-run summary as a proposal
for the user — you do **not** edit this skill, the catalog, or any file
yourself. The user reviews it and, if it's good, asks you to fold it into the
cited section later (then re-sync + commit).

A run touches dozens of site-specific details; almost none are learnings. The
rubric below exists to keep declarations rare and high-signal.

### Declare a learning ONLY when ALL four hold

1. **Applied + verified this run.** You actually made the change and saw it flip
   the outcome (0→N jobs, blocked→unblocked, junk→clean). Not a theory, not
   "might work", not something you reverted.
2. **Generalizes via a reusable signal.** It keys off something a future run can
   recognize again: a vendor/WAF (Incapsula, Cloudflare, PerimeterX…), a SPA
   framework (Workday/Comeet/Lever/Greenhouse…), a server/worker behavior
   (analyzer race, single-threaded FIFO queue), or a recurring page pattern —
   **NOT** a CSS selector unique to this one host.
3. **Not already covered.** It isn't already in B2b, the Step 3 WAF recipes, the
   Step 4 framework recipes, or B2.5. If it IS covered, do **not** declare —
   just cite which existing entry handled it.
4. **Future-useful.** A later run hitting the same signal would be faster or more
   correct if the skill already knew this.

### Do NOT declare (noise)

- Site-specific selectors / field mappings — that's normal per-site work.
- Local/env quirks unrelated to onboarding logic (PowerShell quoting, `pnpm`
  not found, Windows path issues).
- Anything already in the catalog/recipes — cite the existing entry instead.
- Theories or fixes you did not apply and verify in this run.
- Restatements of an existing gate.

### Format (print this in the end-of-run summary)

For each qualifying learning, emit one block:

```
LEARNING (candidate): <one-line title>
  Signal:          <reusable trigger / failure signature observed>
  Fix:             <what you changed that worked>
  Generalizes to:  <vendor / framework / server-behavior / page-pattern>
  Suggested home:  <B2b entry | Step 3 WAF recipe | Step 4 framework recipe | B2.5 | Step 2 race note>
  Status:          new | refines <section>
```

When nothing qualifies, emit exactly one line so silence is unambiguous:

```
No candidate learnings this run.
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
- **Paginated sites:** NEVER silently ship page 1 — the Step 4 coverage
  gate is mandatory. For URL-param pagination the worker has a `url`
  pagination feature; for offset-API SPAs (Workday/Greenhouse/Lever/etc.)
  use the `setupScript` enumeration recipe in Step 4's "Known SPA
  frameworks" subsection. Only ship partial coverage with explicit user
  sign-off, and always report `coverage: <extracted>/<total>`.
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

## Agent correctness rules

These two rules exist because worker capabilities evolve faster than
documentation. A single stale sentence in a copy caused a real incident
(see git `84b52db` / `75d0424`).

### Verify-before-trust
Before asserting that any worker capability is or is not supported
(pagination, `pageFlow`, `setupScript`, `formCapture`, `browserOverrides`,
`loadMoreSelector`, `clickPagination`, etc.), **consult the code**, in
this order:

1. `worker/jobs/scrape.ts` — runtime behaviour and config reading.
2. `src/lib/validators.ts` — Zod schemas; if a field is accepted by the
   schema it is live in production regardless of what any doc says.

**Code wins over prose.** If the code supports something and this doc
says it doesn't, the doc is wrong. Update it and run `pnpm sync:addsite`.

### Coverage gate is mandatory
A site is NOT done until the scrape count matches the full listing count
across all pages. Reporting page-1-only results without explicit user
sign-off is a bug. Always:

1. Confirm total job count from the listing (UI count, page nav, or
   dry-run probe across pages).
2. After the first scrape, compare `totalJobs` in the API response to the
   expected total.
3. If coverage is < 100 % (and the gap isn't explained by expired/filled
   listings), configure pagination, re-PUT, and re-scrape before reporting
   success.
