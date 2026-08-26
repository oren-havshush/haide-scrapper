# Job Scraping Mechanism — Technical Review (Part 2 of 2)

Quality-issue diagnosis, improvement priorities, third-party build-vs-buy evaluation, and a final
summary. Continues from Part 1 (sections 1–4). Every claim is grounded in the real codebase; no
code was changed to produce this review.

---

## 5. Quality Issues — Root Causes of Inconsistent Scraping

### 5.1 The analyzer race condition (LRN-RACE-1 / LRN-RACE-2)

The single biggest quality destroyer during onboarding. `POST /api/sites` automatically enqueues
an `ANALYSIS` job. The analyzer runs asynchronously, derives its own `fieldMappings`, and writes
them back to the DB — **overwriting** any config the Skill (or operator) previously PUT. Because
the worker is a single-threaded FIFO queue, the timing is unpredictable:

- If the Skill PUTs config before the analyzer finishes → analyzer overwrites it.
- Even a double-PUT (5s apart) can lose: `LRN-RACE-2` documents a case where the analyzer
  finished *after* both PUTs.
- The Skill's `verify-config` gate (Step 7) was added to catch this, but it's a workaround, not
  a fix. The real problem is that the analyzer has unconditional write access to the same config
  the Skill is building.

**Impact:** sites ship with the analyzer's (often wrong) selectors instead of the carefully
built human/AI-reviewed ones. The first scrape returns 0–1 jobs or garbage fields.

### 5.2 Weak auto-analysis for non-trivial sites

The four analysis methods (`patternMatch`, `crawlClassify`, `networkIntercept`, `aiRefine`) work
well on clean, static HTML with obvious repeating containers. They fall apart on:

- **SPA / client-rendered listings** — the DOM at `domcontentloaded` may be empty; jobs load
  via XHR/fetch after hydration. `networkIntercept` can catch the API call, but it emits
  JSONPath selectors (`$.items[*].title`) that `scrape.ts` cannot execute (it only handles CSS).
  `combineResults.ts` line 80 explicitly filters these out: *"JSONPath-only fields are omitted
  (scrape cannot execute them)."*
- **ATS iframes** — the analyzer scans the wrapper page, finds zero job items, and the site
  gets SKIPPED. The Skill learned to detect iframes (`LRN-SPA-4`, automated in
  `findEmbeddedBoardUrl`), but this is a Skill-side patch, not an analyzer fix.
- **Accordion / popup / modal layouts** — items exist in collapsed state; field selectors
  scoped to the visible card miss data that lives in a hidden sibling panel. The analyzer has no
  concept of reveal-then-read.
- **Elementor / Wix repeaters** — fields are sibling `comp-*` elements sharing a suffix
  (`LRN-SPA-6`). No analysis method can discover this cross-component relationship. Every Wix
  repeater site requires a custom `setupScript`.

**Result:** the analyzer produces a useful, ready-to-ship config for roughly 30–40% of sites
(simple HTML tables, WordPress `ul.job_listings`, straightforward `<div>` grids). The remaining
60–70% need manual Skill intervention — building a `setupScript`, choosing correct selectors,
configuring `pageFlow`, etc.

### 5.3 No description extraction on listing-only sites

Many Israeli job boards display only title + location on the listing page. The description lives
on a per-job detail page. Without a `pageFlow` configuration, the scraper never visits detail
pages, and description fill rate is 0%.

The Skill addresses this (Step 4), but:
- For sites with >40 jobs, per-job detail navigation hits the 15-minute timeout before
  processing all jobs (`LRN-COV-4` documents NVIDIA at 40/240 before the fix).
- The setupScript API-fetch pattern (WP REST, ATS APIs) solves this but requires platform-
  specific knowledge that only the Skill/operator has — the worker has no built-in adapter for
  any ATS API.

### 5.4 Detail-page WAF blocks (Incapsula / Imperva / Cloudflare)

The listing page often loads fine because it's CDN-cached, but detail pages hit a WAF challenge.
Playwright's default `HeadlessChrome` user-agent is the trigger (`LRN-WAF-2`). The worker sets
`navigator.webdriver = false` via `addInitScript`, but:

- The UA override is opt-in per site (`browserOverrides.userAgent` in config). A fresh site
  scrapes with the default UA and fails silently — detail pages return ~800B of Incapsula HTML,
  the extractor gets 0 fields, and the job record ships with an empty description.
- There is no automatic detection or retry with a stealth UA. The Skill's `detail-reach`
  probe catches this *during onboarding*, but if the WAF is added later (e.g. site upgrades
  their CDN), recurring scrapes degrade silently.

### 5.5 setupScript is a single opaque string

All complex extraction logic — API calls, DOM injection, id hashing, location inference,
popup opening — lives in a minified JS string stored in the site's config JSON. This has
several consequences:

- **No testability**: there is no test harness for setupScripts. They are tested by running
  a full scrape and inspecting output.
- **No shared code**: each setupScript is self-contained. The `haideHash` function, for
  example, is copy-pasted into every setupScript that needs id synthesis. A bug fix requires
  updating every copy.
- **Fragility**: a single syntax error in the string silently breaks the entire site's
  extraction. The worker catches the exception (`runSetupScript` has a try-catch), but the
  fallback is "proceed without it" — which means the scrape completes with missing/wrong data
  rather than failing loudly.
- **No versioning**: when a setupScript is updated via `PUT /config`, the old version is gone.
  There's no history to diff or rollback.

### 5.6 Form capture is error-prone

The dual-path form capture (live `extractFormData` at scrape time vs. static `formCapture.fields`
blob) causes subtle bugs:

- **LRN-APPLY-7**: the live extractor matched a *newsletter form* on the listing page instead
  of the real apply form, because `formSelector: form.elementor-form` wasn't specific enough.
  The static blob was correct but never used because the live path "succeeded."
- **LRN-APPLY-8**: Wix lightbox forms don't exist in the DOM until a pointer click opens the
  popup. The worker never opens it, so `extractFormData` returns null.
- **LRN-APPLY-9**: RedMatch/TopMatch apply pages have inputs with no enclosing `<form>` tag
  at all.

The pattern: the worker's live form extraction assumes a standard `<form>` element is present
and correct. When it's not (modal, no `<form>`, wrong form), the fallback to the static blob
only triggers when the selector matches *nothing*. A match to the *wrong* form silently wins.

### 5.7 Gazetteer false positives and negatives

The Israeli city/region gazetteer (`normalizer.ts`, ~1,400 entries) is a last-resort fallback
for location extraction. It scans free-form text for place names. Known issues:

- **False positives**: common Hebrew words that are also place names — "במשמרות" (in shifts)
  matched to moshav משמרות. Fixed by `BARE_PREFIX_DENYLIST`, but the list is maintained
  manually.
- **False negatives**: the gazetteer only fires when `location` is still empty after label-based
  extraction. If the labeled extractor grabs a wrong value (e.g. a company name from the
  wrong DOM element), the gazetteer never runs.
- **No confidence scoring**: a match is either returned or not. There's no way to distinguish
  "we're 95% sure this is the location" from "this 3-letter place name happened to appear in
  the description."

### 5.8 No incremental / differential scraping

Every scrape run re-extracts all jobs from scratch. There is no concept of "only fetch jobs
that changed since last run." For sites with 200+ jobs, this means:

- The full 15-minute timeout is consumed even if nothing changed.
- Browser resources are wasted re-navigating pages already visited.
- If a transient error occurs mid-scrape (network hiccup, WAF challenge), all jobs extracted
  so far are still persisted, but the remaining jobs are missing — and there's no way to resume.

### 5.9 Single-threaded worker bottleneck

The worker polls `workerJob` every 5 seconds and processes one job at a time. During busy
periods (batch onboarding), the queue backs up. A site that needs a re-scrape after a config
fix waits behind every other queued job. There's no priority system — a routine scheduled
scrape blocks an urgent fix verification.

### 5.10 Silent completion on partial data

`scrape.ts` completes with `status: COMPLETED` even when:
- Only 40 of 240 jobs were visited before timeout.
- Detail pages returned HTTP errors and were skipped.
- The setupScript threw an exception and the fallback extracted 0 fields.

