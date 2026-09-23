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
- Never send an `adminNote` longer than **2,000 characters** — the PATCH returns a bare `400` and the note is not updated. Check the length first and re-read after; rewrite a long note compactly rather than truncating it (`LRN-API-9`).
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
| Stored location absent from `city.csv` (exit 2) | `verify-location-csv` | Fix the value, re-scrape, re-run. Never ACTIVE while failing |

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
| Jobs saved with the right titles/ids, but EVERY `setupScript`-injected field is 0% | The script ran before the SPA hydrated — make it poll for a stable item count itself. Do **not** reach for `revealSelector` | [setupscript-patterns.md] §6.3, `LRN-SETUP-13` |

### B2.5 Completeness gate — NEVER activate partial data
Before marking ACTIVE, all of these must hold:
- `fillRates.title ≥ 0.8`
- `fillRates.description ≥ 0.6` (description is the primary job-utility field)
- `formStatus !== "NONE"` (at least one usable apply path)
- `externalJobId` fill ≥ 0.9 (dedup health)
- `verify-location-csv` exits 0 (every location value is a real `city.csv` entry)

If any fails → SKIP with the specific missing field as reason.
**Exception:** if the page provably doesn't expose description (probe `probe.fieldsOnPage.description === false`) → REVIEW (not SKIP); a human can confirm.

> **Location fill is not location correctness.** `verify-config`, `addsite-qa` and
> `verify-jobids` never look at location *values* — a site can report `location=1.00`
> and still ship a name the dashboard's city filter has no bucket for, and **nothing
> auto-repairs it**: the gazetteer and `locationFallback` only fill an EMPTY location,
> never correct a wrong one. The worker gazetteer is also **not** the same list as the
> product's `city.csv` (29 spellings diverge, `LRN-LOC-4`), so passing extraction proves
> nothing about the CSV. Run the gate — especially after any hardcoded or `setupScript`-
> injected location, which overrides the gazetteer outright (`LRN-LOC-1`).
> Caught 10 bad values on flying-cargo (`צריפין`) that all four other gates passed
> (`LRN-WP-3`). `Unknown` is an accepted value; multi-location jobs are fine provided
> **every** element of `locations[]` is an exact entry.
> **Caveat:** the script reads only the first page (`pageSize=100`, and >100 silently
> returns `[]` — `LRN-API-1`), so on a 100+ job site it validates a sample, not the set.

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

### 2.1 Embedded-ATS gate — check BEFORE logging RED/GRAY/SKIP (`LRN-SPA-4`)

A `RED`/`GRAY` verdict (or a page whose HTML has no jobs) is frequently a **jobs board
embedded via a cross-origin `<iframe>`** — the worker fetches the wrapper page, sees only
an iframe it can't read into, and the site gets **falsely SKIPPED**. Before you SKIP or
route to REVIEW, probe the wrapper page for an ATS iframe and onboard the iframe's URL
instead.

**`triage` now does this for you:** when it finds a cross-origin ATS iframe it sets
`lane: "GREEN"` and emits an **`embeddedBoardUrl`** field — re-run triage on that URL and
onboard it (skip the manual probe below). The manual probe is only a fallback if you're not
using `triage` (e.g. eyeballing a page in the browser):

```js
// in the browser / a Playwright eval on the wrapper page:
[...document.querySelectorAll('iframe')].map(f => f.src)
// look for: comeet.com|comeet.co, greenhouse.io/embed, smartrecruiters.com,
//           jobs.lever.co, ashbyhq.com, icims.com, myworkdayjobs.com,
//           app.civi.co.il/promos (Civi board — LRN-SPA-8)
```

If an ATS iframe is found:
1. **Re-run triage on the iframe `src`** (the board URL) — it will fingerprint GREEN.
2. Onboard that **board URL** as the `siteUrl` (not the wrapper page).
3. Set `companyName` to the real employer; leave an `adminNote` on the wrapper-page
   record (if one exists) pointing at the board-URL site.

Only after this probe comes back empty should a `GRAY`/`RED` page be SKIPPED/REVIEWed.
Reference: bsel.co.il (Comeet board embedded; onboarded `betshemeshengines`, 35 jobs).

### 2.2 WordPress job CPT gate — check BEFORE accepting GRAY (`LRN-WP-1`)

A `GRAY` verdict on a WordPress site is frequently a **false negative**. Many Israeli
company sites use a WordPress custom post type (`job` / `position` / `career`) with a
clean listing page and individual detail pages at `/job/<slug>`. These are trivially
scrapable (server-rendered HTML, semantic selectors, no anti-bot) but the `topCluster`
heuristic can miss them when the listing has few items (≤ 3 jobs).

**`triage` now auto-detects this:** when it sees WordPress markers (`wp-content`,
`wp-json`, generator meta) **plus** job CPT signals (`/job/` link hrefs, `single-job`
/ `job-template` / `type-job` body classes), it emits `vendor: "wordpress-job-cpt"`
and classifies GREEN. If triage still reports GRAY on a WordPress-looking page, do a
manual check before accepting:

```js
// in the browser on the listing page:
[...document.querySelectorAll('a')].filter(a => /\/job\/|\/position\/|\/career\//.test(a.href)).map(a => a.href)
```

If links point to individual job pages (e.g. `/job/analytical-chemist-al3`) → treat as
**YELLOW** (novel but scrapable), not GRAY. The listing `itemSelector` is typically
`li.item`, `article.job`, or similar, and detail pages have structured content in
`.box-content`, `.entry-content`, or the theme's content wrapper.

Reference: labs-eco.com (WordPress `job` CPT, 3 jobs, falsely GRAY'd due to small
cluster size; straightforwardly scrapable with `li.item` + `/job/<slug>` detail pages).

### 2.3 Careers-hub gate — ONE employer is ONE site (`LRN-CO-2`)

A careers page that links several listing pages of the **same employer** is a careers
**hub**, not a dead end. It has no jobs of its own — but its jobs are one click away,
split by department.

**Run this check on EVERY lane, not just `GRAY`.** A hub having no jobs does NOT make it
`GRAY`: `topCluster` counts repeating markup, and on a storefront or a heavily themed
site the biggest repeating block is the site's own chrome. renuar.co.il's hub
`/pages/דרושים` carries **zero** job rows and still triages
**`YELLOW`, `topCluster: 28`** — those 28 are sidebar navigation links. Take that lane at
face value and §3 builds a config against the menu: the rows extract, the completeness
gates (§B2.5) fail them for having no description and no apply path, and the site is
SKIPPED or REVIEWed while a real 37-job employer goes unonboarded.

**The tell, before you build anything:** the rows you are about to extract carry no job
signal — no req number, no per-row detail link, titles that read like navigation or
product categories — and/or the page links to two or more same-host pages that
content-verify as listings (below). Either one means: stop and treat it as a hub.

**Onboard it as ONE site with `listingUrls`, never one site per link.** Company identity
lives on the site row — `companyName`, the about copy, the HQ city, and the logo at
`/logos/<siteId>.png` — and the public jobs site reads that row. Three sites for three
department pages publishes the same employer three times over, each with its own logo and
its own profile, and nothing downstream merges them.

Identify the listing pages **by content, never by link text** (a CTA gets reworded and
discovery silently returns fewer pages). Fetch each same-host candidate and keep the ones
that actually carry repeating job markup:

```bash
# for each same-host /pages/* | /careers/* link on the hub:
npx tsx scripts/addsite-batch.ts triage --url "$CANDIDATE"
```

A non-`GRAY` lane on the candidate is **not** enough on its own — that is the same trap
as the hub's own 28-link nav cluster. Confirm the candidate's rows look like jobs (req
numbers, per-row detail links, or role-shaped titles) before you count it as a listing
page. A candidate whose cluster is the same size as the hub's is chrome, not jobs.

Then:

- **`siteUrl` = the hub.** It is the company's careers page, it is what the dashboard
  shows, and `company-profile` derives the homepage from it. It is NOT scraped.
- **`listingUrls` = every listing page**, including the one you would otherwise have
  onboarded alone. The list REPLACES `siteUrl` as the scrape target set, so a page missing
  from it is a page that stops being published. **Never list the hub itself** — it yields
  0 items every night.
- All pages normally share one config (same template, same `itemSelector`). If they
  genuinely differ, route to REVIEW: per-page config overrides do not exist yet.
- Cite `LRN-CO-2`; the worker contract is `LRN-WRK-21`.

Reference: renuar.co.il — hub `/pages/דרושים` (0 jobs, but triages `YELLOW`
`topCluster: 28` off the storefront nav) linking `/pages/stores-and-points-of-sale` (28),
`/pages/company-headquarters` (8) and `/pages/logistics-operations` (1). One site,
37 jobs, one company. Renuar itself is **not** the shape to copy: it was already live on
the stores page, and `siteUrl` is `@unique` and not patchable, so it keeps that URL and
lists all three pages. A site onboarded fresh from the hub gets the hub as `siteUrl`.

> **This is not pagination.** `pagination` walks pages 2..N of ONE listing;
> `listingUrls` is several DIFFERENT listings. And it is not a `setupScript` that
> fetches the other pages: that hides a page going dark, and the script cap is 8,000
> characters (`LRN-API-7`).

---

## 3. Step 1 — Duplicate check

```bash
# Exact match + normalized variants
curl -s "$BASE/api/sites?siteUrl=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' "$URL")&pageSize=10" \
  -H "$AUTH" | jq '.data[]? | {id, siteUrl, status}'
```
Also check: trailing-slash variant, http↔https swap, www/no-www prefix.

