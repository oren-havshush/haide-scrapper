# Job Scraping Mechanism — Technical Review (Part 1 of 2)

Read-only architecture audit covering the Skill side, the Worker/server side, the end-to-end data
flow, and cost drivers. Every claim below is grounded in the actual files cited — no code was
changed to produce this review.

Sections 5–8 (quality-issue diagnosis, improvement priorities, third-party build-vs-buy evaluation,
and the final summary) are a separate follow-up pass, since they involve more subjective tradeoff
judgment rather than pure code-reading.

## At a glance

| Metric | Value |
|---|---|
| `addsite2.md` core skill file | ~700 lines, always loaded in full |
| Recipe files, loaded only on signal | 5 |
| Analysis methods per site | 4 (3 deterministic + 1 optional LLM) |
| LLM call sites in the Worker | 2 (GPT-5 refine, GPT-4o-mini policy) |
| `worker/jobs/scrape.ts` — core scrape engine | 3,403 lines |
| Max wall-clock timeout per scrape run | 15 minutes |

## System layers at a glance

| Layer | What it is | Key files | Runs real scraping? |
|---|---|---|---|
| Skill (`/addsite2`) | AI-agent orchestration playbook (prose, not code) | `addsite2.md`, `addsite2-recipes/*.md` | No — decides what to run/check next |
| Onboarding CLI scripts | Helper scripts the Skill shells out to | `scripts/addsite-batch.ts`, `addsite-qa.ts` | Partial — triage/reach probes use Playwright, but don't persist jobs |
| Next.js API | Thin REST layer | `src/app/api/sites/**`, `siteService.ts` | No — only writes DB rows / enqueues jobs |
| Worker process | Background job runner (polls Postgres) | `worker/index.ts`, `jobDispatcher.ts` | Yes — all real scraping happens here |
| Analysis engine | One-time per-site field-mapping discovery | `worker/analysis/*.ts` | Yes (ANALYSIS job) |
| Scrape engine | Recurring per-site data extraction | `worker/jobs/scrape.ts` (3,403 lines) | Yes (SCRAPE job) |
| Policy engine | ToS / robots.txt scraping-permission check | `worker/policy/*.ts` | Partial (fetch + LLM classify) |

---

## 1. Skill side — `/addsite2`

**Role in one line:** The Skill is a decision-making runbook for an AI agent, not a scraper. It
tells the agent which script to run, how to interpret the JSON/exit code it gets back, and which
of five terminal outcomes (ACTIVE / SKIPPED / REVIEW / REQUEUE / ERROR) to declare. It never parses
HTML or extracts a job itself — all real extraction happens in the Worker.

### Where it lives (canonical source + sync chain)

- `addsite2.md` (repo root) is the canonical source — edited directly, then `pnpm sync:addsite2`
  propagates it.
- Synced copies: `.claude/commands/addsite2.md` (CI-checked, drift blocks merges) and
  `~/.cursor/skills/addsite2/SKILL.md` (hardlinked).
- Recipe files `addsite2-recipes/*.md` sync to `~/.cursor/skills/addsite2/recipes/*.md`.

### Recipes are loaded on-signal, not upfront

Section 15 of the skill is explicit: *"Recipes (load on signal — do NOT pre-read all)."* Each
recipe is a separate file the agent only reads when its trigger condition fires:

| Recipe file | Loaded only when this signal fires |
|---|---|
| `spa-frameworks.md` | `triage.vendor` is a known ATS (Workday / Greenhouse / Lever / Comeet / iCIMS / SmartRecruiters / Ashby / Civi) |
| `waf-bypasses.md` | `detail-reach` exits 2/3, or a `browserOverrides.userAgent` is needed |
| `setupscript-patterns.md` | A field isn't extractable by CSS alone; description is one run-on line or missing labeled sections; id/location is embedded in the title |
| `form-capture.md` | Apply-form capture is needed (incl. Wix lightbox, TopMatch/RedMatch apply pages) |
| `pagination-and-loading.md` | Extracted count < displayed total, lazy loading, or a "load more" button detected |