The `ScrapeRun` record stores `totalJobs` and `newJobs`, but there's no comparison against
an expected total. The Skill's coverage gate catches this during onboarding, but recurring
scrapes have no equivalent check.

---

## 6. Improvement Opportunities

Prioritized by impact (data quality × number of affected sites) and implementation effort.

### 6.1 HIGH PRIORITY — Fix the analyzer race

**Problem:** analyzer overwrites Skill-built config (§5.1).

**Solution options (pick one):**
1. **Lock-after-PUT**: add a `configLocked: boolean` column to `Site`. When the Skill (or
   operator) PUTs a config, set `configLocked = true`. The analyzer checks this flag before
   writing and skips its update if locked. Simple, backward-compatible.
2. **Skip auto-analysis entirely**: change `POST /api/sites` to NOT auto-enqueue an ANALYSIS
   job. The Skill already runs its own analysis probes (reach, fingerprint) and builds config
   manually. The auto-analyzer is useful only for the ~30% of simple sites where its config is
   good enough. Make it opt-in (`?analyze=true` query param).
3. **Version the config**: store configs in a `SiteConfigVersion` table with timestamps. The
   analyzer writes a new version without deleting the previous one. The scraper uses the latest
   version. The Skill can see and compare versions.

**Recommendation:** option 1 is the smallest change. Option 2 is the cleanest long-term.

### 6.2 HIGH PRIORITY — Auto-stealth UA with fallback

**Problem:** detail-page WAF blocks go undetected on recurring scrapes (§5.4).

**Solution:**
- In `scrape.ts`, after navigating to the first detail page, check the response body size. If
  it's < 2KB and contains WAF signatures (`_Incapsula_Resource`, `cf-browser-verification`,
  `Request unsuccessful`), automatically retry with a desktop Chrome UA.
- Store the "needs stealth UA" flag on the site so subsequent scrapes skip the failed attempt.
- Emit a `ScrapeRun` warning (`wafDetected: true`) so the dashboard surfaces it.

**Effort:** ~50 lines in `scrape.ts` + a new `Site.needsStealthUa` boolean.

### 6.3 HIGH PRIORITY — Scrape completion quality check

**Problem:** scrapes complete with partial data and no one notices (§5.10).

**Solution:**
- At the end of `handleScrapeJob`, compare `extractedCount` to the previous run's
  `totalJobs`. If the drop is > 30%, mark the run as `COMPLETED_WITH_WARNINGS`.
- If the scrape took >14 minutes (near timeout), log a `timeout_risk` warning.
- Add a `ScrapeRun.warnings: string[]` JSON column for structured quality signals.
- Dashboard: show a yellow badge on sites with recent warnings.

### 6.4 MEDIUM PRIORITY — setupScript module system

**Problem:** setupScripts are copy-pasted, untestable, unversioned blobs (§5.5).

**Solution:**
- Create a `worker/setupModules/` directory with shared functions (`haideHash`,
  `structuredText`, `wpRestFetch`, `comeetSetup`, `wixRepeaterSetup`).
- At scrape time, the worker injects these modules via `page.addInitScript()` before running
  the site's setupScript. The setupScript can call `window.__haide.haideHash(...)` instead
  of inlining the function.
- This doesn't require changing the config format — setupScripts remain strings, but they can
  now reference shared helpers.

**Effort:** medium (create the module system, migrate existing scripts gradually).

### 6.5 MEDIUM PRIORITY — Parallel worker or job concurrency

**Problem:** single-threaded worker is a bottleneck (§5.9).

**Solution options:**
1. **Concurrency within one worker**: process N jobs simultaneously (e.g. `Promise.all` with
   a concurrency limiter). Risk: Playwright browser contexts share memory; 3–5 concurrent
   contexts on a 4GB VPS may OOM.
2. **Multiple worker processes**: run 2–3 independent worker instances, each polling the same
   queue with `SELECT ... FOR UPDATE SKIP LOCKED`. Postgres handles coordination. Each worker
   is single-threaded but the system is parallel.