**Then check the host, not just the URL.** A second jobs page for the same employer on
another path or subdomain matches none of the variants above. Use `urlSearch` (partial
match on `siteUrl`) and, when the company is known, `companyNameSearch`:
```bash
curl -s "$BASE/api/sites?urlSearch=<registrable-domain>&pageSize=10" -H "$AUTH" | jq '.data[]? | {id, siteUrl, status}'
```
**LANDMINE:** `?search=` is not a parameter — it is silently ignored and returns every
site, which looks like a result. A host hit is not automatically a duplicate (one host
can serve several employers; a company can run two boards) — look before creating.
Cite: `LRN-API-8`.

| Result | Action |
|---|---|
| Row's `siteUrl` **differs from what you asked for** | This URL is already one of that site's `listingUrls` — it is covered. Log `SKIPPED (covered by <id>)`. **Do not onboard onto that row**: a single-URL PUT would replace its `listingUrls` and stop publishing its other pages. |
| Status `ACTIVE` | Report existing site, no action. Log `ACTIVE (already existed)`. |
| Status `SKIPPED` or `FAILED` | If `--force`: reactivate (§B1.5). Else: log `SKIPPED (existing, no --force)`. |
| Not found | → §4 create |

> The exact `?siteUrl=` filter matches a site's `siteUrl` **or** any URL in its
> `_meta.listingUrls` — that is what stops a company's second department page from
> becoming a second company. Always compare the returned row's own `siteUrl` with the URL
> you queried. Cite: `LRN-CO-2`.

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

> **Where the name comes from when the work-list has none:** the company's own spelling —
> its logo, or its legal name as printed (`בע"מ`) — **not** the page `<title>`. heara.co.il's
> title read `הארה תכניות העשרה בעמ`; its logo reads `הארה תוכניות העשרה בע"מ`. The public
> jobs site shows this string as-is (`LRN-LOGO-2`).
>
> Keep the JSON UTF-8 / BOM-free (§15); Hebrew company names pass through verbatim.
> The `addsite-batch.ts` create path already does this PATCH-after-create — **if you
> create sites with a custom/hand-rolled script, you MUST replicate the PATCH + verify**,
> or the dashboard ships nameless. Cite: `LRN-WRK-7`.

**Immediately wait for ANALYZING to leave** — the server auto-enqueues an ANALYSIS job that will **overwrite your config** if you PUT before it finishes.

**LANDMINE — there is no `GET /api/sites/:id`.** That route exports **PATCH and DELETE
only**, so a GET returns **405 with an empty body** and `.data.status` is `undefined` on
every tick — the loop below runs its full 24 iterations and observes nothing, whatever the
site is doing. Poll the **list route with an exact-URL filter** instead. Cite: `LRN-API-6`.