### Decisions the Skill makes for every new site

| Decision point | What it decides |
|---|---|
| Triage lane | RED (unreachable→skip) / GRAY (no obvious structure→review) / YELLOW (novel, discover from scratch) / GREEN (known ATS, start from a skeleton) |
| Gate matrix (5 gates) | Reachability, detail-page reachability, dry-run item count, QA verdict, config-clobber check — each maps to a specific outcome on failure |
| Remediation budget | At most 3 distinct fix attempts, stop after 2 rounds with no fill-rate improvement, 15-minute cap per site |
| Completeness gate (pre-ACTIVE) | title fill ≥ 80%, description fill ≥ 60%, an apply path exists, externalJobId fill ≥ 90% |
| Terminal verdict | ACTIVE / SKIPPED / REVIEW / REQUEUE, each with a required, logged reason string |

### A documented Skill step doesn't match the code it calls

Skill §7 ("Step 5 — Dry-run") instructs POSTing a full proposed config to
`/api/sites/:id/analyze` and reading back `{ data: [...] }` for an item count and sample.

The actual route (`src/app/api/sites/[id]/analyze/route.ts`) ignores the request body entirely and
just calls `createAnalysisJob(id)`, which re-enqueues a full ANALYSIS job returning
`{ pageTitle, methods, combined }` — a different shape, and a full heuristic + optional-LLM
re-analysis, not a lightweight config preview.

There is also no `dry-run` subcommand in `scripts/addsite-batch.ts` (its commands are: parse,
skip, log, summary, verify-config, verify-jobids, reach, detail-reach, fingerprint, triage,
patterns-update).

### Where the Skill spends tokens

- The ~700-line core file loads in full on every invocation regardless of which landmines/branches
  apply to that particular site (this is a fixed per-run overhead, by design — the recipe split is
  what keeps it from being worse).
- For YELLOW-lane (novel, non-ATS) sites, the skill instructs fetching raw listing HTML
  (`curl -o listing.html`) and detail-page `innerText` dumps for the agent to read directly and
  hand-derive selectors — this pours raw page content into the agent's own reasoning context,
  separate from any Worker-side LLM call.
- Each site's pipeline involves multiple JSON round-trips read back in full (triage →
  dry-run/analyze → verify-config → verify-jobids → QA), each consumed as context.
- Deliberate mitigations already present: on-signal recipe loading (§15), and batch-mode JSONL
  logging to avoid re-deriving state across a multi-site run.

---

## 2. Worker / server side

**Role in one line:** A single Node process (`worker/index.ts`) polls Postgres every 5 seconds for
the oldest PENDING `WorkerJob` row (strict FIFO, single-threaded — no parallel scrapes).
`jobDispatcher.ts` routes each job to one of three handlers by type. The Next.js API never touches
Playwright — it only creates DB rows.

| Job type | Trigger | What runs | File |
|---|---|---|---|
| ANALYSIS | Site created, or status manually reset to ANALYZING | 3 deterministic heuristics + optional GPT-5 refine; always ends in REVIEW | `worker/jobs/analyze.ts` |
| SCRAPE | `POST /api/sites/:id/scrape` | Full extraction → normalize → validate → persist → activation gate | `worker/jobs/scrape.ts` |
| POLICY_REVIEW | Separate policy-review flow | robots.txt + page discovery + GPT-4o-mini ToS classification | `worker/jobs/policyReview.ts` |

### ANALYSIS: four methods, combined by weighted confidence