3. **Job priority**: add a `priority` column to `WorkerJob`. Config-verification scrapes get
   priority 1, regular scheduled scrapes get priority 5. The worker always picks the highest-
   priority job first.

**Recommendation:** option 3 (priority) is trivial and immediately useful. Option 2 is the
right next step if throughput becomes a bottleneck.

### 6.6 MEDIUM PRIORITY — Differential scraping for large sites

**Problem:** every scrape re-extracts all jobs (§5.8).

**Solution:**
- For sites with >50 jobs, store a `lastScrapedJobIds: string[]` on the site.
- On the next scrape, after extracting listing-page items, compare the extracted IDs to
  `lastScrapedJobIds`. Only visit detail pages for new/changed IDs.
- Keep existing jobs that weren't re-extracted (they're still live unless explicitly removed).
- Add a "full rescrape" mode that ignores the cache (for config changes).

**Caveat:** this requires reliable `externalJobId` extraction on the listing page (before
visiting detail pages). Sites where the ID only appears on the detail page can't use this
optimization.

### 6.7 MEDIUM PRIORITY — Improve form capture reliability

**Problem:** live form extraction overrides correct static blob (§5.6).

**Solution:**
- When `formCapture.fields` is configured (static blob exists), skip live `extractFormData`
  entirely. The static blob was captured by the Skill with human verification — it's always
  more reliable than an automated re-scan.
- Only run live extraction when no static blob exists.
- This is a ~10-line change in `scrape.ts` (`extractFormDataOrFallback`).

### 6.8 LOW PRIORITY — Confidence scoring for the gazetteer

**Problem:** gazetteer matches have no confidence signal (§5.7).

**Solution:**
- Return a confidence score alongside the matched place name: indicator pattern (A) = 0.9,
  cue pattern (A2) = 0.7, bare prefix (B) = 0.4.
- Store both `location` and `locationConfidence` on the job record.
- Low-confidence matches are flagged for review rather than accepted as ground truth.

### 6.9 LOW PRIORITY — Analysis quality improvement

**Problem:** analyzer produces bad configs for 60–70% of sites (§5.2).

**Solution (incremental):**
- Add a `KNOWN_ATS_PATTERNS` table mapping host patterns → known-good selector templates.
  When a new site's URL matches a pattern, skip the heuristic analysis and apply the template.
  This is essentially what `site-patterns.json` + the Skill's `fingerprint` command does, but
  pushed into the worker so it works without the Skill.
- Long-term: the analyzer could run the heuristic methods, but instead of writing them
  directly to the site config, store them as `AnalysisResult` (which it already does) and
  require explicit Skill/operator approval before promoting to the live config.

---

## 7. Third-Party Replacement / Integration

### 7.1 What the current system does well (don't replace)

Before evaluating third-party tools, it's worth identifying what the custom system does that
generic scraping services cannot:

| Capability | Why it's hard to replicate |
|---|---|
| Israeli-market normalization | Hebrew label-value extraction, RTL text handling, IL gazetteer with 1,400 cities, Hebrew date parsing, Israeli phone regex |
| setupScript injection | Custom JS that calls a site's own API, opens popups, hashes IDs, injects fields — no third-party service supports this |
| Form capture | Structured extraction of apply-form schemas (field names, types, required flags, `<select>` options) for downstream auto-apply |
| externalJobId synthesis | Hash-based stable IDs for sites with no native job ID — critical for dedup across runs |
| Quality gates | Multi-tier validation (Tier-A/B fill rates, correctness suspects, form status) with domain-specific verdicts |

These are the system's competitive advantages. Any third-party integration should preserve them.

### 7.2 Evaluation of third-party services

#### Firecrawl / Crawl4AI

**What they do:** "Scrape any website and get clean markdown/structured data." LLM-ready page
fetching with JS rendering.

**Where they could help:**
- **Page fetching layer** — replace Playwright for the initial page load. Firecrawl handles
  JS rendering, anti-bot bypass, and returns clean HTML/markdown. This could eliminate the
  WAF detection problem (§5.4) and the Playwright memory overhead.
