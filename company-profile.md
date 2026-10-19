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
| `companyAbout` | JSON-LD `description` → about page → homepage prose | boilerplate / promo / error-page filters, then **longest paragraph of the lede only** (§7.8) |
| `companyLogoPath` | JSON-LD logo → rasterised header `<svg>`, inline or `<img src="*.svg">` → `<img>` candidates | magic bytes, size, not a favicon; an SVG reaches the server only as a rasterised PNG |
| `companyHqAddress` | JSON-LD `PostalAddress` → labelled address → street line → compact line | a scanned address must name a `city.csv` city |
| `companyHqCity` | operator-authored (§4.4) → JSON-LD `addressLocality` → address line → office list; the company's own site only, never a web lookup (§5) | **`CSV files/city.csv` — always** |

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
TOKEN=$(cat .claude/scrap-token)          # PowerShell: see §6
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
| `--replace-logo` | a stored logo is **kept** (the logo step is skipped) unless this is given; `--force` alone never replaces it |
| `--replace-field <name>` | repeatable; overwrite a profile field the operator set by hand in the dashboard (`companyAbout`, `companyHqAddress`, `companyHomepageUrl`). Without it, every field listed in `Site.companyOperatorFields` is left out of the write and keeps its value, with `--force` too; the run prints which fields it kept |
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

### 3.1 Verify the VALUES, never the counts — MANDATORY before a real run

`COMPLETE` and `withLogo: 1` say a field **landed**, not that it is **right**. Every
gate in this pipeline checks SHAPE — magic bytes, dimensions, city.csv membership,
boilerplate filters — and none of them can tell whose logo or whose prose it is. Both
known misfires (§7.7, §7.8) reported `COMPLETE`, passed every gate, and stored another
company's identity. So the dry run is not a formality: **look at the two fields a
machine cannot check.**

```bash
npx tsx scripts/company-profile.ts --site $SITE_ID --dry-run --no-llm \
  --out /tmp/profile.jsonl
node -e "const j=JSON.parse(require('fs').readFileSync('/tmp/profile.jsonl','utf8').trim().split('\n')[0]);
  console.log(j.provenance); console.log(j.fields.companyAbout);
  const a=(j.logoAttempts||[]).find(x=>/would upload/.test(x.result||''));
  if(a) require('fs').writeFileSync('/tmp/logo.png', Buffer.from(a.url.split(',')[1],'base64'));"
# then OPEN /tmp/logo.png and READ the about text before running without --dry-run
```

Two questions, both answered by eye:
1. **Is that this company's logo?** Not "is it a logo" — the wrong answer is always a
   real logo. On an importer, dealer group, franchise or distributor, the runner-up is
   a brand they carry (§7.7).
2. **Is that copy the company describing ITSELF, today?** A dated milestone, a product
   launch or a press release is real company prose and still the wrong field (§7.8).
3. **Does the city agree with every street address the company prints?** Check the jobs
   site's own host too — a blog, news or careers subdomain is outside the capture — and the
   phone area code. A JSON-LD `addressLocality` with no `streetAddress`, or an `llm` address
   that is only a city name, is weak: a printed street address beats it. On a conflict, ask
   the owner. ipvsecurity.com stored `תל אביב-יפו` from a bare locality while its jobs
   subdomain printed `זרחין 10, רעננה` (`LRN-HQ-1`). **An address that is a street line
   with no city** ("רחוב המגשימים 20") gets its city set by hand, from the site, through
   `PUT /company-hq-city` (§4.4) before the real run: the capture reads the street's name as
   the city, and `מגשימים` passes the gate (decided 2026-10-18).

**Resolve any doubt BEFORE the real run.** `companyAbout`, `companyLogoPath` and
`companyProfileAt` are write-once (§1.1): noting a reservation and shipping anyway
costs a full `--force` re-capture of every other field to undo. If it is worth
mentioning, it is worth checking now.

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
→ Operator-supplied city (§4.4), from the company's own pages only (§5).

An **age gate** in front of the site (tempo) stops the capture the same way and has no
fix in the extractor: set the profile by hand, from the site (2026-10-18 reply).

**4.3 The company simply publishes no address.** Common and legitimate. Check the
contact page, the directions page (`כתובת ותחבורה` / `דרכי הגעה` / `מפת הגעה`), the
privacy page and the footer — the capture already reads all of them. If none carries an
address, leave the city NULL rather than inferring one from prose.

A dedicated directions page is tried **before** the contact page since 2026-09-16
(`pickDirectionsUrl`). Before that, a site linking both "צור קשר" and "מפת הגעה" always
read the contact page — heara.co.il's address was only on `/107867/map`. A site captured
before that date with a directions page and no address is worth a `--dry-run --force`
(§3.1), then a real `--force` if the preview only adds.