| Method | Approach | LLM cost | File / size |
|---|---|---|---|
| Pattern match | DOM heuristics: walk up from a matched field element to find repeating sibling containers | None | `patternMatch.ts` (845 lines) |
| Crawl + classify | Crawls a few internal links, scores pages/content blocks semantically for "job listing"-ness | None (extra page loads) | `crawlClassify.ts` (1,197 lines) |
| Network intercept | Listens to XHR/fetch JSON during load + scroll, finds array-shaped job data | None | `networkIntercept.ts` (528 lines) |
| AI refine (optional) | Sends up to 6 sample item HTML blocks (≤ 5,000 chars each) to OpenAI, asks for CSS selectors for 8 fields, validates each against the live DOM before accepting | 1x GPT-5 call per ANALYSIS run, only if `OPENAI_API_KEY` is set | `aiRefine.ts` (389 lines) |

`combineResults.ts` always prefers a DOM selector over a JSONPath one (scrape.ts can't execute
JSONPath), picks the highest weighted-confidence candidate per field, gives AI_REFINE a 1.2x weight
edge, and adds a +0.10 / +0.15 confidence bonus when 2 / 3 methods independently agree on the same
field.

### Anti-bot / dynamic-site handling

- Full Chromium preferred over headless-shell (needed to render JS-heavy SPAs correctly).
- `navigator.webdriver` masked; languages/plugins spoofed via an init script.
- Deliberately no hardcoded default User-Agent — a mismatched Client-Hints header is a strong
  automation signal to Incapsula-style WAFs, so Chromium's own UA is used unless a per-site
  override exists.
- Per-site `browserOverrides` (userAgent / extraHeaders / bypassCSP) captured once at onboarding
  and replayed on every scrape.
- Optional upstream proxy via `SCRAPE_PROXY_URL`.
- Up to 25s wait for a Reblaze-style JS challenge page to reload and populate its body.
- `setupScript`: arbitrary per-site JS (stored in the DB) for SPA hydration hooks or detail-page
  enrichment via `await fetch()`.
- On 0 extracted items, a rich diagnostic dump (console messages, page errors, sub-resource
  statuses, cookies) is logged — but only to console logs, not persisted for later review.

**No first-class ATS adapters in code.** Workday / Greenhouse / Lever / Comeet / iCIMS /
SmartRecruiters / Ashby handling has no dedicated adapter module in the Worker. It's entirely prose
knowledge in `addsite2-recipes/spa-frameworks.md`, applied per-site as hand-configured selectors /
setupScript / pageFlow by whoever onboards that site.

### Retries, fallbacks, and error handling that exist today

| Situation | Fallback behavior |
|---|---|
| networkidle navigation times out | Retry navigation with domcontentloaded |
| 0 items on first extraction pass | Scroll to bottom, wait, retry extraction once |
| Live form re-extraction fails / no DOM match | Fall back to the static formCapture blob saved at onboarding |
| Scrape exceeds the 15-minute timeout | Timeout race marks the run PARTIAL, keeps jobs already chunk-saved (chunks of 20) |
| Worker process crashes mid-job | On restart, any IN_PROGRESS WorkerJob is marked FAILED, that site's jobs are wiped, site → FAILED — no automatic re-run |
| A WorkerJob fails for any other reason | `attempts` increments but nothing auto-retries — needs a manual re-trigger |
| Apply flow is login-gated | Short-circuits before any browser work → SKIPPED (saves scrape budget) |
| Pagination exhausted / disabled / content unchanged | Stops cleanly, keeps whatever was collected so far |

---

## 3. Data flow, end to end