- **Structured extraction** — Firecrawl's `/scrape` endpoint can extract structured data
  using an LLM. Could replace or augment the analyzer's field-mapping discovery.

**Where they fall short:**
- No support for `setupScript`-style injection. You can't call a site's internal API from
  Firecrawl.
- No multi-step page flows (listing → detail → apply).
- No form capture.
- Pricing: per-page, which for a 200-job site with detail pages = 200+ API calls per scrape.

**Verdict:** useful as a **page-fetching fallback** (replace Playwright for blocked sites),
not as a full replacement. Estimated cost: $0.01–0.05 per page.

#### Apify

**What they do:** cloud-based web scraping platform with pre-built "Actors" for common sites
and a custom Actor runtime.

**Where they could help:**
- **Pre-built ATS Actors**: there are community Actors for Greenhouse, Lever, Workday,
  LinkedIn Jobs. These could replace the custom setupScripts for known ATS platforms.
- **Proxy management**: Apify's proxy pool (residential, datacenter) can bypass WAFs that
  block datacenter IPs. More reliable than the current `browserOverrides.userAgent` approach.
- **Scheduled runs**: Apify handles scheduling, retries, and result storage.

**Where they fall short:**
- Pre-built Actors don't handle the Israeli market specifics (Hebrew normalization, IL
  gazetteer, form capture).
- Custom Actors require writing code in their platform — essentially re-implementing the
  worker's logic in a different runtime.
- Vendor lock-in: data extraction logic lives on Apify's platform, not in your codebase.