```bash
for i in $(seq 1 24); do   # max 2 min
  STATUS=$(curl -s "$BASE/api/sites?siteUrl=$(jq -rn --arg u "$URL" '$u|@uri')&pageSize=10" \
    -H "$AUTH" | jq -r '.data[0].status')
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
- Workday/Greenhouse/Lever/Comeet/iCIMS/SmartRecruiters/Ashby/Civi → read `addsite2-recipes/spa-frameworks.md`

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
| `externalJobId` | (1) Native job ID attr (`data-job-id`, `data-id`), **or a req number printed in the title** (`"משרה 231: …"` → regex it out). (2) Slug from `detailUrl` — **only when the slug is Latin/ASCII.** A Hebrew (non-Latin) slug is **never** the id, neither percent-encoded (`%d7%a0…`, a 200-char blob) nor decoded (raw Hebrew): hash it — `<site>-` + `haideHash(decoded slug)` with the recipe's djb2 (`madanes-1gfcy2f`; recipe §3, `LRN-ID-6`). `verify-jobids` only **warns** on non-ASCII ids, so a raw Hebrew slug passes every gate and ships (iforc.co.il did, 2026-09-17, and had to be re-keyed). (3) Hash of title+department+location (stable, disambiguated). **Never index-based.** **The worker now backstops this**: when extraction yields no id it synthesises `h-<hash(title|department|detailUrl)>` itself, so 0% fill is no longer possible (`LRN-WRK-17`). A hand-written hash is now an optimisation, not a requirement — a native id is still better, and the run warns `synthesised_external_job_id` when the fallback is used. **CAUTION:** a printed "job number" field (e.g. `numberJob`) can be reused across distinct postings by the same recruiter — verify uniqueness. Prefer the unique record ID (e.g. CMS `_id`) when a printed number collides. If `saved jobs < API count` after scraping, the id field is non-unique. **NAMESPACE a bare numeric req number** (`LRN-ID-11`): `verify-jobids` rejects any id matching `/^(item[-_]?)?\d{1,4}$/` as index-based, and it cannot tell the employer's own `4907` from a row index. Store `<site>-4907`, not `4907` — same stable native key, self-describing, and it clears the gate. Do it on the FIRST config: the id is the dedup key, so prefixing later re-keys every job. Expect `addsite-qa` to then flag the mirror-image suspect (`looks like URL/title slug`) because the code also appears in the detail URL — settle that with evidence (all ids match `^<site>-\d+$`, each code equals its own detail-URL segment, distinct == total) and record it in `adminNote`. |
| `description` | Often only on the detail page — map `detailUrl` and let worker fetch it. **Locate the body by dumping the FULL visible text** of a detail page (render it, print `innerText`) and finding the prose container — do NOT guess semantic selectors (`.order_description`) and give up when they're absent; the real body may live in a differently-named block (`.job_desc`). **Never substitute metadata (category/area/clinic/department) for a real description** — a 1–2 line metadata string that trips the QA correctness suspect "description present but avg N chars while detail body is >X chars" is a BLOCKER, not shippable (`LRN-SETUP-4`). **If the detail page splits the body into labeled sections (תיאור / דרישות / כישורים / תנאים), the analyzer maps only ONE — capture them all**, but split them: requirements-class sections go to `requirements`, the rest merge into `description` (setupScript §8, *Job body rules* below). **If the text comes back as one run-on line, preserve block line breaks** via the `structuredText` helper — NEVER `.replace(/\s+/g,' ')` (setupScript §7). **Capture the COMPLETE body — never cherry-pick only the headings you recognise.** A detail-fetch that grabs only `description`+`requirements` silently drops the meta block (employment type, hours, **division/department**) and intro lines that the site shows per job. Route typed meta into its own field, fold the rest into `description` (setupScript §11, `LRN-SETUP-3`). |
| `detailUrl` | Anchor `href` inside item; must be stable (not JS-generated blob). **Cards with no http href are silently DROPPED** — Navigate Mode builds its output only from collected detail URLs, so a `mailto:`/`tel:`/JS apply target means that job never becomes a row (pac.ac.il: 7 cards, 6 jobs). On a site with mixed apply paths this loses only the odd ones out. Decide deliberately and record it in `adminNote` (`LRN-WRK-16`). |
| `location` | Direct selector; `setupScript` if embedded in a formatted string or in the title (split on dash); or **hardcode a constant** (inject `.__ai-location`) for a confirmed single-office / nationwide employer — this **overrides the gazetteer** (`locationFallback` only fills when extraction is empty, so it can't fix a wrong gazetteer guess) (`LRN-LOC-1`). |
| `publishDate` | If not in item DOM → skip (don't block ACTIVE on a missing Tier-B field). |
| `deadline` | First-class field (dashboard "Application Deadline"). If the job prints an apply cutoff (e.g. `ניתן להגיש מועמדות עד לתאריך D.M.YYYY`), parse → ISO and map it. To **drop past-deadline jobs**, do it in setupScript (no worker drop-expired exists) — setupScript §12, `LRN-WRK-10`. |
| `requirements` | **Its own field, never duplicated in `description`** — owner rule, see *Job body rules* below. Route דרישות / כישורים / Qualifications / Skills sections here, preserving line breaks (§7), and remove them from the description (setupScript §8–9, `LRN-SETUP-10/15`). On a **Wix repeater** it's a separate `comp-*__item-<suffix>` the analyzer misses — recover via the shared suffix (`LRN-SPA-6`). |

**Job body rules — the owner's, apply them on the FIRST config (don't wait to be asked):**
These were each raised as a correction on a live site (heara.co.il, news.ipvsecurity.com,
enviro-services.co.il — 2026-09-15/16) and confirmed as fleet-wide. They decide *which field*
text lands in; they never rewrite the employer's words (publish content as-is).
1. **Requirements live only in `requirements`.** A דרישות / כישורים / Qualifications line is
   moved, not copied — the description must not repeat it. **A requirement line with no heading
   is still a requirement** ("ניסיון-חובה"); the intro/role line, hours and pay stay put —
   classification rules and the traps in `LRN-SETUP-18`.
2. **Drop the section labels themselves** (`תיאור-`, `דרישות-`, `תיאור התפקיד:`). The field
   already says what the text is.
3. **A pay sentence on a requirements line stays in `description`.** `דרישות - ניסיון בהדרכה…
   שכר של 75 ש"ח…` → the requirement moves, the `שכר…` part stays. Pay is not a requirement.
4. **A closing section shared by every job on the page** (training/travel pay, employment terms,
   "כל המשרות לנשים וגברים כאחד") **is appended to every job's `description`.** A job page shows
   one job, so text printed once for all of them must travel with each.
5. **A group posting with numbered sub-tracks becomes one job per track** (`משרה 100` listing
   `משרה 101 - מדריך טיסנאות`, `משרה 102 - …`). Each track gets the group's shared text plus its
   own line; the group itself is not published. A number the page also uses for a standalone
   posting belongs to the standalone posting. **On a listing-only site that clones the card per
   track, give every clone a distinct card href (`#<n>`)** — the worker dedups items on the card
   link, so identical clones silently collapse back into one job (`LRN-WRK-20`).
