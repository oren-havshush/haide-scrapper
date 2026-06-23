---
name: 'addsite2'
description: 'Onboard one or many jobs-listing sites end-to-end (v2): triage → build pipeline, externalJobId gate, email-apply detection, age-bucket flagging, Wix/Comeet/Workday recipes, multi-file recipe architecture. Accepts a single URL, multiple URLs, a plain-text file, or a CSV export.'
platform: 'windows-powershell'
---

<!-- CANONICAL SOURCE — do not edit copies directly.
     Edit THIS file (addsite2.md at the repo root), then run `pnpm sync:addsite2`.
     Copies kept in sync:
       • .claude/commands/addsite2.md  (CI-checked — drift blocks merges to main)
       • ~/.cursor/skills/addsite2/SKILL.md  (hardlinked locally by sync script)
     Recipe files (addsite2-recipes/*.md) → ~/.cursor/skills/addsite2/recipes/*.md
     If you see this comment in a copy, that copy is stale — run `pnpm sync:addsite2`. -->

# /addsite2 — site onboarding skill v2

> **Success is NOT a raw ACTIVE count.** Success = each site reaches its *correct*
> terminal state — ACTIVE with complete, appliable jobs, OR SKIPPED with an honest
> reason, OR routed to human REVIEW — at minimum cost. A confident SKIP is a success.
> A false ACTIVE (partial data, apply behind login/Turnstile) is the cardinal failure.
> Optimize: **correct-verdict rate at low cost.**

---

## 0. Before you start

### 0.1 Read token
```
TOKEN=$(cat .claude/scrap-token)
BASE=https://scrapper.haide-jobs.co.il
AUTH="Authorization: Bearer $TOKEN"
```
> On Windows use PowerShell: `$TOKEN = Get-Content .claude\scrap-token -Raw | ForEach-Object { $_.Trim() }`

### 0.2 What you MUST NOT do
- Never use `pageSize > 100` in any `/api/sites` call — values >100 silently return `[]`. **LANDMINE.**
- Never commit an ACTIVE site with only title+location (no description, no apply path).
- Never use index-based `externalJobId` (`item-0`, `item-1`). Dedup will collapse on re-scrape.
- Never skip the `verify-config` gate after a PUT — the analyzer overwrites configs.
- Never run parallel prod scrapes — the worker is single-threaded FIFO; parallel scrapes queue, not parallelise.
- Never `PATCH /api/sites/:id` with more than one of `status` / `adminNote` / `companyName` in the same body. The route honors **exactly one**, in priority `companyName` → `adminNote` → `status`; the rest are **silently ignored**. To set a status *and* a note, send **two separate PATCH calls**. **LANDMINE** (caused the one1 duplicate that stayed ACTIVE).

### 0.3 Inputs
```
/addsite2 <URL>                         # single site
/addsite2 --file urls.txt               # one URL per line
/addsite2 --csv sheet.csv --column "Career Page" [--company-col "Company"] [--limit N] [--start N]
/addsite2 <URL> --force                 # reactivate a SKIPPED/FAILED site
```

---

## 1. Batch mode orchestration (B0–B4)

> Run this section once per batch invocation. For single-URL: skip to §2.

### B0 Parse work-list
```
BATCH_DIR=$(npx tsx scripts/addsite-batch.ts parse \
  [--file urls.txt | --csv sheet.csv --column "Career Page" [--company-col Company]] \
  [--limit N] [--start N] [--force] [--resume .scratch/batch-123/batch-results.jsonl] \
  2>&1 | grep "^BATCH_DIR:" | cut -d: -f2-)
```
Prints `BATCH_DIR: .scratch/batch-<timestamp>`. All subsequent `log` and `summary` calls use this dir.

### B1 Per-site loop contract
Process sites **one at a time**, sequentially. Never parallelise prod scrapes.
For each URL in `work-list.json`:
1. Run the full §2–§9 pipeline for that URL.
2. On any terminal outcome (ACTIVE / SKIPPED / REVIEW / REQUEUE), call:
   ```
   npx tsx scripts/addsite-batch.ts log \
     --batch-dir $BATCH_DIR --url <URL> --outcome <OUTCOME> \
     --reason "<reason>" [--site-id <id>] [--jobs <N>] [--qa-file <path>]
   ```
3. Move to the next URL.

**Outcomes:** `ACTIVE` | `SKIPPED` | `REVIEW` | `REQUEUE` | `ERROR`

### B1.5 Reactivating SKIPPED/FAILED (--force)
If the existing status is SKIPPED or FAILED and `--force` is set:
1. `PATCH /api/sites/<id>` → `{ "status": "ANALYZING" }` (only ANALYZING is accepted from SKIPPED).
2. Wait for status to leave ANALYZING (poll GET, max 60 s).
3. Then treat as a fresh site (proceed from §3).

### B2 Gate matrix (per site in batch)

| Signal | Gate script | Outcome if fail |
|---|---|---|
| Site unreachable (reach exit 3) | `reach` | SKIPPED (structural) |
| Detail pages Incapsula-blocked (detail-reach exit 3) | `detail-reach` | SKIPPED or REVIEW |
| Dry-run returns fewer than 2 items (0–1, 2× attempts) | dry-run | SKIPPED |
| Tier-A incomplete after scrape | `addsite-qa` | SKIP / REVIEW / REQUEUE (per verdict) |
| Config clobbered after PUT | `verify-config` | Re-PUT (max 2×), then REVIEW |

### B2a Remediation budget
Before remediation, check these invariants. A fix attempt only runs when its signal fires:

1. **Signal-gated:** only attempt a fix when a specific, diagnosable signal is present.
2. **One-shot:** each fix class attempted at most once.
3. **Cap:** ≤ 3 total distinct fix attempts per site.
4. **2-no-progress stop:** if 2 remediation rounds yield no fill-rate improvement, stop and SKIP.
5. **Time cap:** 15 minutes per site maximum.

If budget exhausted → emit `SKIPPED` with the last observed failure reason.

### B2b Closed fix set (cite recipe on signal)
| Signal | Fix | Recipe |
|---|---|---|
| Items found on listing but detail pages Incapsula-blocked | Add `browserOverrides.userAgent` | [waf-bypasses.md] |
| `setupScript` XHR fails with CSP error | Add `bypassCSP: true` | [waf-bypasses.md] |
| Field value inside complex DOM not reachable by selector | Write `setupScript` to inject a span | [setupscript-patterns.md] |
| Description is one run-on line, or missing labeled sections (דרישות/כישורים) | `structuredText` helper + merge sections | [setupscript-patterns.md §7–8] |
| Apply form on detail page, not captured | Run Step 5b | [form-capture.md] |
| Jobs load lazily / "load more" button ("טען עוד") / infinite scroll | Prefer native `_meta.loadMoreSelector`; else `pageFlow` / `setupScript` | [pagination-and-loading.md §2] |
| Known ATS (Workday/Greenhouse/Lever/Comeet/iCIMS/etc.) | Use skeleton from fingerprint + recipe | [spa-frameworks.md] |

### B2.5 Completeness gate — NEVER activate partial data
Before marking ACTIVE, all of these must hold:
- `fillRates.title ≥ 0.8`
- `fillRates.description ≥ 0.6` (description is the primary job-utility field)
- `formStatus !== "NONE"` (at least one usable apply path)
- `externalJobId` fill ≥ 0.9 (dedup health)

If any fails → SKIP with the specific missing field as reason.
**Exception:** if the page provably doesn't expose description (probe `probe.fieldsOnPage.description === false`) → REVIEW (not SKIP); a human can confirm.

### B2.6 QA gate
```
npx tsx scripts/addsite-qa.ts --site-id <id> [--detail-url <url>] \
  [--sample 10] [--stealth] [--min-fill 0.6] --verdict-exit
```
- Exit 0 = ACTIVE, exit 2 = SKIP, exit 3 = REVIEW, exit 4 = REQUEUE.
- Always pass `--verdict-exit` in automated pipelines.
- Parse `qa.verdict` and `qa.verdictReason` from `QA <json>` on stdout for the log.

### B3 Summary
```
npx tsx scripts/addsite-batch.ts summary --batch-dir $BATCH_DIR
```
Writes `summary.md` in the batch dir. Print the table to the user.

**B3.1 companyName sweep — MANDATORY before declaring the batch done.**
`POST /api/sites` silently drops `companyName` (§4 landmine, `LRN-WRK-7`), so a whole
batch can ship nameless even when the work-list had a company column. Before finishing,
GET every site (by URL) and confirm `companyName` is non-null for every row that had a
company; PATCH + re-verify any that are null:
```bash
# for each site that had a company in the work-list:
GOT=$(curl -s "$BASE/api/sites?siteUrl=$(jq -rn --arg u "$URL" '$u|@uri')" -H "$AUTH" | jq -r '.data[0].companyName // .data.companyName')
[ "$GOT" = "$COMPANY" ] || { curl -s -X PATCH "$BASE/api/sites/$ID" -H "$AUTH" -H 'Content-Type: application/json' -d "{\"companyName\":\"$COMPANY\"}" >/dev/null; }
```

### B4 Cost visibility
After each site: note browser sessions opened + scrapes triggered. After batch: report totals.

---

## 2. Pass A — Triage (run before any build work)

```
npx tsx scripts/addsite-batch.ts triage --url <URL>
```

Read the JSON output:

| `lane` | Meaning | Next action |
|---|---|---|
| `RED` | Unreachable (network/region/captcha) | → SKIP immediately. Log reason. |
| `GRAY` | Reachable but no obvious listing structure | → REVIEW queue. Do not attempt build. |
| `YELLOW` | Novel site, repeating structure detected | → §3 full discovery mode |
| `GREEN` | Known ATS/framework detected | → §3 skeleton mode (`triage.skeleton` is your starting config) |

**Save the triage output:** `triage.json` in the site's scratch dir. Carry `triage.vendor`, `triage.recipe`, `triage.skeleton`, and `triage.browserOverrides` forward.

> If `triage.needsUaOverride === true`, all subsequent browser steps must pass the UA. Carry it into `browserOverrides.userAgent` in the final config.

---

## 3. Step 1 — Duplicate check

```bash
# Exact match + normalized variants
curl -s "$BASE/api/sites?siteUrl=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' "$URL")&pageSize=10" \
  -H "$AUTH" | jq '.data[]? | {id, siteUrl, status}'
```
Also check: trailing-slash variant, http↔https swap, www/no-www prefix.

| Result | Action |
|---|---|
| Status `ACTIVE` | Report existing site, no action. Log `ACTIVE (already existed)`. |
| Status `SKIPPED` or `FAILED` | If `--force`: reactivate (§B1.5). Else: log `SKIPPED (existing, no --force)`. |
| Not found | → §4 create |

**LANDMINE:** `pageSize > 100` silently returns `[]`. Never use >100 for dedup. Use `pageSize=10` with an exact-match filter.

---

## 4. Step 2 — Create site + wait for analyzer

**`companyName` MUST be set with a standalone PATCH after create — NOT in the create body.**
**LANDMINE:** `POST /api/sites` **silently drops `companyName`** when it is sent in the
create payload (especially alongside `status`) — the site comes back `companyName: null`.
This nulled the 5.csv batch **and** the 6.csv batch (all 10 sites). Putting the field in
the POST body is **not** sufficient — you must PATCH it separately and **verify it stuck**.

```bash
# 1) Create (companyName here is unreliable — do NOT depend on it persisting)
SITE=$(curl -s -X POST "$BASE/api/sites" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"siteUrl\":\"$URL\",\"status\":\"ACTIVE\"}")
SITE_ID=$(echo $SITE | jq -r '.data.id')

# 2) MANDATORY when the work-list carries a company: standalone single-field PATCH (§0.2)
if [ -n "$COMPANY" ]; then
  curl -s -X PATCH "$BASE/api/sites/$SITE_ID" -H "$AUTH" -H "Content-Type: application/json" \
    -d "{\"companyName\":\"$COMPANY\"}" >/dev/null
  # 3) VERIFY it stuck — GET by URL (the /:id GET can return empty for fresh sites)
  GOT=$(curl -s "$BASE/api/sites?siteUrl=$(jq -rn --arg u "$URL" '$u|@uri')" -H "$AUTH" | jq -r '.data[0].companyName // .data.companyName')
  [ "$GOT" = "$COMPANY" ] || echo "WARN: companyName not set for $SITE_ID (got '$GOT')"
fi
```

> Keep the JSON UTF-8 / BOM-free (§14); Hebrew company names pass through verbatim.
> The `addsite-batch.ts` create path already does this PATCH-after-create — **if you
> create sites with a custom/hand-rolled script, you MUST replicate the PATCH + verify**,
> or the dashboard ships nameless. Cite: `LRN-WRK-7`.

**Immediately wait for ANALYZING to leave** — the server auto-enqueues an ANALYSIS job that will **overwrite your config** if you PUT before it finishes.

```bash
for i in $(seq 1 24); do   # max 2 min
  STATUS=$(curl -s "$BASE/api/sites/$SITE_ID" -H "$AUTH" | jq -r '.data.status')
  echo "[$i] status=$STATUS"
  [ "$STATUS" != "ANALYZING" ] && break
  sleep 5
done
```

> **LANDMINE:** "status left ANALYZING" is a necessary but not sufficient condition. The worker may still be processing. Wait an extra 5 s before PUT. If status never leaves ANALYZING after 2 min → REVIEW.

---

## 5. Step 3 — Reachability

Triage (§2) already ran `reach`. If triage was skipped (single-URL shortcut):
```
npx tsx scripts/addsite-batch.ts reach --url "$URL"
# Exit 3 = unreachable → SKIP
# JSON .needsUaOverride → carry browserOverrides.userAgent forward
```

**Detail-page reachability** (run if you have at least one `detailUrl` sample):
```
npx tsx scripts/addsite-batch.ts detail-reach --listing "$URL" --detail "$DETAIL_URL"
# Exit 2 = needs UA override on detail pages → add browserOverrides.userAgent
# Exit 3 = detail pages blocked even with UA → REVIEW (see waf-bypasses.md)
```
> **LANDMINE:** listing page passing bare does NOT prove detail pages pass. Incapsula blocks
> are detail-page-only. Always probe a detail URL. Cite: `LRN-WAF-2` in addsite-learnings.md.

---

## 6. Step 4 — Config building

### 6.1 GREEN lane (known ATS — skeleton mode)

The `triage` / `fingerprint` output already contains a `skeleton`. Use it:
```bash
ITEM_SEL=$(echo $TRIAGE | jq -r '.skeleton.itemSelector')
# field mappings from .skeleton.fieldMappings
```
Then **validate** the skeleton with a dry-run (§8) before PUT. The skeleton is a starting point — you MUST confirm it actually matches the site's current DOM.

If the site's vendor has a recipe file, read it on signal:
- Workday/Greenhouse/Lever/Comeet/iCIMS/SmartRecruiters/Ashby → read `addsite2-recipes/spa-frameworks.md`

### 6.2 YELLOW lane (novel site — full discovery)

Fetch and inspect the listing page HTML:
```bash
curl -s -A "$REAL_UA" "$URL" -o listing.html
# Or use a Playwright headless fetch for JS-heavy pages (see addsite2-recipes/setupscript-patterns.md)
```

**itemSelector rules:**
- Must select every job row as consistent siblings — typically many, but as few as 2 on a genuinely small site (don't force ≥3; the volume bar is `< 2` → SKIP, see §7).
- Each item must contain all mapped fields independently (no cross-item contamination).
- Prefer a dedicated job-card class over generic `<li>` or `<div>`.
- Verify with the dry-run tool, not by eye.

**Field selection rules (in priority order):**

| Field | Strategy |
|---|---|
| `title` | Direct text selector inside item. |
| `externalJobId` | (1) Native job ID attr (`data-job-id`, `data-id`), **or a req number printed in the title** (`"משרה 231: …"` → regex it out). (2) Slug from `detailUrl`. (3) Hash of title+department+location (stable, disambiguated). **Never index-based.** **CAUTION:** a printed "job number" field (e.g. `numberJob`) can be reused across distinct postings by the same recruiter — verify uniqueness. Prefer the unique record ID (e.g. CMS `_id`) when a printed number collides. If `saved jobs < API count` after scraping, the id field is non-unique. |
| `description` | Often only on the detail page — map `detailUrl` and let worker fetch it. **Locate the body by dumping the FULL visible text** of a detail page (render it, print `innerText`) and finding the prose container — do NOT guess semantic selectors (`.order_description`) and give up when they're absent; the real body may live in a differently-named block (`.job_desc`). **Never substitute metadata (category/area/clinic/department) for a real description** — a 1–2 line metadata string that trips the QA correctness suspect "description present but avg N chars while detail body is >X chars" is a BLOCKER, not shippable (`LRN-SETUP-4`). **If the detail page splits the body into labeled sections (תיאור / דרישות / כישורים / תנאים), the analyzer maps only ONE — merge them all** (setupScript §8). **If the text comes back as one run-on line, preserve block line breaks** via the `structuredText` helper — NEVER `.replace(/\s+/g,' ')` (setupScript §7). **Capture the COMPLETE body — never cherry-pick only the headings you recognise.** A detail-fetch that grabs only `description`+`requirements` silently drops the meta block (employment type, hours, **division/department**) and intro lines that the site shows per job. Route typed meta into its own field, fold the rest into `description` (setupScript §11, `LRN-SETUP-3`). |
| `detailUrl` | Anchor `href` inside item; must be stable (not JS-generated blob). |
| `location` | Direct selector; `setupScript` if embedded in a formatted string or in the title (split on dash); or **hardcode a constant** for a confirmed single-office employer. |
| `publishDate` | If not in item DOM → skip (don't block ACTIVE on a missing Tier-B field). |
| `requirements` | Detail-page field; usually merge into `description` (setupScript §8) preserving line breaks (§7). |

**Coverage gate — MANDATORY:**
Establish the true total before submitting. Never silently ship only page 1.
```
# Count items in DOM, compare against total displayed on page ("Showing 1–20 of 87 jobs")
# Emit: coverage: <extracted>/<total>
```
If extracted < total and you haven't handled pagination → read `addsite2-recipes/pagination-and-loading.md`.

**LANDMINE:** `externalJobId` must survive a re-scrape unchanged. Test: scrape twice, compare ids.

### 6.3 setupScript fallback
When a value is **not extractable by a CSS selector alone**, write a `setupScript` to inject it.
Signal: field value is embedded inside formatted text, inside a sibling, or dynamically generated.
→ Read `addsite2-recipes/setupscript-patterns.md`.

**setupScript rules (always apply):**
- Inject a `<span class="__ai-<field>">value</span>` appended to the **item root element**.
- Guard against re-run duplication: `if (item.querySelector('.__ai-<field>')) return;`
- `await` is supported; IIFE not needed.
- Runs on **both** listing and detail pages — write defensively.
- Do NOT append to an element that another field selector already reads (corruption risk, `LRN-SETUP-1`).

---

## 7. Step 5 — Dry-run

```bash
# POST a dry-run with the proposed config (no mutation):
DRY=$(curl -s -X POST "$BASE/api/sites/$SITE_ID/analyze" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d "$CONFIG_PAYLOAD")
echo $DRY | jq '{count: (.data | length), sample: (.data[0:2])}'
```

> **Minimum job count = 2.** A site is only skipped on volume when it yields
> **fewer than 2 jobs** (0 or 1). 2+ valid jobs is shippable — never SKIP a site
> just because the count is "low" or "thin" (e.g. 2–4 jobs). Job count is NOT an
> ROI/complexity judgment call; the only volume bar is `< 2`.

| Result | Action |
|---|---|
| ≥2 items, title + externalJobId present | Proceed to §8 (PUT). |
| Fewer than 2 items (0–1) | Check: wrong selector? JS-heavy page? → fix or read recipe. If 2nd attempt still <2 → SKIP. |
| Items but no title | Fix `title` selector. Count against remediation budget. |
| Items but externalJobId all identical or index-based | Fix before PUT. **LANDMINE.** |

---

## 8. Step 5b — Apply form capture (run when no captured form yet)

> **This step is MANDATORY before the first PUT — not optional, not a remediation
> step.** The ONLY reasons to skip it are: (a) `triage`/QA already reports
> `formStatus: CAPTURED`, (b) Step 5a detected email apply (`formStatus: EMAIL`),
> or (c) a per-item apply URL is already mapped. Otherwise you MUST attempt capture
> here, BEFORE you PUT and scrape. Do **not** PUT a config with no apply path and
> let QA flag it later — that wastes a full scrape+QA round and is the exact mistake
> that left the 6.csv batch sites (clalitsmile/proportsia) stuck in REVIEW. Cite: `LRN-FORM-6`.

Signal to capture: there is no captured form yet and you can see a real apply form/button on the detail page (or QA returns `formStatus: NEEDS_MANUAL` / `NONE`).

1. Navigate to a sample detail URL.
2. Find and interact with the apply form (click "Apply", wait for modal if needed).
3. Capture the form structure (action URL, method, input field names and types).
→ Read `addsite2-recipes/form-capture.md` for the full capture-form.ts script and fallback flow.

> **Detail-page-only Tier-A fields (description/requirements):** if the listing
> page lacks `description` or `requirements` but the detail page has them, do NOT
> ship without them. Write a detail-fetch `setupScript` that `await fetch()`es each
> item's detail URL and injects `.__ai-description` / `.__ai-requirements` into the
> listing item (recipe: `setupscript-patterns.md`). Attempt this in THIS step,
> before PUT — not after QA flags `description=0`. Cite: `LRN-SETUP-2` (madanes.com).

**Login gate:** if the apply requires login → `formStatus: NONE`, mark SKIPPED. Do not attempt to log in.
**Turnstile/CAPTCHA gate:** if the apply form has Turnstile/CAPTCHA → SKIPPED. Log `LRN-APPLY-1`.
**Multi-form pages — enumerate ALL forms, then rank:** a page can carry 3+ forms,
some behind **secondary buttons/modals** (the most prominent "apply" button may open
the **reCAPTCHA-gated** form while a less obvious button opens a usable one). List
every `<form>`, check EACH for Turnstile/reCAPTCHA, and pick by this order:
**(1) captcha-free CV-file-upload form → (2) captcha-free contact/lead form →
(3) captcha-gated = unusable.** Don't stop at the first captcha-free form — prefer
the one that accepts a CV file. Reference: clalitsmile.co.il (Formidable Forms, 3
forms): the prominent "שליחת קו״ח" button is reCAPTCHA-gated, but a separate
generic-position button exposes a captcha-free CV upload (`LRN-FORM-7`). Capture
both when useful (CV-upload primary + contact form fallback) via one merged static
`fields` list + a no-match `formSelector` (see `form-capture.md` §7).
**LANDMINE — `formSelector` re-extracts at scrape time:** on a **listing-only site
(no `pageFlow`)** the worker live-extracts the form from the **listing page** and
only uses your captured static `fields` when `formSelector` matches **nothing**. If
the listing page has a decoy `<form>` (WP/Elementor newsletter/contact) that your
selector matches, the captured CV/file fields silently never reach `rawData._formData`
(the per-job dashboard table). Make `formSelector` match nothing on the listing page
(e.g. `form.elementor-form:has(input[type="file"])`) to force the static fallback,
then re-scrape and confirm a sampled job's `_formData` lists the `file` field. Cite:
`LRN-APPLY-7` (proportsia.co.il); full mechanism + verification in `form-capture.md` §7.

---

## 9. Step 6 — PUT config

### 9.1 Payload shape
```json
{
  "itemSelector": "<selector>",
  "fieldMappings": {
    "title":         { "selector": "...", "confidence": 0.9, "source": "auto" },
    "description":   { "selector": "...", "confidence": 0.8, "source": "auto" },
    "location":      { "selector": "...", "confidence": 0.8, "source": "auto" },
    "externalJobId": { "selector": "...", "confidence": 0.9, "source": "auto" },
    "detailUrl":     { "selector": "a", "extractAttr": "href", "confidence": 0.9, "source": "auto" },
    "requirements":  { "selector": "...", "confidence": 0.7, "source": "auto" },
    "publishDate":   { "selector": "...", "confidence": 0.7, "source": "auto" }
  },
  "formCapture": { ... },          // if captured in §8
  "browserOverrides": { ... },     // if reachability required UA
  "setupScript": "...",            // if fields required injection
  // minPublishDays / minPublishDate — no longer needed; see §10
  "minPublishDate": "YYYY-MM-DD",  // optional — only to set a hard frozen floor (rare)
  "bypassCSP": true                // if setupScript XHRs a different subdomain
}
```

**LANDMINE — honored vs ignored fields:**
The worker honors **only**: `selector`, `extractAttr`, `confidence`, `source`, `capturedOnUrl`.
It **ignores** (silently): `regex`, `transform`, `extractRegex`, `postProcess`, `extract`.
Use `setupScript` for any transformation the worker can't do with a plain selector.

**BOM-free UTF-8:** Hebrew form labels must be written without a BOM. On Windows, write JSON via Node (`fs.writeFileSync(..., 'utf8')`) not PowerShell echo.

```bash
curl -s -X PUT "$BASE/api/sites/$SITE_ID/config" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d "$CONFIG_PAYLOAD"
```

### 9.2 Double-PUT (analyzer race guard)
```
PUT config → wait 8 s → PUT config again (identical) → then verify-config
```
The first PUT may be overwritten by the still-running analyzer. The second PUT wins.

### 9.3 Wait + verify-config
```bash
sleep 8
npx tsx scripts/addsite-batch.ts verify-config \
  --site-id $SITE_ID \
  --expect-item "$ITEM_SEL" \
  --expect-fields "title,description,location,externalJobId,detailUrl" \
  [--expect-form-fields N]
# Exit 2 = config was clobbered → re-PUT and verify again (max 2 retries, then REVIEW)
```
**LANDMINE:** never mark ACTIVE without passing `verify-config`. Exit 2 means the analyzer race won and your config is gone. Cite: `LRN-RACE-2`.

---

## 10. Step 7 — Age-bucket flagging (replaces stale-job cutoff)

**`minPublishDays` and `minPublishDate` are now inert — do not set them.**
The worker keeps every job regardless of age and assigns an `ageBucket` field
at scrape time: `fresh` / `d90` / `d180` / `d365`. Old jobs surface in the
dashboard with colored age-counter badges; the Jobs page age-filter lets you
drill by bucket. You no longer need to gate scrapes on publish age.

Existing sites that already have `minPublishDate` or `minPublishDays` in their
config are unaffected — those keys are **silently ignored** at scrape time.

**When to set `minPublishDate` (rare override):** if you need a one-time hard
floor (e.g. a campaign cutoff unrelated to age-buckets), set
`minPublishDate: "YYYY-MM-DD"` in the payload. It wins over any age-bucket
logic. Do not use it as a routine onboarding step.

Then run `verify-config` again (these live under `_meta`, not `fieldMappings` — they survive the analyzer).

---

## 11. Step 8 — Trigger scrape

```bash
curl -s -X POST "$BASE/api/sites/$SITE_ID/scrape" -H "$AUTH"
```
The worker is **single-threaded FIFO**. Parallel scrape calls queue, not parallelise.
Wait ~30–90 s before sampling jobs (worker speed varies by site complexity).

---

## 12. Step 9 — QA + verdict

```bash
npx tsx scripts/addsite-qa.ts --site-id $SITE_ID \
  [--detail-url "$DETAIL_URL"] [--sample 15] [--stealth] \
  --verdict-exit 2>&1 | tee qa-output.txt
QA_EXIT=$?
QA_JSON=$(grep '^QA ' qa-output.txt | sed 's/^QA //')
VERDICT=$(echo $QA_JSON | jq -r '.verdict')
REASON=$(echo $QA_JSON | jq -r '.verdictReason')
```

### Verdict routing

| Exit / Verdict | Action |
|---|---|
| 0 / ACTIVE | Run the **externalJobId gate** (below). If it passes → `PATCH /api/sites/$SITE_ID {"status":"ACTIVE"}`. Log outcome. Done. |
| 2 / SKIP | **Two separate PATCH calls** (never combined — see §0.2 landmine): `PATCH {"adminNote":"$REASON"}` then `PATCH {"status":"SKIPPED"}`. Log. Done. |
| 3 / REVIEW | **First check the REVIEW reason — it may be remediable, not terminal** (see below). If genuinely uncertain → **Two separate PATCH calls**: `PATCH {"adminNote":"$REASON"}` then `PATCH {"status":"REVIEW"}`. Log. Done. |
| 4 / REQUEUE | Append URL to end of work-list with `attempt+1`. If `attempt ≥ 2` → escalate to REVIEW. |
| 1 / ERROR | Check error; if transient retry once; else REVIEW. |

> **REVIEW is not always terminal — remediate first.** Before logging REVIEW,
> inspect `verdictReason`. These reasons are **remediable signals**, not verdicts —
> go fix them (within the §B2a remediation budget) and re-QA, do NOT log REVIEW:
> - `formStatus: NEEDS_MANUAL` / `NONE` with a visible apply form → go back to Step 5b
>   and capture the form (this is the most common false-REVIEW; it stranded 3 sites
>   in the 6.csv batch). Cite: `LRN-FORM-6`.
> - `description=0` / `requirements=0` but the fields exist on the detail page → add a
>   detail-fetch `setupScript` (Step 5b note). Cite: `LRN-SETUP-2`.
> - **`correctnessSuspect` "description present but avg N chars while detail page body
>   is >X chars"** → you mapped a subtitle/metadata block (category/area/clinic), NOT
>   the job body. Render a detail page, find the real prose container by its text, and
>   re-map. **Never ship ACTIVE on metadata-as-description** (this passes the `≥0.6`
>   fill gate but is wrong data). Cite: `LRN-SETUP-4`.
>
> Only log REVIEW when the gap is genuinely un-fixable by you (e.g. data simply isn't
> exposed anywhere, or only a Tier-B field like `department` is missing while all
> Tier-A is 100% — that is shippable-as-ACTIVE territory, not REVIEW).

> **Verify the transition stuck.** After setting a terminal status, GET the site and confirm `status` actually changed — a combined `{status, adminNote}` PATCH silently leaves the old status in place.

**Step 5a — Detect email apply BEFORE running form capture:**
Run this quick probe after the dry-run passes and before Step 5b. It prevents
the class of false SKIP where a site-wide careers email is the real apply path
but form capture finds only a newsletter/subscribe form and returns `NONE`.

```bash
# In Playwright, after page.goto(listingUrl):
emailApply = await page.evaluate(() => {
  const mailtos = [...document.querySelectorAll('a[href^="mailto:"]')]
    .map(a => a.getAttribute('href').replace(/^mailto:/i,'').split('?')[0]);
  const body = document.body.innerText || '';
  const prose = /\b[\w.+-]+@[\w.-]+\.\w+\b/.exec(body)?.[0] || null;
  const applyCue = /קורות\s*חיים|מועמדות|לשלוח|הגש|apply|cv|resume|מס[\s'']?משרה/i.test(body);
  return { mailtos, prose, applyCue,
    likelyEmailApply: (mailtos.length > 0 || !!prose) && applyCue };
});
```

If `likelyEmailApply === true`:
- **Skip Step 5b entirely.** Set `formCapture: null` (correct for email apply).
- Map `applicationInfo` on every item — per-item `mailto:` or inject a site-wide
  address via `setupScript`.
- Ensure each job has a stable `externalJobId` (native number, detail URL slug, or hash).
- `formStatus = EMAIL` → Tier-A pass. Proceed to ACTIVE.

**Do NOT SKIP** just because Step 5b found only a newsletter form, no per-job
`detailUrl`, or `formCapture: null`. Those are expected on email-apply sites.
Full recipe in `addsite2-recipes/form-capture.md` §Step5a. Cite: `LRN-FORM-3`.

**externalJobId gate (MANDATORY before ACTIVE) — value-based, not prose-based:**
```bash
npx tsx scripts/addsite-batch.ts verify-jobids --site-id $SITE_ID
# Exit 2 = bad ids (raw-title reused as id, index-based, all-identical, or fill < 0.9)
```
This inspects the **actual scraped id values** (the dedup key), so it catches the
class of bug that prose rules miss — e.g. shipping the raw job title as the id.
Exit 2 → do **not** mark ACTIVE: fix the `externalJobId` mapping (read
`addsite2-recipes/setupscript-patterns.md` §3, hash-synthesis), re-PUT, re-scrape,
re-run the gate. Cite: `LRN-ID-4`.
Exit 0 but `saved jobs < API/DOM total` → the id field has collisions (non-unique
native number). Switch to the record's unique internal id (CMS `_id`, DB row id,
detail URL path) and re-scrape. Cite: `LRN-ID-5`.

**Completeness gate (double-check before ACTIVE):** if `formStatus === "NONE"` → override verdict to SKIP regardless of QA exit code. Apply path is mandatory.

---

## 13. Step 10 — Log learning (if applicable)

After each site, ask: did this site reveal a new failure mode or a new fix that generalises?
If yes → append to `docs/addsite-learnings.md`:
```
## LRN-<CATEGORY>-<N>
- Date: YYYY-MM-DD
- Site: <domain>
- Signal: <what you observed>
- Fix: <what worked>
- Generalises to: <other site types where this applies>
```

---

## 14. Windows gotchas

- Use `npx tsx` not `ts-node` — tsx is warm-started.
- Write Hebrew JSON via Node (`fs.writeFileSync`), not PowerShell echo (UTF-16 BOM trap).
- Curl on Windows: use `curl.exe` explicitly in PowerShell (avoid PowerShell's `Invoke-WebRequest` alias).
- Heredoc multiline JSON: use a temp file written by Node, not PowerShell here-strings.
- **ALWAYS send PATCH/PUT/POST JSON bodies via a file** (`curl.exe ... -d "@body.json"`),
  **never** an inline `-d '{"status":"SKIPPED"}'` / `--data-raw '{...}'`. PowerShell mangles
  the embedded double quotes → server gets malformed JSON → `request.json()` throws →
  the route returns a misleading **`500 INTERNAL_ERROR`** (NOT a transition error). This
  is the trap that made a valid `REVIEW → SKIPPED` PATCH look like "the API blocks the
  transition." Write the file with the file tool or `Out-File -Encoding ascii`. Cite: `LRN-API-3`.

---

## 15. Recipes (load on signal — do NOT pre-read all)

Each recipe is in `addsite2-recipes/` and should be loaded **only when the named signal fires**.
Pre-reading all recipes defeats the lean-core cost goal.

| Signal | Recipe file |
|---|---|
| `triage.vendor` is a known ATS (Workday/Greenhouse/Lever/Comeet/iCIMS/SmartRecruiters/Ashby) | `addsite2-recipes/spa-frameworks.md` |
| `detail-reach` exit 2/3, or `browserOverrides.userAgent` needed | `addsite2-recipes/waf-bypasses.md` |
| Field value not extractable by CSS selector; description is one-line or missing labeled sections (דרישות/כישורים); id/location in title | `addsite2-recipes/setupscript-patterns.md` |
| `formStatus: NEEDS_MANUAL` or apply form capture needed | `addsite2-recipes/form-capture.md` |
| `extracted < total` (coverage gap), lazy loading, or "load more" detected | `addsite2-recipes/pagination-and-loading.md` |

---

## 16. Correctness rules (load-bearing — never drift from these)

1. **Code wins over prose.** If a script exits 2, the site is not ACTIVE. Not even if the HTML looks good.
2. **`verify-config` is not optional.** Every PUT must be followed by a successful `verify-config`.
3. **Coverage line is mandatory.** Emit `coverage: X/Y` for every site. Never silently ship page-1-only.
4. **externalJobId must be stable AND verified by code.** Never mark ACTIVE without a passing `verify-jobids` (exit 0). The id is the dedup key: raw-title reuse, index-based, or all-identical ids are blockers. Prefer `h-<hash>` synthesis (recipe §3). Prose intent is not enough — the gate checks the real values.
5. **Apply path is mandatory for ACTIVE.** No form + no email + no URL = SKIP, not ACTIVE.
6. **REVIEW is not failure.** Routing to REVIEW with an honest reason is a correct outcome and saves both cost and product quality.