| Stage (as asked) | What actually happens | Owner |
|---|---|---|
| Input | Operator/agent submits a career-page URL to `/addsite2` | Human + Skill |
| Skill instructions / agent behavior | Triage classifies RED/GRAY/YELLOW/GREEN (incl. embedded-ATS-iframe and WordPress-job-CPT gates); gate matrix + remediation budget decide next action | Skill (`addsite2.md`) + `addsite-batch.ts` |
| Server / Worker call | `POST /api/sites` creates `Site(ANALYZING)` + `WorkerJob(ANALYSIS)`; later `POST /api/sites/:id/scrape` creates `ScrapeRun` + `WorkerJob(SCRAPE)` | Next.js API → Postgres |
| Page fetching | Worker launches headless Chromium (Playwright), navigates domcontentloaded → best-effort networkidle, waits out WAF JS-challenges | `worker/lib/playwright.ts` |
| Job detection | `extractWithExplicitItemSelector` (preferred) or `extractWithAutoItemDetection` (rediscovers repeating DOM containers) after auto-scroll / load-more loops | `worker/jobs/scrape.ts` |
| Job detail extraction | pageFlow (if configured) visits each detail page inline; setupScript can `await fetch()` per-item enrichment | `worker/jobs/scrape.ts` |
| Apply form detection | Live DOM extraction of the configured form; falls back to a static blob captured once at onboarding | `extractFormData()` / `extractFormDataOrFallback()` |
| Normalization | Strip HTML, collapse whitespace, Hebrew/English label-based fallback extraction, ~1,400-entry IL city/region gazetteer, job-ID cleanup, publish-date → ageBucket | `worker/lib/normalizer.ts` (776 lines) |
| Validation | Only `title` is hard-required; length/boilerplate checks are non-blocking warnings | `worker/lib/validator.ts` |
| Output | Dedup (externalJobId → detailUrl → title+location) → chunked persist → activation gate (ACTIVE vs REVIEW) → Job rows served via `/api/jobs` + SSE | `scrape.ts` + Postgres + dashboard |

### Full chronological trace (18 granular steps)

1. **Triage** — `scripts/addsite-batch.ts triage` classifies RED/GRAY/YELLOW/GREEN; detects embedded ATS iframes and WordPress job CPTs before accepting a GRAY/RED verdict.
2. **Site create** — `POST /api/sites` → `Site(status=ANALYZING)` + `WorkerJob(type=ANALYSIS, status=PENDING)`.
3. **Worker picks up ANALYSIS** — ≤ 5s poll delay (single-threaded FIFO). Launches Chromium, runs pattern-match + crawl-classify + network-intercept, optionally GPT-5 refine, then `combineResults()`.
4. **Site → REVIEW (always)** — Both high- and low-confidence outcomes land in REVIEW so a human/agent can inspect; confidenceScore + fieldMappings are stored either way.
5. **Config authored** — Skill/agent (or a human via the dashboard) edits selectors, pagination, setupScript, form capture; `PUT /api/sites/:id/config`.
6. **Verification gates** — verify-config / verify-jobids CLI checks re-fetch the saved config to confirm it wasn't clobbered by a concurrent analyzer race, and that externalJobId values are real and unique.
7. **Scrape trigger** — `POST /api/sites/:id/scrape` → `ScrapeRun(IN_PROGRESS)` + `WorkerJob(type=SCRAPE, payload={scrapeRunId, maxJobs})`.
8. **Worker picks up SCRAPE** — Parses `fieldMappings._meta` (pagination / setupScript / loadMoreSelector / browserOverrides / formCapture), launches Chromium with per-site overrides.
9. **Page fetching** — Single-page or multi-page(pageFlow) navigation; auto-scroll + "load more" click loops; up to 25s grace for a WAF JS-challenge reload.
10. **Job detection** — `extractWithExplicitItemSelector` (preferred) or `extractWithAutoItemDetection` (fallback: rediscovers repeating containers by walking up from the title element).
11. **Pagination** — Click-based (click "next" until disabled/missing/unchanged) or URL-based (`?page=` increment, stop on empty/repeated content), capped at maxPages (default 20, hard cap 100).
12. **Detail / apply extraction** — pageFlow visits detail pages inline; form data captured live from the DOM or falls back to the onboarding-time static blob.
13. **Normalization** — HTML stripped, whitespace collapsed (line breaks preserved for description), Hebrew/English label-based fallback fields, IL gazetteer location fallback, job-ID cleanup, publish-date → ageBucket.
14. **Validation** — Only `title` is a hard requirement; other issues become non-blocking quality warnings.
15. **Dedup & persist** — Dedup key = externalJobId → detailUrl → title+location composite. Old jobs deleted, new ones inserted in chunks of 20 (progress survives a timeout).
16. **Manual overrides reapplied** — `JobLocationOverride` rows (dashboard hand-fixes) are re-applied after every scrape so they survive the delete/recreate cycle.
17. **Activation gate** — Samples ≤ 30 jobs from the run; checks fill-rate thresholds (title ≥ 80%, description ≥ 60%, externalJobId ≥ 90%) plus an apply path → ACTIVE or REVIEW (never auto-FAILED here).
18. **Output** — Job rows in Postgres, served via `/api/jobs` and the dashboard; SSE events (`site:status-changed`, `scrape:completed`) notify the UI live.