**4.5 The logo is drawn into a header banner.** Symptom: `logo …: rejected` for a
widget icon (Facebook, accessibility) and no other candidate, while the page visibly
shows a logo. Check every `<img>`, CSS `background-image` and inline SVG near the top: if
the only match is one wide banner (heara: `new-top-960-124.jpg`, logo plus four photos),
the capture is right to refuse it — the banner is not a logo.
→ Crop the logo from the **original image pixels** (load the image URL, `drawImage` the
region onto a canvas, export PNG — not a page screenshot), and look at the crop. Upload it:

```bash
curl.exe -X POST "$BASE/api/sites/$SITE_ID/company-logo" -H "$AUTH" \
  -H "Content-Type: image/png" -H "x-logo-source-url: <banner URL>" \
  --data-binary "@logo.png"
```

The server validates magic bytes and size. **The upload does not recompute
`companyProfileStatus`** — with homepage, about and logo now present, set it yourself:
`PUT /api/sites/$SITE_ID/company-profile?force=1` with `{"companyProfileStatus":"COMPLETE"}`
(presence-based: no other column is touched). A later forced re-capture keeps this stored
logo (the logo step is skipped unless `--replace-logo` is given), so it still counts toward
the status. Cite: `LRN-LOGO-2`. In the same way, a recapture keeps every profile field the
operator set by hand in the dashboard (listed in `Site.companyOperatorFields`) unless
`--replace-field <name>` names it.

While looking at the logo, compare it with `companyName`: the logo carries the company's
own spelling, the page `<title>` often does not (`addsite2.md` §4).

**4.4 Operator-authored values.** A city a human establishes goes through the API,
not the code:

```bash
curl.exe -X PUT "$BASE/api/sites/$SITE_ID/company-hq-city" -H "$AUTH" \
  -H "Content-Type: application/json" -d "@body.json"
# body.json: {"companyHqCity":"תל אביב","evidence":{"kind":"operator"}}
```

The server canonicalises and gates it — `תל אביב` is stored as `תל אביב-יפו`, an
off-list spelling or a region is a 400 — and records **who authored it** in
`companyHqCitySource`. That provenance is load-bearing, not bookkeeping: the sites
needing a hand-supplied city are exactly those already captured without one, so a
later `--force` re-capture finds no city again and would otherwise write NULL
straight over the human's answer. Recorded authority is what stops it.

**Only the city has that protection.** A hand-corrected address is written with
`PUT /company-profile?force=1` and only the `companyHqAddress` key, and nothing records
who wrote it: a later `--force` re-capture re-derives the address and overwrites it,
while keeping the operator's city — the pair splits silently. Before a forced re-capture,
find the sites whose address was corrected by hand and re-apply it afterwards
(`LRN-HQ-2`).

`evidence.kind` is one of:

| kind | meaning |
|---|---|
| `operator` | a human established this city |
| `operator:none` | a human looked; this company publishes no HQ city. City stays NULL and the dashboard stops asking |
| `skill <url>` | written by the former §5 web lookup, before 2026-10-18; no longer written |

`operator:none` is worth using. Without it a company that genuinely publishes no
city is indistinguishable from one nobody has checked, and the dashboard's warning
never converges.

The older `MANUAL_PROFILE` table in `scripts/company-profile.ts` still works as a
fallback and keeps the reasoning for the sites already in it. Keyed by **site id,
never by host** — recruitment vendors serve several unrelated employers from one
domain, so a host key would hand one employer's city to all of them. Prefer the API
for anything new: the DB value wins, and it needs no commit or deploy.

---

## 5. The HQ comes only from the company's own site (decided 2026-10-18)

The capture looks only at the company's own site. There is **no web lookup**: no
corporate registry, LinkedIn, maps or business listings, press, Wikipedia or
directory is a source for the HQ address or city, however plausible.

**The gate does not protect you here.** `city.csv` checks a city is *real*. It has
no opinion on whether it is *this company's*, and an outside listing is exactly where a
real city for the wrong company comes from.

**What still counts.** A page of the company's own domain the capture could not use —
a PDF, a bot-walled or JS-only page, the privacy or terms page, the Hebrew version of
the site. Its own statement about itself, entered by hand through §4.4.

**When the site does not settle it,** the city stays empty until set by hand, and
`operator:none` is written as before (§4.4) once the site's pages have been checked.

**A hand-set HQ taken from an outside source** waits for a decision that has not been
made yet. Do not enter one, and do not change one already stored, until it is
decided.

**Never overwrite.** If `companyHqCity` or `companyHqCitySource` is already set,
stop. A human's answer is not second-guessed.

---

## 6. Windows gotchas