**Verdict:** useful for **proxy/browser infrastructure** (replace self-hosted Playwright on
a $20/month VPS with Apify's managed browser pool). The pre-built ATS Actors could replace
the setupScript for 3–4 ATS platforms, saving maintenance. Not a full replacement.

#### Bright Data / Oxylabs / ScrapingBee

**What they do:** proxy networks + browser APIs for anti-bot bypass.

**Where they could help:**
- **Proxy infrastructure**: the current worker runs on a single VPS with a single IP. Sites
  can trivially block it by IP. A rotating proxy pool solves this.
- **Bright Data's Web Unlocker** / ScrapingBee's stealth mode handle Cloudflare, Incapsula,
  and similar WAFs automatically.

**Where they fall short:**
- They're infrastructure providers, not scraping solutions. You still need your own extraction
  logic.
- Cost: residential proxy bandwidth is $8–15/GB. A large scrape run (200 pages with images)
  can consume 50–100MB = $0.50–1.50 per run.

**Verdict:** **strong complement** to the current system. Integrate as the `playwright.ts`
transport layer — when the default fetch fails with a WAF signature, retry through a proxy
service. This is the single highest-ROI third-party integration.

#### Zyte (formerly Scrapinghub)

**What they do:** full-stack scraping platform (Scrapy Cloud + Smart Proxy + AI extraction).

**Where they could help:**
- Zyte API's "Automatic Extraction" uses ML to extract product/article data from any page.
  Could be trained/prompted for job listings.
- Zyte's Smart Proxy Manager is battle-tested for anti-bot bypass.

**Where they fall short:**
- The AI extraction is designed for e-commerce (products, prices, reviews), not job listings.
  Custom training would be needed.
- Scrapy-based — a different paradigm from the current Playwright-based approach. Migration
  cost is high.

**Verdict:** the **proxy manager** is worth evaluating alongside Bright Data. The AI extraction
is not a fit for the job-listing domain without significant customization.

#### ATS-specific APIs (direct integration)

Some ATS platforms expose public or semi-public APIs:

| ATS | API availability | Current approach |
|---|---|---|
| Greenhouse | Public API (`boards-api.greenhouse.io`) | setupScript + DOM selectors |
| Lever | Public API (`api.lever.co/v0/postings/<company>`) | setupScript + DOM selectors |
| Workday | No public API; internal `search?offset=N` | setupScript calls internal API |
| Comeet | No public API; positions in initial HTML | DOM selectors + setupScript |
| iCIMS | Semi-public API (`careers-<company>.icims.com/jobs/search?...`) | DOM selectors |
| SmartRecruiters | Public API (`api.smartrecruiters.com/v1/companies/<id>/postings`) | setupScript |

**Where they help:**
- Direct API calls are faster, more reliable, and cheaper than browser rendering.
- No WAF issues — APIs are meant to be called programmatically.
- Complete data in a single response (no pagination, no detail-page navigation).

**Where they fall short:**
- Only available for some ATS platforms. Most Israeli custom WordPress/Elementor sites have
  no API.
- API schemas vary — each requires a mapping layer.
- APIs can change without notice (no versioning guarantees on most ATS board APIs).

**Verdict:** **already being used** via setupScript for Workday, Greenhouse, and WP REST.
The opportunity is to formalize these into proper ATS adapters (§6.9) rather than
setupScript copy-paste.

### 7.3 Recommended integration strategy

```
┌─────────────────────────────────────────────────────────────────┐
│                    CURRENT ARCHITECTURE                         │
│                                                                 │
│  Skill → API → Worker → Playwright → extract → normalize       │
│                                                                 │
│           ┌─ What to KEEP ──────────────────────────────────┐   │
│           │  Skill orchestration                            │   │
│           │  Worker job dispatch + normalization + validation│   │
│           │  setupScript injection                          │   │
│           │  Form capture + quality gates                   │   │
│           │  Hebrew/IL-specific normalization                │   │
│           └─────────────────────────────────────────────────┘   │
│                                                                 │
│           ┌─ What to AUGMENT with third-party ──────────────┐   │
│           │  Page fetching: add proxy fallback               │   │
│           │    (Bright Data / ScrapingBee / Oxylabs)         │   │
│           │  ATS extraction: formalize API adapters          │   │
│           │    (Greenhouse API, Lever API, WP REST)          │   │
│           │  Anti-bot: auto-detect + retry with proxy        │   │
│           └─────────────────────────────────────────────────┘   │
│                                                                 │
│           ┌─ What NOT to replace ───────────────────────────┐   │
│           │  The entire Worker — too much domain logic       │   │
│           │  setupScript system — no 3rd party equivalent    │   │
│           │  Form capture — unique to this system            │   │
│           │  Normalization — IL-market-specific               │   │
│           └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Priority order for third-party integration:**

1. **Proxy/anti-bot service** (Bright Data Web Unlocker or ScrapingBee) — highest ROI,
   solves the WAF problem (§5.4) for both new and existing sites. Integrate at the
   `playwright.ts` layer as a transport fallback.
2. **ATS API adapters** — formalize the Greenhouse, Lever, WP REST patterns into proper
   worker-side adapters (not setupScript strings). Medium effort, high reliability gain
   for the ~30% of sites on known ATS platforms.
3. **Firecrawl as page-fetch fallback** — for sites where even a proxy doesn't work (e.g.
   advanced bot detection), Firecrawl's rendering pipeline can be a last-resort fetch
   method. Low priority because the proxy service should handle most cases.

---

## 8. Final Summary

### How the system works (one paragraph)

A site's career page URL enters the system via the `addsite2` Skill — an AI-agent orchestration
playbook that triages the URL, probes reachability, builds CSS selector configs and setupScripts,
captures apply-form schemas, and runs quality gates. The Skill never scrapes directly; it shells
out to CLI scripts and API calls that enqueue jobs into a Postgres-backed FIFO queue. A background
Node.js Worker process picks up these jobs one at a time, launches Playwright, navigates to the
career page, runs any setupScript (custom JS injection for API calls, DOM enrichment, id
synthesis), extracts job data using CSS selectors, normalizes it (Hebrew label extraction, IL
gazetteer for locations, date parsing, job-id cleaning), validates it (fill rates, boilerplate
detection), and persists it. Two LLM call sites exist: an optional GPT-5 pass during one-time
analysis, and a GPT-4o-mini policy classifier checked every ~90 days.

### Strengths

| Strength | Evidence |
|---|---|
| **Extremely thorough quality gates** | 8+ distinct validation checkpoints during onboarding: reach, detail-reach, verify-config, verify-jobids, addsite-qa (Tier-A/B fill + correctness suspects + form status), coverage gate, completeness gate, externalJobId gate |
| **Deep Israeli-market specialization** | Hebrew/English label extraction, 1,400-entry IL city/region gazetteer with false-positive denylists, Hebrew date parsing, Israeli phone regex, RTL text handling |
| **Rich learnings system** | `addsite-learnings.md` (60+ entries) acts as institutional memory — every failure mode is documented with signal, fix, and generalization. Prevents repeating mistakes |
| **setupScript flexibility** | Can extract data from virtually any site by injecting custom JS that calls internal APIs, opens modals, hashes fields, etc. This is the system's "turing completeness" for extraction |
| **Form capture for auto-apply** | Unique capability — structured extraction of apply-form schemas (field names, types, options, file upload flags) that no third-party scraping service provides |
| **Low LLM cost** | Only 2 LLM call sites, both infrequent. The system is primarily deterministic CSS extraction, not LLM-powered |
| **Comprehensive dedup** | Fingerprint-based dedup (`title|location` or `url` or `externalJobId`) prevents duplicate jobs across pages and runs |

### Weaknesses

| Weakness | Severity | Section |
|---|---|---|
| **Analyzer race condition** clobbers good configs | Critical | §5.1 |
| **No auto-WAF detection** on recurring scrapes | High | §5.4 |
| **Silent partial completion** — scrape COMPLETED with missing data | High | §5.10 |
| **Single-threaded worker** — no parallelism or priority | Medium | §5.9 |
| **setupScript is untestable, unshared, unversioned** | Medium | §5.5 |
| **Live form extraction overrides correct static blob** | Medium | §5.6 |
| **No incremental scraping** — full re-extract every run | Medium | §5.8 |
| **Analyzer fails on SPAs, iframes, modals** — 60–70% of sites need manual config | Low (mitigated by Skill) | §5.2 |
| **Gazetteer false positives** on common Hebrew words | Low | §5.7 |

### What to improve first (top 5)

1. **Fix the analyzer race** (§6.1) — add `configLocked` flag. Smallest change, biggest
   impact on onboarding reliability. Estimated effort: 1–2 hours.
2. **Auto-WAF detection + proxy fallback** (§6.2 + §7.3) — detect WAF signatures on detail
   pages, retry with stealth UA or proxy. Estimated effort: 1–2 days for the detection logic,
   plus proxy service integration.
3. **Scrape completion quality check** (§6.3) — compare extracted count to previous run,
   flag drops >30%. Estimated effort: 2–4 hours.
4. **Static form blob wins over live extraction** (§6.7) — when `formCapture.fields` exists,
   skip live `extractFormData`. Estimated effort: 30 minutes, ~10 lines changed.
5. **Worker job priority** (§6.5 option 3) — add `priority` column, pick highest-priority
   job first. Estimated effort: 1–2 hours.

### What NOT to change

- **Don't replace the Worker wholesale** with a third-party service. The domain-specific logic
  (Hebrew normalization, form capture, quality gates, setupScript injection) is the system's
  moat. No off-the-shelf scraping platform handles these.
- **Don't remove setupScript**. Despite its weaknesses (§5.5), it's the only mechanism that
  can handle the long tail of weird sites. Improve it (shared modules, §6.4), don't replace it.
- **Don't add more LLM calls to the hot scraping path.** The current architecture is
  deliberately deterministic (CSS selectors + setupScript). LLM-per-page extraction would
  increase cost 10–100x and add latency/nondeterminism. LLMs belong in the *analysis/setup*
  phase (one-time), not the recurring scrape.
- **Don't migrate away from Playwright.** It handles the JS rendering that ~80% of Israeli
  career sites require (SPA frameworks, Wix, WordPress with AJAX loading, Elementor popups).
  Augment it with proxy services for anti-bot, don't replace it.
- **Don't change the Skill architecture.** The separation between Skill (decision-making) and
  Worker (execution) is sound. The Skill's quality gates (reach, QA, verify-config,
  verify-jobids) catch most of the Worker's blind spots. The improvement path is making the
  Worker less dependent on these gates, not removing them.

---

*Review produced: 2026-07-01. Code snapshot: current `main` branch, no modifications made.*
