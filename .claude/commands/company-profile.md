---
name: 'company-profile'
description: 'Capture the COMPANY identity behind a jobs site — homepage, about copy, logo, HQ address and city-gated HQ city — and write it to the server. Runs once per site, after onboarding QA has settled that site as ACTIVE. Use when a site needs its company profile captured, backfilled or re-captured.'
platform: 'windows-powershell'
---

<!-- CANONICAL SOURCE — do not edit copies directly.
     Edit THIS file (company-profile.md at the repo root), then run `pnpm sync:skills`.
     Copies kept in sync:
       • .claude/commands/company-profile.md  (CI-checked — drift blocks merges to main)
       • ~/.cursor/skills/company-profile/SKILL.md  (hardlinked locally by sync script)
     If you see this comment in a copy, that copy is stale — run `pnpm sync:skills`. -->

# /company-profile — company identity capture

> **A wrong value is worse than a missing one.** Job rows churn; a company's name,
> logo and address do not, so this runs **once per site** and what it writes tends to
> stay. A missing city leaves a filter empty; a WRONG city fragments the dashboard's
> city filter and nothing downstream repairs it. Every field is gated before it is
> stored, and a candidate that fails its gate becomes NULL, never an off-list value.
> Optimize: **correct fields at low cost — never coverage for its own sake.**

---

## 0. What this captures

| Field | Source, in order of preference | Gate |
|---|---|---|
| `companyHomepageUrl` | operator-supplied → derived from siteUrl → careers-page link → `og:url` | must not be an ATS/vendor/social host |
| `companyAbout` | JSON-LD `description` → about page → homepage prose | boilerplate / promo / error-page filters |
| `companyLogoPath` | JSON-LD logo → `<img>` candidates → rasterised inline `<svg>` | magic bytes, size, not an SVG or favicon |
| `companyHqAddress` | JSON-LD `PostalAddress` → labelled address → street line → compact line | a scanned address must name a `city.csv` city |
| `companyHqCity` | operator-supplied → JSON-LD `addressLocality` → address line → office list | **`CSV files/city.csv` — always** |

The deterministic rules live in `scripts/lib/company-extract.ts` (pure, covered by
`scripts/lib/company-extract.test.ts`). The LLM is a **fallback for fields the rules
could not fill**, never the city — an off-list city cannot be repaired later.

---

## 1. When to run

**Run it once, after the site is ACTIVE.** Onboarding decides whether a site is worth
having at all; this decides what company the jobs belong to. Running it earlier wastes
a browser session on sites that turn out to be SKIPPED or REVIEW.

Do **not** run it for a site that ended SKIPPED, REVIEW or REQUEUE.

### 1.1 The once-only guard
`saveCompanyProfile()` rejects a second write with **409** unless `--force` is passed.
That is deliberate: a re-run must not silently clobber a value someone corrected by
hand. `--all` selects on `companyProfileAt IS NULL`, so a captured site drops out of
the queue on its own.

---

## 2. Run it

```bash
TOKEN=$(cat .claude/scrap-token)          # PowerShell: see §5
npx tsx scripts/company-profile.ts --site $SITE_ID
```

Flags worth knowing:

| Flag | Use |
|---|---|
| `--site <id\|url>` | one site — accepts a cuid or the exact `siteUrl` |
| `--all [--limit N]` | every site with `companyProfileAt = NULL` (backfill) |
| `--dry-run` | scrape and print, **write nothing** — safe to run any time |
| `--no-llm` | deterministic only, never call OpenAI (free, and what CI uses) |
| `--force` | overwrite an existing profile — only for a deliberate re-capture |
| `--probe <url>` | scrape an arbitrary URL, no DB and no token, to debug extraction |
| `--out <path>` | append one JSON result per site, for inspection |

**Always dry-run first on a site you have not seen before:**
```bash
npx tsx scripts/company-profile.ts --site $SITE_ID --dry-run --no-llm
```

---

## 3. Read the result

The run prints one line per site and a JSON summary. Outcomes:

| Outcome | Meaning | Action |
|---|---|---|
| `WRITTEN` | stored on the site row | done |
| `DRY_RUN` | nothing written | inspect, then re-run for real |
| `SKIPPED_ALREADY` | already captured, no `--force` | done — this is correct, not an error |
| `SKIPPED_THIN` | nothing usable found, twice | see §4 |
| `ERROR` | capture threw | exit code **2**; check the error, retry once |

`status` is `COMPLETE` / `PARTIAL` / `FAILED` and describes how many fields landed.
**PARTIAL is a normal, shippable outcome** — plenty of real companies publish no
address at all.

A thin capture (no about, no logo, no address) is **retried once automatically with a
longer settle** before being reported, because the commonest cause is a slow page. It
is never written, so the site stays in the `--all` queue for a later attempt.

---

## 4. When a site yields nothing

Three causes, in rough order of frequency. Diagnose before reaching for the override.

**4.1 An ATS board with no company link.** The careers URL is on a vendor host
(`src/lib/ats-hosts.ts`) that says nothing about the employer and links nothing
belonging to them. No amount of scraping finds the company site.
→ Supply the homepage by hand: the dashboard warns on exactly these sites, or
`PUT /api/sites/:id/company-homepage`. The capture then treats it as authoritative
and starts there. This usually unlocks the address, about copy and logo at once.

**4.2 A bot wall.** Symptom: HTTP 200, a large response, and an **empty rendered DOM**
— no title, no links, no text. `imj.org.il` serves the same ~101 KB obfuscated JS
challenge for every URL. Confirm with `--probe`; if the DOM is empty there is nothing
to extract and no keyword will ever reach it.
→ Operator-supplied city (§4.4).

**4.3 The company simply publishes no address.** Common and legitimate. Check the
contact page, the directions page (`כתובת ותחבורה` / `דרכי הגעה`), the privacy page
and the footer — the capture already reads all of them. If none carries an address,
leave the city NULL rather than inferring one from prose.

**4.4 Operator-supplied values** live in `MANUAL_PROFILE` in
`scripts/company-profile.ts`. Keyed by **site id, never by host** — recruitment
vendors serve several unrelated employers from one domain, so a host key would hand
one employer's city to all of them. Supplied cities still pass through the `city.csv`
gate, so a misspelling warns instead of being stored.

---

## 5. Windows gotchas

```powershell
$TOKEN = Get-Content .claude\scrap-token -Raw | ForEach-Object { $_.Trim() }
```
- The script needs `.claude/scrap-token` and `.env`; both are gitignored, so a fresh
  worktree does not have them.
- Playwright browsers: `PLAYWRIGHT_BROWSERS_PATH=0`.

---

## 6. Correctness rules (load-bearing — never drift from these)

1. **The city comes only from a real address, an office list, or a human.** Scanning
   loose page text for city names was tried and REMOVED (2026-08-30): across 25 live
   sites it produced zero correct cities and two wrong ones, because Hebrew city names
   sit inside ordinary words (`כנות` inside `הסוכנות`, `משמרות` meaning "shifts").
2. **Every city is gated through `CSV files/city.csv`.** Regions (`אזור מרכז`) are
   legal city.csv entries for a JOB but are refused for a company HQ.
3. **A vendor host is never the employer.** ATS, social, and accessibility-widget
   hosts are all refused as homepages — natali was captured with its accessibility
   vendor's identity, logo and prose before that guard existed.
4. **A branch list is not an HQ.** `סניף חיפה 3` must never become `companyHqCity`.
   The one exception is a Latin-script office list where **exactly one** entry is an
   Israeli city — unambiguous by construction.
5. **Never write an empty capture.** Writing FAILED stamps `companyProfileAt` and
   locks the site out of every later attempt, usually for a transient page timeout.
6. **Edit the extraction rules with a real editor, never a `node -e` string replace.**
   Escape sequences in these regexes have been eaten twice that way: a `\b` became a
   raw backspace and `\s`/`\d` lost their backslashes, silently disabling a guard.
   Add a test alongside any rule change — and confirm the test FAILS without it.
