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
| Dry-run returns 0 items (2× attempts) | dry-run | SKIPPED |
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
| Apply form on detail page, not captured | Run Step 5b | [form-capture.md] |
| Jobs load lazily / "load more" button / infinite scroll | Add `pageFlow` or `setupScript` | [pagination-and-loading.md] |
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

```bash
SITE=$(curl -s -X POST "$BASE/api/sites" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"siteUrl\":\"$URL\",\"status\":\"ACTIVE\"}")
SITE_ID=$(echo $SITE | jq -r '.data.id')
```

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
- Must select ≥3 consistent siblings per page.
- Each item must contain all mapped fields independently (no cross-item contamination).
- Prefer a dedicated job-card class over generic `<li>` or `<div>`.
- Verify with the dry-run tool, not by eye.

**Field selection rules (in priority order):**

| Field | Strategy |
|---|---|
| `title` | Direct text selector inside item. |
| `externalJobId` | (1) Native job ID attr (`data-job-id`, `data-id`). (2) Slug from `detailUrl`. (3) Hash of title+department+location (stable, disambiguated). **Never index-based.** |
| `description` | Often only on the detail page — map `detailUrl` and let worker fetch it. |
| `detailUrl` | Anchor `href` inside item; must be stable (not JS-generated blob). |
| `location` | Direct selector, or `setupScript` if embedded in a formatted string. |
| `publishDate` | If not in item DOM → skip (don't block ACTIVE on a missing Tier-B field). |
| `requirements` | Detail-page field; often merged with description. |

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

| Result | Action |
|---|---|
| ≥3 items, title + externalJobId present | Proceed to §8 (PUT). |
| 0 items | Check: wrong selector? JS-heavy page? → fix or read recipe. If 2nd attempt also 0 → SKIP. |
| Items but no title | Fix `title` selector. Count against remediation budget. |
| Items but externalJobId all identical or index-based | Fix before PUT. **LANDMINE.** |

---

## 8. Step 5b — Apply form capture (run when no captured form yet)

> Skip if `triage` or QA reports `formStatus: CAPTURED` already.

Signal to capture: the QA gate returns `formStatus: NEEDS_MANUAL` or `NONE` and you can see a real apply form/button on the detail page.

1. Navigate to a sample detail URL.
2. Find and interact with the apply form (click "Apply", wait for modal if needed).
3. Capture the form structure (action URL, method, input field names and types).
→ Read `addsite2-recipes/form-capture.md` for the full capture-form.ts script and fallback flow.

**Login gate:** if the apply requires login → `formStatus: NONE`, mark SKIPPED. Do not attempt to log in.
**Turnstile/CAPTCHA gate:** if the apply form has Turnstile/CAPTCHA → SKIPPED. Log `LRN-APPLY-1`.

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
  "minPublishDate": "YYYY-MM-DD",  // optional stale-job cutoff
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

## 10. Step 7 — Set minPublishDate (optional but recommended)

Stale jobs flood the listing and reduce signal quality.
```bash
# Use a cutoff ~90 days back, or inspect oldest published dates in the dry-run sample.
curl -s -X PUT "$BASE/api/sites/$SITE_ID/config" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d "$(echo $CONFIG_PAYLOAD | jq '.minPublishDate = "'"$(date -d '90 days ago' '+%Y-%m-%d')"'"')"
```
Then run `verify-config` again (minPublishDate is not a `fieldMapping` — it survives the analyzer).

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
| 0 / ACTIVE | `PATCH /api/sites/$SITE_ID {"status":"ACTIVE"}`. Log outcome. Done. |
| 2 / SKIP | `PATCH /api/sites/$SITE_ID {"status":"SKIPPED","adminNote":"$REASON"}`. Log. Done. |
| 3 / REVIEW | `PATCH /api/sites/$SITE_ID {"status":"REVIEW","adminNote":"$REASON"}`. Log. Done. |
| 4 / REQUEUE | Append URL to end of work-list with `attempt+1`. If `attempt ≥ 2` → escalate to REVIEW. |
| 1 / ERROR | Check error; if transient retry once; else REVIEW. |

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

---

## 15. Recipes (load on signal — do NOT pre-read all)

Each recipe is in `addsite2-recipes/` and should be loaded **only when the named signal fires**.
Pre-reading all recipes defeats the lean-core cost goal.

| Signal | Recipe file |
|---|---|
| `triage.vendor` is a known ATS (Workday/Greenhouse/Lever/Comeet/iCIMS/SmartRecruiters/Ashby) | `addsite2-recipes/spa-frameworks.md` |
| `detail-reach` exit 2/3, or `browserOverrides.userAgent` needed | `addsite2-recipes/waf-bypasses.md` |
| Field value not extractable by CSS selector | `addsite2-recipes/setupscript-patterns.md` |
| `formStatus: NEEDS_MANUAL` or apply form capture needed | `addsite2-recipes/form-capture.md` |
| `extracted < total` (coverage gap), lazy loading, or "load more" detected | `addsite2-recipes/pagination-and-loading.md` |

---

## 16. Correctness rules (load-bearing — never drift from these)

1. **Code wins over prose.** If a script exits 2, the site is not ACTIVE. Not even if the HTML looks good.
2. **`verify-config` is not optional.** Every PUT must be followed by a successful `verify-config`.
3. **Coverage line is mandatory.** Emit `coverage: X/Y` for every site. Never silently ship page-1-only.
4. **externalJobId must be stable.** Test: two dry-runs must produce identical ids for the same jobs.
5. **Apply path is mandatory for ACTIVE.** No form + no email + no URL = SKIP, not ACTIVE.
6. **REVIEW is not failure.** Routing to REVIEW with an honest reason is a correct outcome and saves both cost and product quality.