6. **How-to-apply lines leave the description.** When the apply path is email, the page's own
   instruction for that email goes to `applicationInfo` with the job's number (Step 5a). On a
   staffing-agency board, the agency's own name/office/recruiter lines go too — but only lines
   proven to be the agency's; a number that may be the hiring company's stays (`LRN-SETUP-17`).

Recipe for a page that prints every job as one block of prose: setupScript §13, `LRN-SETUP-16`.

**Coverage gate — MANDATORY:**
Establish the true total before submitting. Never silently ship only page 1.
```
# Count items in DOM, compare against total displayed on page ("Showing 1–20 of 87 jobs")
# Emit: coverage: <extracted>/<total>
# With listingUrls (§2.3), emit ONE LINE PER PAGE plus the site total:
#   coverage: <url>=28/28, <url>=8/8, <url>=1/1  → site 37/37
```
If extracted < total and you haven't handled pagination → read `addsite2-recipes/pagination-and-loading.md`.

**LANDMINE:** `externalJobId` must survive a re-scrape unchanged. Test: scrape twice, compare ids.

**The coverage gate is never re-run once a site is live.** It is an onboarding step,
and nothing re-checks an ACTIVE site — which is how l-w.ac.il served 9 of its 60 jobs
for months. "Did we get everything?" is three separate checks with different limits;
only two can ever be automatic, and the one that actually answers the question needs
ground truth the worker does not hold. Read `LRN-COV-5` before trusting a job count.

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
- **Wait for the items yourself on any client-rendered listing** (`LRN-SETUP-13`). The
  worker runs `setupScript` immediately after the body becomes non-empty and **BEFORE**
  its own `autoScrollUntilStable()`, so on a React/Next/Vue island the script fires
  against **0 items**. Nothing errors: extraction runs later once the cards exist, so
  the DOM-sourced fields report 100% and only the injected ones are empty — it reads
  like a bad selector, not a race. Poll for the items and require the count to be
  **stable**, so a half-hydrated list isn't half-enriched:
  ```js
  var prev = -1, stable = 0;
  for (var t = 0; t < 60; t++) {            // ≤30s, inside the 90s setupScript budget
    var n = document.querySelectorAll(ITEM_SEL).length;
    if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
    prev = n;
    await new Promise(function (r) { setTimeout(r, 500); });
  }
  ```
  **`revealSelector` is NOT the fix here.** It does gate the setupScript (the worker
  waits up to 20s for it), but extraction ALSO **clicks** it once per item
  (`findReveal()` → `reveal.click()`). When the item *is* the job anchor
  (`itemSelector: "a.job-card-wrap"`), that navigates the page away, once per row.
  Reserve `revealSelector` for a genuine accordion toggle that is not itself the item.
- **A dry-run that calls `waitForSelector` first cannot reproduce this** — it hands the
  script a populated DOM the worker never gives it. Mirror the worker instead:
  `goto(domcontentloaded)` → `waitForFunction(document.body.children.length > 0)` → run
  the script, and print the item count at entry. `cards at setupScript entry: 0` is the
  whole bug in one line.
- **No named functions inside anything `page.evaluate` serialises.** tsx compiles with
  `keepNames`, which wraps every named function in a `__name(...)` call that does not
  exist in the page, so the evaluate throws on its first line. If a `catch` returns a
  default, that surfaces as "found nothing" — silent. Inline the helper.

---

## 7. Step 5 — Dry-run (local, non-mutating)

Preview the proposed config **locally** with the shared Playwright dry-run. It
renders the page and prints how many items your `itemSelector` matches plus a
field sample — and mutates nothing (no site, no worker job, no config write):

```bash
npx tsx sites/_shared/dryrun.ts '{
  "url": "'"$URL"'",
  "itemSel": "<itemSelector>",
  "listingFields": { "title": {"selector":"..."}, "externalJobId": {"selector":"..."} },
  "scroll": true,
  "detailUrl": "<optional sample detail URL>",
  "detailFields": { "description": {"selector":"..."} }
}'
# Prints  LISTING: { count, samples[] }   (+ DETAIL: {...} when detailUrl is set)
```

> **Do NOT use `POST /api/sites/:id/analyze` as a dry-run.** It ignores the
> request body, enqueues a full **mutating** ANALYSIS job (the analyzer
> re-derives `fieldMappings` and can overwrite your config — the analyzer race,
> `LRN-RACE-1/2`), and returns a `WorkerJob` record, not jobs. Config preview is
> local (above); the real ship gates run **after** a scrape (`verify-config`,
> `addsite-qa`, `verify-jobids`).