---

## 4. Cost drivers

| Cost driver | Where | Frequency | Notes |
|---|---|---|---|
| Browser sessions (Playwright/Chromium) | Every ANALYSIS and SCRAPE job | 1–2 per onboarding + 1 per scrape trigger | Dominant compute cost; single-threaded worker serializes all sites — one slow site delays every other site behind it in the FIFO queue |
| GPT-5 AI-refine call | ANALYSIS job (`worker/analysis/aiRefine.ts`) | Up to 1 call per ANALYSIS run — re-spent on every re-analysis | Sends up to 6 items × 5,000 chars raw HTML per call; re-triggering ANALYSIS (e.g. status→ANALYZING) re-pays this even if the DOM hasn't changed |
| GPT-4o-mini policy classification | POLICY_REVIEW job (`worker/policy/classify.ts`) | Per site, re-checked every ~90 days (recheckIntervalDays) | Cheaper model, but up to 12,000 chars of page text per call, chunked and merged for longer documents |
| Multi-page pageFlow scrapes | SCRAPE job when pageFlow is configured | Every scrape run for pageFlow sites | Each item's detail page may be visited individually — cost scales with job count, bounded only by `MAX_EXTRACTED_ITEMS = 2000` |
| Pagination / load-more loops | SCRAPE job | Every scrape run | Up to 100 pages (maxPages) or up to 2,000 items (load-more cap) per site per scrape — worst case is real wall-clock browser time |
| 15-minute per-scrape timeout budget | Every SCRAPE job | Per scrape | `SCRAPE_TIMEOUT_MS = 900,000ms`. One nearby code comment still says "NFR2: 2 minutes," a stale note vs. the actual 15-minute constant — a single slow site can occupy the sole worker for up to 15 minutes |
| No automatic retry on WorkerJob failure | Any job type | Every failure | A FAILED job needs a human/agent to notice and manually re-trigger; re-triggering re-pays the full ANALYSIS or SCRAPE cost from scratch — no partial resume |
| Full re-scrape replaces all jobs | SCRAPE job | Every scrape | `Job.deleteMany` + re-insert every run — no incremental "only fetch new/changed" mode, so re-scraping costs the same regardless of how many jobs actually changed |
| Skill-side raw HTML reasoning | YELLOW-lane (novel, non-ATS) onboarding | Per novel site | The agent fetches and reads raw listing/detail HTML into its own context to hand-derive selectors — an LLM-token cost entirely separate from any Worker OpenAI call |
| Manual remediation loop | Skill §B2a remediation budget | Up to 3 fix attempts per site (policy cap, not code-enforced) | Each attempt re-triggers PUT config → re-scrape → re-QA — another full browser cycle each time |

**No automated cost/usage tracking exists.** The Skill's own §B4 ("Cost visibility") asks the agent
to self-report "browser sessions opened + scrapes triggered" after each site and batch — there's no
code-level instrumentation counting browser launches, LLM tokens, or wall-clock time per site.
Whatever cost visibility exists today depends on the operating agent manually counting and
reporting it.

---

*Next up: Part 2 will cover quality issues causing inconsistent scraping across sites, improvement
opportunities, a build-vs-buy evaluation of Apify / Firecrawl / Zyte / ScrapingBee / Bright Data /
Browserless / Oxylabs / ATS-specific APIs, and a final summary with prioritized next steps.*