```powershell
$TOKEN = Get-Content .claude\scrap-token -Raw | ForEach-Object { $_.Trim() }
```
- The script needs `.claude/scrap-token` and `.env`; both are gitignored, so a fresh
  worktree does not have them.
- Playwright browsers: `PLAYWRIGHT_BROWSERS_PATH=0`.

---

## 7. Correctness rules (load-bearing — never drift from these)

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
6. **When the real value is unreachable, the runner-up is somebody else's identity.**
   This is the shape behind rules 3, 7 and 8: a field going missing does not end the
   search, it promotes the next candidate — and the next candidate is a vendor, a
   brand, or a press release. So a gap in extraction is a *wrong-value* risk, never
   just a coverage one. Never "leave it and move on" without looking at what filled it.
7. **A logo that passes every gate can still be the wrong company's** (`LRN-LOGO-1`).
   The gates check the FILE (bytes, size, not-a-favicon, not-a-widget-host); nothing
   checks whose mark it is. colmobil.co.il ships its own logo as an `<img src="*.svg">`
   — invisible to the harvest until 2026-09-06 — and a footer strip of the car brands
   it imports, so the capture stored **OMODA**. Treat any importer / dealer group /
   distributor / franchise as high-risk and OPEN THE IMAGE (§3.1). If the right logo
   is not reachable, PARTIAL with no logo beats a competitor's.
8. **The about text is the LEDE, not the longest paragraph** (`LRN-ABOUT-1`).
   `extractAboutText` ranks by length within the first 3 qualifying paragraphs for a
   reason: on a company-history or news-feed about page, the longest block is the most
   recent press release. colmobil.co.il's timeline has 34 paragraphs — the description
   is #0, the longest is #32, an OMODA/JAECOO franchise announcement. If a capture's
   about copy names a product, a brand or a year, you are reading the wrong paragraph.
9. **Edit the extraction rules with a real editor, never a `node -e` string replace.**
   Escape sequences in these regexes have been eaten twice that way: a `\b` became a
   raw backspace and `\s`/`\d` lost their backslashes, silently disabling a guard.
   Add a test alongside any rule change — and confirm the test FAILS **with the fix
   disabled**, not merely that it failed before you wrote the fix. A fixture too small
   to exercise the rule (3 paragraphs against a 3-paragraph window) passes both ways
   and proves nothing.
10. **Never write JS helpers inside a `page.evaluate` body.** tsx compiles with
   `keepNames`, which wraps every named function in a `__name(...)` call that does not
   exist in the page; Playwright serialises the closure, so it throws on the first line.
   Where a `catch` returns a default, that arrives as "found nothing" and is invisible.
   Inline the logic instead — see `scripts/lib/svg-img-logos.ts`.

---

## 8. Carried from the learnings archive (step 6, 2026-10-05)

Read with §3.1: after every capture, these are the address and city shapes the extractor
still gets wrong. Each is a known extractor limit, left as an operator check by the owner.

- **An address printed inside a sentence keeps the sentence** (`LRN-HQ-3`): read
  `companyHqAddress` for a stray bracket, words of the surrounding sentence, or a cut-off last
  word, and correct it to the address as printed.
- **A company name that is also a place becomes the HQ city** (`LRN-HQ-4`): when
  `companyHqCity` equals `companyName` or a word in it, or the address has no street and no
  number, treat it as wrong until proven otherwise.
- **A Hebrew one-letter prefix splits a two-word city** (`LRN-HQ-5`): if the captured city is a
  short name and the address holds a longer `city.csv` entry ending in that word (`בני ברק` →
  `ברק`, `גן יבנה` → `יבנה`), the prefix split it. Also check the address is labelled as the
  head office at all.
- **A thin but COMPLETE profile is not finished** (`LRN-HQ-6`): when the HQ city or address is
  null, or `about` reads like a job detail, open the contact and about pages yourself. Write the
  city through `PUT /company-hq-city` (the only route that runs the `city.csv` gate and records
  operator evidence) and the address and about through `PUT /company-profile?force=1`, sending
  only those keys.
- **A hand-set HQ needs its provenance in `adminNote`** (`LRN-HQ-7`): the operator route keeps
  `evidence.kind` and drops `evidence.url`, so write which page of the company's own site gave the
  address into `adminNote` in the same session. Since 2026-10-18 the capture never takes an HQ
  from outside the employer's site (§5), and entering one by hand from an outside source waits
  for a decision.
- **A street named after a person is not a city** (`LRN-HQ-9`): when the captured city is a word
  inside the street name (`שד' אריאל שרון` → `אריאל`), read the next line. A street line with no
  city at all gets its city set by hand, from the site (§3.1). Where several
  addresses are printed, the HQ is the one labelled as offices (`המשרדים`, `משרדי החברה`,
  `הנהלה`), never a training site, warehouse or branch.