> **Minimum job count = 2.** A site is only skipped on volume when it yields
> **fewer than 2 jobs** (0 or 1). 2+ valid jobs is shippable — never SKIP a site
> just because the count is "low" or "thin" (e.g. 2–4 jobs). Job count is NOT an
> ROI/complexity judgment call; the only volume bar is `< 2`.
>
> **With `listingUrls` (§2.3) the bar is the SITE total, not the page.** A
> one-job logistics page inside a 37-job employer is a department, not a site,
> and skipping it would drop a real job from a company that is shipping.

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
**Turnstile/CAPTCHA gate — classify the captcha BEFORE skipping (`LRN-APPLY-10`):**
"has a captcha" is NOT one verdict. Two distinct cases:
- **Blocking challenge** (Cloudflare Turnstile, reCAPTCHA **v2** checkbox/challenge):
  fires *before* the form is reachable, fields never render → `formStatus: NONE`,
  SKIPPED. Log `LRN-APPLY-1` / `LRN-APPLY-3`.
- **Invisible / score-based** (reCAPTCHA **v3**): the form renders in full and every
  field is readable — the captcha gates **submission**, not **capture**. → **Capture the
  form normally.** Keep the careers email / apply URL in `applicationInfo` as a parallel
  fallback, and note in `adminNote` that the token is browser-generated (~2 min TTL), so
  a server-side POST of the static fields alone will fail.

  v3 markers: `recaptcha/api.js?render=<sitekey>` (a `render=` param, not a rendered
  widget), a hidden `g-recaptcha-response` / `_wpcf7_recaptcha_response` input, or
  `window.grecaptcha` defined with **no** visible checkbox/challenge iframe.

  Do NOT ship email-only on a v3 form — that discards a real CV-upload path. Cite:
  `LRN-APPLY-10` (minrav.co.il, WordPress + Contact Form 7).

**Multi-form pages — enumerate ALL forms, then rank:** a page can carry 3+ forms,
some behind **secondary buttons/modals** (the most prominent "apply" button may open
a **blocking-captcha-gated** form while a less obvious button opens a usable one). List
every `<form>`, classify EACH captcha per the gate above, and pick by this order:
**(1) captcha-free CV-file-upload form → (2) captcha-free contact/lead form →
(3) v3-only form (capturable — see above) → (4) blocking-challenge form = unusable.**
Don't stop at the first captcha-free form — prefer
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
**LANDMINE — apply page with NO `<form>` element (TopMatch/RedMatch):** on
`careers.topmatch.co.il/<tenant>/redmatch-apply/redmatch.apply.html` the apply fields
are **bare inputs with empty `name`s, not wrapped in a `<form>`** — worker auto-capture
finds 0 forms even on the apply page. Build a static `formCapture`, deriving each field
`name` from its CSS class (`first-name`/`Email`/`uploadeFile`/`cityBase`…) and setting
`formSelector` to a bare-input class that never appears on the listing (e.g.
`input.inputfile.CV`) to force the static fallback. It's a shared multi-tenant platform —
the same `formCapture` shape works for every TopMatch tenant. Cite: `LRN-APPLY-9`;
full field table in `form-capture.md` §9.

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
  "pageFlow": [],                  // REQUIRED — [] for a listing-only site
  "formCapture": null,             // REQUIRED — the captured object from §8, or null
  "listingUrls": ["…/a", "…/b"],   // optional — several listing pages of ONE employer (§2.3);
                                   //   REPLACES siteUrl as the scrape target set; same host
  "browserOverrides": { ... },     // if reachability required UA
  "setupScript": "...",            // if fields required injection
  // minPublishDays / minPublishDate — no longer needed; see §10
  "minPublishDate": "YYYY-MM-DD",  // optional — only to set a hard frozen floor (rare)
  "bypassCSP": true                // if setupScript XHRs a different subdomain
}
```

**LANDMINE — `pageFlow` and `formCapture` are REQUIRED, and omitting them 400s opaquely.**
`updateSiteConfigSchema` (`src/lib/validators.ts`) types `pageFlow` as an array and
`formCapture` as an object-or-`null`; neither is `.optional()`. A payload without them
returns `VALIDATION_ERROR: Invalid input: expected array, received undefined, Invalid
input: expected object, received undefined` — which **names neither key**, so the obvious
next move is to start guessing at `fieldMappings`. The double-PUT (§9.2) means you see it
twice, 8 s apart, and `verify-config` then fails because no config was ever written, which
reads like the analyzer race (`LRN-RACE-2`) it is not. Minimum for a listing-only site:
`"pageFlow": []` and `"formCapture": null` (`null` is also the correct value for an
email-apply site, §12 Step 5a). Cite: `LRN-API-6`.

**LANDMINE — a PUT REPLACES the config; every optional key you leave out is CLEARED.**
`saveSiteConfig()` rebuilds `fieldMappings._meta` from the payload alone, so `formCapture`,
`setupScript`, `listingUrls`, `browserOverrides`, `pagination`, `loadMoreSelector` and
`locationFallback`
are each written as "the value you sent, else null". This is not a merge. On **any** later
PUT — a one-line selector fix, a re-PUT to win the analyzer race — **resend the full
`formCapture` object and the full `setupScript`**, or the apply path and the injected
fields vanish silently: extraction still succeeds, the DOM-sourced fields still report
100%, and only the injected ones go empty. Re-run `verify-config` with
`--expect-form-fields N` after every PUT, not just the first.

> **On a multi-page site this is the one that bites (§2.3).** Dropping `listingUrls`
> turns a company back into its primary page and stops publishing every other
> department. The worker now refuses rather than shrink — the next **scheduled** run ends
> `COMPLETED` + `listing_urls_removed`, writes nothing, and names the pages whose jobs it
> still holds — but a **manual** run treats it as you retiring the page deliberately and
> proceeds. Re-run `verify-config --expect-listing-urls …` after every PUT. Note the
> Chrome extension's Save rebuilds `_meta` from seven keys and drops the rest, so it
> clears `listingUrls` too (as it already clears `pagination` and `setupScript`).

**LANDMINE — `setupScript` is capped at 8,000 characters, and `verify-config` cannot see a
rejected script.** A longer script makes the PUT return `VALIDATION_ERROR: Too big: expected
string to have <=8000 characters` and writes **nothing** — the previous config stays live.
`verify-config` then still exits 0, because it checks `itemSelector`, field names and form
fields, never the script; a scrape triggered next runs the **old** script and passes every gate.
After every PUT, read `fieldMappings._meta.setupScript` back from the list route and compare it
byte-for-byte with what you sent; stop if it differs. To get under the cap, cut comments and
duplicated helpers, and prove the shorter script yields identical jobs in the dry-run before
re-PUTting. Cite: `LRN-API-7`.

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
  [--expect-form-fields N] [--expect-listing-urls "<url>,<url>"]
# Exit 2 = config was clobbered → re-PUT and verify again (max 2 retries, then REVIEW)
```
**LANDMINE:** never mark ACTIVE without passing `verify-config`. Exit 2 means the analyzer race won and your config is gone. Cite: `LRN-RACE-2`.
**Exit 0 does not prove a `setupScript` was saved** — compare the stored script too (§9.1, `LRN-API-7`).
**On a multi-page site (§2.3), always pass `--expect-listing-urls`** — it is an EXACT set
match, so a page missing from the stored config exits 2 instead of quietly becoming a
department that no longer publishes.

---

## 10. Step 7 — Age-bucket flagging (replaces stale-job cutoff)

**`minPublishDays` and `minPublishDate` are now inert — do not set them.**
The worker keeps every job regardless of age and assigns an `ageBucket` field
at scrape time: `fresh` / `d90` / `d180` / `d365`. Old jobs surface in the
dashboard with colored age-counter badges; the Jobs page age-filter lets you
drill by bucket. You no longer need to gate scrapes on publish age.

**No dates = no bucket = looks fresh.** `ageBucket` comes from `publishDate`; a job
without one gets no badge, exactly like a job posted today, and no gate notices. When
a site gives no job dates, spend one request on a staleness signal — WordPress `/feed/`
`lastBuildDate`, a sitemap `lastmod`, dead shortcodes like `[easy-social-share]` — and
**tell the owner before activating**. It is the owner's decision, not a SKIP rule; record
it in `adminNote`. news.ipvsecurity.com: feed last built 2020-04-01, all gates passed,
owner chose ACTIVE with a note to confirm the roles (`LRN-AGE-1`).

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
- **If the page says what to put in that email** ("בציון מספר משרה, פירוט זיקה מקצועית"),
  that instruction goes into `applicationInfo` after the address, with the job's own number
  inserted — and the how-to-apply lines are removed from `description` (owner rule, heara.co.il
  2026-09-16):
  `mailto:jobs@heara.co.il - בציון מספר משרה 101, פירוט זיקה מקצועית והדרכה.`
  Read the instruction from the page inside the `setupScript` rather than hardcoding it, so a
  rewording flows through the nightly scrape. It is **one line**: the normalizer collapses
  whitespace in `applicationInfo`, so line breaks do not survive. `addsite-qa` still reports
  `formStatus: EMAIL` (it finds the address anywhere in the field). Cite: `LRN-SETUP-16`.
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

**location gate (MANDATORY before ACTIVE) — values, not fill rate:**
```bash
npx tsx scripts/verify-location-csv.ts --site-id $SITE_ID
# Exit 2 = at least one stored location is not a verbatim "CSV files/city.csv" entry
```
Checks `location` and every element of `locations[]` against the product's city list
(`Unknown` is the accepted sentinel for "job states no location"). No other gate reads
location values, and a wrong value is never auto-repaired — the gazetteer and
`locationFallback` only fill an EMPTY location. Exit 2 → fix the value (map it to the
canonical entry in `setupScript`, or fall back to the site's own region/area if no city
is defensible), re-PUT, re-scrape, re-run. Do **not** mark ACTIVE while it fails.
Cite: `LRN-LOC-4`, `LRN-WP-3`.

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

## 14. Step 11 — Company profile (ACTIVE sites only)

Onboarding decides whether the site is worth having; this decides **which company**
its jobs belong to. Hand off to the `/company-profile` skill:

```bash
npx tsx scripts/company-profile.ts --site $SITE_ID
```

**Run it LAST, and only on the ACTIVE path.** A site that ended SKIPPED, REVIEW or
REQUEUE must not be captured — it would spend a browser session on a site whose jobs
are not shipping, and stamp `companyProfileAt`, dropping it from the backfill queue
that `--all` feeds.

Gate it on the verdict you already have:

| Verdict from §12 | Company profile |
|---|---|
| ACTIVE (after the externalJobId gate passes) | **run it** |
| SKIP / REVIEW / REQUEUE / ERROR | skip — leave `companyProfileAt` NULL |

This step is **advisory, never a blocker**. The site is already ACTIVE and its jobs
already ship; a company profile is decoration on top. Outcomes:

- `WRITTEN` — done.
- `SKIPPED_ALREADY` — already captured. Correct, not an error; do not `--force`.
- `SKIPPED_THIN` — nothing usable found, after an automatic patient retry. Leave it;
  the site stays in the `--all` queue. **Do not** mark the onboarding a failure.
- `ERROR` (exit 2) — retry once. If it fails again, leave it and move on.

If the site sits on an ATS/vendor host, the capture cannot derive a homepage and will
come back thin. Supply one — `PUT /api/sites/$SITE_ID/company-homepage` — and re-run;
that usually unlocks the address, about copy and logo together. See `/company-profile`
§4 for the full diagnosis path, and never let this step hold up the verdict.

---

## 15. Windows gotchas

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

## 16. Recipes (load on signal — do NOT pre-read all)

Each recipe is in `addsite2-recipes/` and should be loaded **only when the named signal fires**.
Pre-reading all recipes defeats the lean-core cost goal.

| Signal | Recipe file |
|---|---|
| `triage.vendor` is a known ATS (Workday/Greenhouse/Lever/Comeet/iCIMS/SmartRecruiters/Ashby/Civi) | `addsite2-recipes/spa-frameworks.md` (Civi → `#civi`, `LRN-SPA-8`) |
| `detail-reach` exit 2/3, or `browserOverrides.userAgent` needed | `addsite2-recipes/waf-bypasses.md` |
| Field value not extractable by CSS selector; description is one-line or missing labeled sections (דרישות/כישורים); id/location in title | `addsite2-recipes/setupscript-patterns.md` |
| `formStatus: NEEDS_MANUAL` or apply form capture needed; **Wix apply button opens a lightbox** (`aria-haspopup="dialog"` + `data-popupid`, no href); **TopMatch/RedMatch apply page** (`careers.topmatch.co.il/<tenant>/redmatch-apply/redmatch.apply.html`, no `<form>` element) | `addsite2-recipes/form-capture.md` (§8 Wix lightbox `LRN-APPLY-8`; §9 TopMatch/RedMatch `LRN-APPLY-9`) |
| **Wix repeater** jobs board (`comp-*__item-<suffix>` rows), or a **Niloos/Hunter minisite** (`minisite.niloos.ai`, reCAPTCHA SPA) | `addsite2-recipes/spa-frameworks.md` (#wix / #niloos) |
| Job prints an **apply deadline**; need to drop past-deadline jobs | `addsite2-recipes/setupscript-patterns.md` (§12, `LRN-WRK-10`) |
| `extracted < total` (coverage gap), lazy loading, or "load more" detected | `addsite2-recipes/pagination-and-loading.md` |
| A careers **hub** linking several listing pages of one employer (jobs split by department) | §2.3 — one site with `listingUrls`, never one site per link (`LRN-CO-2`). Not pagination. |

---

## 17. Correctness rules (load-bearing — never drift from these)

1. **Code wins over prose.** If a script exits 2, the site is not ACTIVE. Not even if the HTML looks good.
2. **`verify-config` is not optional.** Every PUT must be followed by a successful `verify-config`.
3. **Coverage line is mandatory.** Emit `coverage: X/Y` for every site. Never silently ship page-1-only.
4. **externalJobId must be stable AND verified by code.** Never mark ACTIVE without a passing `verify-jobids` (exit 0). The id is the dedup key: raw-title reuse, index-based, or all-identical ids are blockers. Prefer `h-<hash>` synthesis (recipe §3). Prose intent is not enough — the gate checks the real values.
5. **Apply path is mandatory for ACTIVE.** No form + no email + no URL = SKIP, not ACTIVE.
6. **Location values must be verified by code, not by fill rate.** Never mark ACTIVE without a passing `verify-location-csv` (exit 0). A 100% location fill says nothing about correctness — no other gate reads the values, and nothing auto-repairs a wrong one. Cite: `LRN-LOC-4`, `LRN-WP-3`.
7. **REVIEW is not failure.** Routing to REVIEW with an honest reason is a correct outcome and saves both cost and product quality.
