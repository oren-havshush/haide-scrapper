# addsite2 — structural audit & migration build-spec

> **What this file is.** A line-by-line audit of the current `addsite` skill
> (`addsite.md` → `.claude/commands/addsite.md` → `~/.cursor/skills/addsite/SKILL.md`,
> ~3,234 lines / ~165 KB) and the build spec for its successor, **`addsite2`**.
> It doubles as the persistent **learnings log** that `addsite2` will cite
> instead of inlining incident stories. Append new entries at the bottom; never
> delete a migrated landmine without a replacement.

---

## 1. Decisions locked (2026-06-14 session)

- **Approach:** fresh, well-architected skill (`addsite2`), but **knowledge is
  migrated, not re-derived from memory.** Every rule/gate/incident in `addsite`
  is triaged into exactly one bucket (A/B/C/D below). Nothing valuable is lost.
- **Scripts:** **reuse + extend** `scripts/addsite-batch.ts` and
  `scripts/addsite-qa.ts`. Do not rewrite the behavioral backbone.
- **Location:** **sibling skill** `addsite2` alongside `addsite`, same sync
  mechanism (`addsite2.md` canonical → CI-checked copy + hardlinked SKILL.md).
  `addsite` stays live as a safety net until `addsite2` is validated.
- **This doc:** lives in the repo, version-controlled, and is the migration
  checklist + append-only log.

## 2. Goals (ranked)

> **Definition of success (locked 2026-06-14).** Success is **NOT** the count of
> sites flipped ACTIVE. Success = **each site reaches its *correct* terminal
> state — ACTIVE with complete, appliable jobs, OR SKIPPED with an honest
> reason, OR routed to human REVIEW — at minimum cost.** A confident, honest
> SKIP is a success; a false ACTIVE (partial data, or apply behind
> login/Turnstile) is the cardinal failure. If we optimize raw ACTIVE count we
> actively damage the product. The metric to optimize is **correct-verdict rate
> at low cost.**
>
> **Why** (the product is an auto-apply job platform): a job is only useful if it
> has a real **description** AND a **usable apply path** (form / email /
> reachable URL). The whole gate system (B2.5 / B2.6) exists to protect that bar.
> Outcome priority order: (1) correctness of the verdict → (2) completeness per
> job → (3) coverage across jobs → (4) stable dedup id → (5) throughput at low
> cost.

1. **Success-per-site (= correct-verdict rate)** — the recurring failures are
   known; the fix is to move the most-violated `you MUST` rules from prose into
   **mechanical gates in the TS scripts** (exit codes the agent can't drift past).
2. **Cost** — cut the ~40K-token fixed cost paid on *every* invocation by
   splitting the always-loaded core from on-demand recipes + the learnings log,
   capping HTML-into-context, and **not running the full pipeline on sites a
   cheap triage pass could classify** (see §4a).
3. **Maintainability** — DRY the repeated gates, give incidents a real home, and
   stop the file from growing unboundedly with every lesson.

### 2.1 Business balance (cost × quality × quantity)

There is real schedule pressure (need N live sites), so we do **not** pick one
of cost/quality/quantity — we **segment the funnel** so each lane optimizes a
different axis (see §4a):

- 🟢 **known patterns** (Workday/Greenhouse/Comeet/known WP themes) → quantity +
  low cost (scripted, near-zero agent involvement).
- 🟡 **novel** → quality (spend the agent reasoning budget here, where it earns it).
- ⬜ **gray zone** (descriptions fine but apply ambiguous; coverage ~80%) →
  **human REVIEW queue** (the product already has REVIEW status — the current
  skill barely uses it). Quantity without sacrificing quality.
- 🔴 **structural blocker** (login wall, Turnstile apply, IL-IP WAF) → skip fast,
  protect both cost and the honest verdict.

---

## 3. Current-state analysis

### 3.1 Size by section (where the bytes are)

| Section | Lines | ~% | Dominant content |
|---|---:|---:|---|
| Intro / doctor / scratch / NOT-do / Inputs | 1–93 | 3% | setup + contract |
| **Batch mode (B0–B4)** | 94–575 | **15%** | gates, remediation budget, QA gate, summary |
| Credentials | 578–603 | 1% | token read |
| Step 1 Duplicate check | 604–664 | 2% | pageSize trap, exact-match dedup |
| Step 2 Create site | 665–721 | 2% | analyzer FIFO race |
| Step 3 Reachability + WAF recipes | 722–889 | 5% | gate script + Incapsula |
| Step 3b Fetch/inspect | 890–952 | 2% | structural summary script |
| **Step 4 Selectors / listing-vs-multipage / SPA recipes** | 953–1605 | **20%** | recipes, setupScript patterns |
| Step 5 Dry-run | 1606–1684 | 2% | dry-run script |
| **Step 5b Form capture** | 1685–2659 | **30%** | capture script source, 5b-2/3/4, vendor apply flows |
| Step 6 PUT config + browserOverrides/bypassCSP/minPublishDate | 2660–2887 | 7% | payload shape + WAF config |
| Step 7 PATCH ACTIVE + verify gate | 2888–2958 | 2% | analyzer-race guard |
| Step 8 Scrape | 2959–3011 | 2% | trigger + poll |
| Step 9 Sample/report | 3012–3083 | 2% | wrap-up + QA record |
| Learnings rubric | 3084–3141 | 2% | candidate-learning format |
| Failure modes / Windows / Correctness | 3142–3234 | 3% | gotchas |

**Step 4 + Step 5b + Batch = ~65% of the file**, and that 65% is overwhelmingly
*on-demand recipes* (B) and *embedded TS script source* (B) and *incident
narratives* (C) — exactly the content that does not need to be in the
always-loaded hot path.

### 3.2 Structural problems

1. **~40K+ tokens loaded on every run**, including single-URL adds that will
   never touch Workday/Comeet/Elementor. Grows every time a lesson lands.
2. **Lessons interleaved with procedure** — many sections are majority incident
   narrative; the actual "do this" path is hard to scan and re-read every run.
3. **Redundancy (DRY violations):**
   - Analyzer-race / "PUT after analyzer" explained **4×**: Step 2, Step 6,
     B1.5, Failure modes.
   - Coverage gate stated **3×**: Step 4, Failure modes, Correctness rules.
   - Completeness (B2.5) restated in Step 9; B1.6 form-on-detail-page repeated
     ~3× (B1.6, B2.6, 5b).
4. **Forward references** — Batch (B0–B4) precedes Steps 1–9 but constantly
   refers forward to them.
5. **No persistent learnings log** — candidate learnings are *printed then lost*
   unless manually folded in. Memory currently lives in this file's absence.
6. **Cost guidance aims at the wrong resource** — B4 counts browser sessions and
   scrapes, not the dominant cost (agent tokens/turns: full-HTML reads, repeated
   Playwright scripts, re-reading the skill). Step 3b says "Read the rendered
   HTML" with no size cap.

---

## 4. Target architecture for addsite2

```
repo/
  addsite2.md                         # CANONICAL lean core (~900–1,100 lines), always loaded
  addsite2-recipes/                   # on-demand; agent reads only the one that matches the signal
    waf-incapsula-and-ua.md           # Step 3 detail-page WAF, bypassCSP
    spa-frameworks.md                 # Workday / Greenhouse / Lever / Comeet / iCIMS …
    setupscript-patterns.md           # location inject, id synthesis (hash/hybrid), Elementor popups
    form-capture.md                   # 5b-1 capture script, 5b-2 image fallback, 5b-4 standalone merge
    pagination-and-loading.md         # infinite scroll / load-more / numbered / url-param
  docs/
    addsite-learnings.md              # append-only incident log (this doc seeds it)
    addsite2-migration.md             # THIS FILE (build spec + log)
  scripts/
    addsite-batch.ts                  # REUSED + extended (new subcommands, see §7)
    addsite-qa.ts                     # REUSED + extended
  .claude/commands/addsite2.md        # CI-checked copy of addsite2.md
  ~/.cursor/skills/addsite2/SKILL.md  # hardlinked copy
```

**Core principle:** the core doc holds the *pipeline contract + every hard gate +
how to find the right recipe*. A recipe is opened **only** when its signal fires
(vendor host match, WAF marker, "form is on a detail page", etc.). Incident
stories live in the log; the core cites them in one line.

**Progressive-disclosure rule (new):** the core tells the agent *when* to read a
recipe (e.g. "Incapsula markers in HTML → read `addsite2-recipes/waf-incapsula-and-ua.md`")
rather than carrying the recipe body. This is the single biggest token win.

> **Open item — sync mechanism vs. multiple files.** `pnpm sync:addsite`
> currently syncs one file. Before building, confirm whether the sync script /
> CI drift-check can handle a folder (`addsite2-recipes/`) or whether recipes
> should be one concatenated `addsite2-playbook.md`. See §8.

---

## 4a. v2 pipeline design — triage → build (the real rethink)

> This is the part where `addsite2` stops being "a tidier `addsite`" and becomes
> a better *process*. Today the skill runs one monolithic, expensive,
> cold-start pipeline on every URL. v2 splits it into a cheap classifier and an
> expensive builder, and replaces the binary ACTIVE/SKIP verdict with a
> taxonomy that includes "requeue" and "human review."

### 4a.1 Two passes, not one monolith

- **Pass A — Triage (mostly scripted, cheap; minimal/no agent reasoning):**
  reachability (`reach`) + framework fingerprint (`fingerprint`) + a quick
  DOM/count probe + an apply-path sniff. Output is **not** ACTIVE/SKIP — it's a
  **lane** (🟢 / 🟡 / ⬜ / 🔴 per §2.1).
- **Pass B — Build (full pipeline):** runs **only** on 🟢 and 🟡. 🔴 is skipped
  before any expensive work. 🟢 runs a near-deterministic scripted path from the
  fingerprint's emitted config skeleton; 🟡 runs the real Steps 1–9 with agent
  discovery.

This is the correct reading of the user's "first pass vs. two tries": the value
isn't running the whole thing twice — it's **triage, then build**. Most current
waste is running the expensive Pass B on sites Pass A would have killed for free.

### 4a.2 Failure taxonomy (replaces flat ACTIVE/SKIP + flat budget)

The verdict is decided by *why* a step failed, not a one-size budget:

| Class | Examples | Verdict |
|---|---|---|
| **Transient** | analyzer race, render-timing miss, worker busy, 429 rate-limit | **REQUEUE once** (this is the real "2nd try" — only where a retry can change the result) |
| **Structural** | login wall, Turnstile apply, IL-IP-only WAF surviving UA override | **SKIP now** (a 2nd try just pays to fail twice) |
| **Gray zone** | descriptions fine but apply path ambiguous; coverage ~80%; QA Tier-B gaps | **route to human REVIEW queue** (cheap human arbitration; product already has REVIEW) |
| **Clean pass** | Tier-A complete + usable apply path | **ACTIVE** |

> **Requeue mechanics note (Murat's open Q):** the worker is single-threaded FIFO.
> "Requeue" = append the URL to the end of the batch work-list with an attempt
> counter (max 2), NOT an immediate retry — so transient contention (a busy
> worker, an in-flight analyzer) has time to clear before the 2nd attempt.
> Cap at one requeue; a 2nd transient failure escalates to REVIEW, not infinite loop.

### 4a.3 Automate the known, never fake the unknown

- 🟢 lane may be driven by a deterministic driver that builds config from the
  fingerprint skeleton + the pattern cache (§7). 
- 🟡 lane **must** still run real discovery — the prebuilt-config driver is
  exactly how batch drifted to listing-only configs before (the `onboard-one.ts`
  caution in the current skill). The driver automates plumbing, **not** discovery
  for novel sites.

### 4a.4 Cross-run memory (`site-patterns.json`)

Today every site is cold-start and the hard-won knowledge rots in prose. Add a
**machine-usable** cache: `host/theme/WAF signature → working config pattern +
overrides`. The fingerprinter consults it so the 2nd IL site on the same WP
theme (or the same ATS) is near-instant. This is the structured, queryable
complement to `docs/addsite-learnings.md` (which stays human-readable).

---

## 5. Migration inventory (the triage)

**Buckets:**
- **A = Core** (always-loaded `addsite2.md`)
- **B = Recipe** (on-demand file, cited from core)
- **C = Log** (move narrative to `docs/addsite-learnings.md`; core keeps a 1-line rule + cite)
- **D = Drop/condense** (redundant restatement, verbose prose, or folded into a script)

| Current section (lines) | Content | → Bucket | Destination / note |
|---|---|---|---|
| Intro/doctor/scratch (1–46) | doctor run, scratch rules | **A** | Core preamble (condense) |
| What you must NOT do (47–60) | autonomy, no blind selectors, race warning | **A** | Core contract |
| Inputs (61–93) | URL/file/CSV flags, mode detection | **A** | Core |
| B0 parse (98–118) | `addsite-batch.ts parse` | **A** | Core (batch) |
| B1 iterate + **batch contract** (120–169) | "no batch path; single ×N" | **A** | Core (batch) — keep verbatim, it's load-bearing |
| B1.6 form-on-detail (171–224) | the yes/l-b lesson + apply-outcome table | **A**(table) + **C**(stories) | Core keeps the apply-outcome decision table; yes/l-b narratives → log |
| B1.5 reactivate SKIPPED/FAILED (226–263) | `--force` transition dance | **A** | Core (batch) — condense |
| B2 gate matrix (265–289) | the skip one-liner + trigger table | **A** | Core — this is the spine of batch |
| B2a remediation budget (290–339) | signal-gated, one-shot, caps | **A** | Core — keep; provably-terminating |
| B2b remediation catalog (340–373) | the closed fix set | **A** | Core — but each fix *cites* its recipe in B |
| B2.5 completeness gate (375–459) | partial-data / no-usable-apply | **A**(rule) + **C**(bankhapoalim/L'Oréal) | Core keeps the decision procedure; stories → log |
| B2.6 QA gate (460–521) | `addsite-qa.ts` Tier-A/B | **A** | Core — extend script (see §7) |
| B3 summary (522–563) | `summary` subcommand + table | **A** | Core (condense the sample table) |
| B4 cost visibility (564–575) | session/scrape counts | **A**+extend | Core; add agent-cost proxies (§7) |
| Credentials (578–603) | token read | **A** | Core |
| Step 1 dedup (604–664) | **pageSize>100 ⇒ []** trap, exact-match variants | **A** | Core — LANDMINE, keep the rule; could move to a `batch dedup` helper |
| Step 2 create + **analyzer FIFO race** (665–721) | create, wait-for-ANALYZING-to-leave | **A** | Core — the canonical race section (the other 3 copies collapse here) |
| Step 3 reachability gate (722–817) | bare-vs-realUA probe script | **A** | Core rule + **move script into `addsite-batch.ts reach`** (§7) |
| Step 3 Incapsula/detail-page WAF (818–888) | HeadlessChrome UA block, detail probe | **B** | `waf-incapsula-and-ua.md`; core cites on marker |
| Step 3b fetch/inspect (890–952) | structural-summary script | **A**+cap | Core; **add HTML-size cap rule** (read summary JSON first) |
| Step 4 selector picking (953–1065) | itemSelector, externalJobId rules, publishDate, minPublishDate | **A**(rules) + **C**(msh/natali/eimsys/hamat stories) | Core keeps the field-selection rules; per-site stories → log |
| Step 4 setupScript fallback (1066–1333) | location inject, id hash/hybrid synth, multi-page setupScript | **B** | `setupscript-patterns.md`; core cites "value not in its own element → setupScript recipe" |
| Step 4 Elementor popups (1334–1373) | popup enumeration | **B** | `setupscript-patterns.md` |
| Step 4 listing-vs-multipage (1374–1410) | pageFlow decision | **A** | Core — fundamental routing decision |
| Step 4 **coverage gate** (1411–1432) | establish true total, `coverage:` line | **A** | Core — LANDMINE, the single canonical coverage section |
| Step 4 SPA frameworks (1433–1547) | Workday/Greenhouse/Lever/Comeet API recipes | **B** | `spa-frameworks.md`; core: "host matches a known SPA → read recipe" |
| Step 4 dynamic-loading (1548–1605) | infinite-scroll / load-more / pagination | **B** | `pagination-and-loading.md`; core keeps a 1-line "if N-of-M mismatch → recipe" |
| Step 5 dry-run (1606–1684) | dry-run script | **A** | Core (keep script; it runs almost every time) |
| Step 5b intro + newsletter-shadow pitfall (1685–1763) | why form capture exists | **A**(rule) + **C**(gomobile) | Core: "capture apply form on detail page"; story → log |
| Step 5b capture script (1764–2229) | full capture-form.ts source | **B** | `form-capture.md` |
| 5b-LOGIN (2230–2266) | login-gated → SKIPPED | **A** | Core (it's a gate outcome) |
| Avature/L'Oréal apply flow (2267–2287) | Turnstile after method step | **C** | log; core B2.5 already covers the rule |
| 5b-2 manual fallback (2288–2395) | image-capture, 3-question flow | **B** | `form-capture.md` (single-URL only path) |
| 5b-3 verify (2396–2424) | one-line summary | **A** | Core (tiny) |
| 5b-4 standalone merge (2425–2659) | merge-form-capture.ts source | **B** | `form-capture.md` (standalone `run step 5b` path) |
| Step 6 PUT payload (2660–2795) | SaveConfigPayload shape, honored attrs | **A** | Core — the config contract (LANDMINE: only `selector/extractAttr/confidence/source/capturedOnUrl` honored; BOM-free write) |
| Step 6 browserOverrides (2796–2837) | UA WAF config block | **B** | `waf-incapsula-and-ua.md` |
| Step 6 bypassCSP (2838–2868) | CSP-blocked XHR | **B** | `waf-incapsula-and-ua.md`; core 1-line symptom→recipe |
| Step 6 minPublishDate (2869–2887) | stale cutoff | **A** | Core (one paragraph) |
| Step 7 PATCH + **verify gate** (2888–2958) | analyzer-clobber re-read | **A** | Core — LANDMINE; **move assertion into `addsite-batch.ts verify-config`** (§7) |
| Step 8 scrape (2959–3011) | trigger, FIFO note, mismatch re-verify | **A** | Core (condense) |
| Step 9 sample/report (3012–3083) | wrap-up, coverage/completeness/QA lines | **A** | Core (condense; dedup with B2.5/B2.6) |
| Declaring learnings (3084–3141) | candidate-learning rubric | **A** | Core — now *writes into* `docs/addsite-learnings.md` |
| Failure modes (3142–3172) | SPA/CF/UA/pagination/RTL/`<br>` | **D**→**A** | Mostly duplicates; keep RTL `locale:'he-IL'` + 1-line pointers; drop the rest |
| Windows gotchas (3173–3202) | curl.exe, quoting, here-strings, BOM, tsx warmup | **A** | Core appendix (condense) |
| Correctness rules (3203–3234) | verify-before-trust, coverage mandatory | **A** | Core — keep "code wins over prose"; coverage line dedups into Step 4 |

### 5.1 Estimated outcome

- Core `addsite2.md`: **~900–1,100 lines** (vs 3,234). ~**65–70% smaller** hot path.
- ~5 recipe files: ~1,600 lines total, **loaded only on signal**.
- `docs/addsite-learnings.md`: the ~25 incident stories, dated and structured.

---

## 6. LANDMINES — must survive migration (preservation checklist)

These are the non-obvious, hard-won rules. If any is dropped, success-per-site
regresses. Each must appear in core (A) regardless of how the recipes shake out:

- [ ] **`/api/sites?pageSize>100` silently returns `[]`** — dedupe only with exact `?siteUrl=` + variant list (Step 1).
- [ ] **Analyzer FIFO race** — create enqueues an ANALYSIS job that overwrites your config; gate on "left ANALYZING" before PUT; double-PUT; then verify persisted config (Steps 2/6/7).
- [ ] **SKIPPED → only ANALYZING** transition; reactivation dance (B1.5).
- [ ] **Apply form usually lives on the per-job detail page**, not the listing — drill in before judging "uncapturable" (B1.6).
- [ ] **Partial data (title/location only) ⇒ SKIPPED, never ACTIVE** (B2.5).
- [ ] **No usable apply path (login/Turnstile, no email/url/form) ⇒ SKIPPED** (B2.5).
- [ ] **Coverage gate** — establish true total, never silently ship page 1, always emit `coverage: extracted/total` (Step 4).
- [ ] **Worker honors only** `selector/extractAttr/confidence/source/capturedOnUrl`; ignores `regex/transform/extractRegex/postProcess/extract` — use `setupScript` instead (Step 6).
- [ ] **externalJobId must be stable + unique**; never index-based; hash stable content with a disambiguator; prefer native id / detail URL (Step 4).
- [ ] **setupScript:** append injected spans to the item root, not to an element another field reads (msh corruption); guard against re-run dupes; `await` supported (no IIFE); runs on listing AND detail pages.
- [ ] **Incapsula/HeadlessChrome UA block on detail pages** — real-UA override probe; the listing passing bare does NOT prove detail pages do (bankhapoalim).
- [ ] **UA-keyed WAF (TCP reset)** → `browserOverrides.userAgent` (bezeq).
- [ ] **bypassCSP** when setupScript XHRs a different subdomain (bezeq d-api).
- [ ] **BOM-free UTF-8** for config writes; bypass PowerShell for Hebrew form labels.
- [ ] **Single-threaded FIFO worker** — one scrape at a time; parallel local discovery is fine, parallel prod scrapes buy nothing.
- [ ] **Gazetteer common-word↔place collisions** (במשמרות) — `BARE_PREFIX_DENYLIST`.
- [ ] **Comeet/Spark Hire** = static formCapture template + adminNote (not auto-skip).
- [ ] **Remediation budget** invariants (signal-gated, one-shot, ≤3 fixes, 2-no-progress stop, 15-min cap).

---

## 7. Script extensions (the success-per-site lever)

The pattern across every incident: **prose said "MUST" and the agent drifted.**
Moving enforcement into the scripts (exit codes) is the highest-leverage success
improvement and *also* shrinks the core doc. Proposed `addsite-batch.ts`
subcommands (reusing the existing CLI shape):

| New subcommand | Replaces prose in | Behavior | Exit contract |
|---|---|---|---|
| `reach --url` | Step 3 gate script | bare-vs-realUA listing probe | 0 PASS / prints UA block / 3 unreachable — **✅ DONE (2026-06-14)** |
| `detail-reach --listing --detail` | Step 3 Incapsula detail probe | worker-parity vs +UA on a detail URL | 0 ok / 2 needs-UA / 3 blocked — **✅ DONE (2026-06-14)** |
| `fingerprint --url` | Step 4 SPA detection | detect Workday/Greenhouse/Lever/Comeet/iCIMS/SmartRecruiters/Ashby/WP by host+DOM; emit lane (🟢/🟡) + recipe pointer | 0 + JSON — **✅ DONE (2026-06-14)** (config-skeleton emission still TODO) |
| `triage --url` (or batch) | new (Pass A) | run `reach` + `fingerprint` + listing-structure probe → emit **lane** 🟢/🟡/⬜/🔴 | 0 + JSON lane — **✅ DONE (2026-06-14)** |
| `verify-config --site-id --expect-*` | Step 7 verify gate | GET persisted config, assert itemSelector + field keys + formCapture survived | 0 ok / 2 clobbered — **✅ DONE (2026-06-14)** |
| `cost --batch-dir` | B4 | tally browser sessions, scrapes, **+ agent turns/scripts run** | 0 + JSON |

`addsite-qa.ts` extensions:
- Assert **formCapture OR per-job applicationInfo present** (machine-check B1.6).
- Flag detail-page Tier-B parity (already partially done via `availableButUnmapped`).
- Emit a machine verdict aligned to the §4a.2 taxonomy: `ACTIVE | REQUEUE | REVIEW | SKIP`.
  **✅ DONE (2026-06-14).** `qa.verdict` + `qa.verdictReason` now in the JSON and
  stderr tail; mapping: REQUEUE = 0 jobs sampled; REVIEW = on-page form not
  captured / Tier-B exposed-but-unmapped / suspected description-mapping miss /
  inconclusive probe; SKIP = Tier-A incomplete with no recoverable signal;
  ACTIVE = clean pass. Default exit stays `0/2` (back-compat); opt-in
  `--verdict-exit` maps `0=ACTIVE, 2=SKIP, 3=REVIEW, 4=REQUEUE` for the v2 driver.

Cross-run memory:
- **`site-patterns.json`** (§4a.4) — `signature → working config pattern + overrides`.
  `fingerprint` writes successful patterns here and reads them first, so repeat
  themes/ATSes onboard near-instantly.

> Reusing the scripts keeps behavioral parity; the new subcommands are additive,
> so `addsite` keeps working unchanged during the transition.

---

## 7a. Legacy fleet — re-audit, don't migrate

**Introducing `addsite2` changes nothing for already-onboarded sites.** Site
configs live in prod (DB: `fieldMappings` / `_meta` / `formCapture`); the worker
scrapes them agnostic to which skill produced them. So existing ACTIVE sites keep
working with **zero migration**.

BUT the new quality bar (B2.5/B2.6, form-on-detail) will *expose* legacy sites
that shipped below it (e.g. `formCapture: null`, listing-only configs — the
yes / l-b / bankhapoalim-first-pass class). They need a **re-audit, not a
migration**:

1. **Audit (read-only, cheap, safe anytime):** loop all ACTIVE sites, run
   `addsite-qa.ts --site-id` per site → write `fleet-audit.csv`, bucketing into
   ✅ meets-bar / ⚠️ Tier-B gaps / ❌ Tier-A broken (no description / no apply).
   Pure reads, **no prod mutation.** **✅ DONE (2026-06-14)** — built
   `scripts/addsite-fleet-audit.ts` (single-process, no per-site browser → fast;
   pages `pageSize=100` per LRN-API-1) and ran it. See "Audit results" below.

### Audit results (2026-06-14) — 79 ACTIVE sites

| Bucket | Count | % |
|---|---|---|
| ❌ **BROKEN** (Tier-A incomplete) | **4** | **5%** |
| ⚠️ TIER_B_GAPS (Tier-A ok, ≥1 Tier-B field low-fill) | 73 | 92% |
| ✅ OK (Tier-A + Tier-B filled) | 2 | 3% |

Apply path: **CAPTURED 45 (57%)**, EMAIL 22 (28%), URL 9 (11%), **NONE 3 (4%)**.

**Honest read of the headline.** The hard bar (Tier-A: title + description +
usable apply path) is **met by 95% of the fleet (75/79)** — the fleet is *not*
broken. The scary-looking 92% "Tier-B gaps" is an artifact of a probe-less
audit: it flags any Tier-B field under 0.2 fill, and **`publishDate` is unmapped
on ~90% of sites** (and `department` on most), so nearly every site lands in the
bucket on that one field alone. Without a per-site page probe we can't tell
"page doesn't expose it" from "we didn't map it," so 92% is an **upper bound on
headroom, not a defect count.**

**Genuinely actionable backlog = 4 sites:**
- `shahal.co.il/jobs` (`cmq9kh5qt…`) — form CAPTURED but **description fill = 0** → fix description mapping.
- `careers.topmatch.co.il/diplomat-il` (`cmp9t2uj8…`) — **no apply path** (NONE).
- `ashtrom.co.il/career` (`cmp02uvpp…`) — **no apply path** (NONE).
- `l-w.ac.il/jobs` (`cmozix74p…`) — **no apply path** + low fills across the board.

**Systemic opportunity (not a defect):** `publishDate` (and often `department`)
is unmapped fleet-wide. Worth one investigation — is it absent from listing
pages, or a recurring mapping miss the recipes should default? A real Tier-B
verdict needs the full `addsite-qa.ts` per-site probe (skipped here for speed).

**Business case for addsite2, restated honestly:** it is *not* "rescue a broken
fleet." It is (a) **prevent regressions** (the analyzer race / listing-only
configs that produced the few NONE/no-description sites), (b) **raise Tier-B
capture** systematically (publishDate/department), and (c) **onboard the next
batch cheaper** via triage. The clean 95% Tier-A pass rate is itself the proof
the pipeline works; addsite2 protects and extends it.

> Reproduce: `npx tsx scripts/addsite-fleet-audit.ts` (writes `.scratch/fleet-audit.csv`, gitignored).
2. **Triage by value:** fix high-traffic ❌ and ⚠️ first; low-traffic cosmetic
   gaps can wait.
3. **Fix with the lightest tool:** a missing form is often just standalone
   **Step 5b** (`run step 5b <url>`) — no full re-onboard. Only the truly broken
   get the full pipeline.
4. **Guardrail:** re-onboarding re-triggers the analyzer race + `ACTIVE → REVIEW`
   (B1.5). Audit freely; *re-onboard* deliberately, through the race-guard.

Dual purpose: the audit produces the **business case** for `addsite2` (a hard
number, e.g. "% of live sites with no captured apply form") **and** the re-run
fleet becomes `addsite2`'s first validation batch — sites we already understand.

**Scope decision (open, see §8 #5):** is the fleet re-audit in-scope for the
`addsite2` project, or a separate effort?

---

## 8. Open questions (resolve before build)

1. ~~**Sync mechanism + multiple files**~~ **RESOLVED (2026-06-14).**
   `scripts/sync-addsite.mjs` hard-codes exactly one canonical file
   (`addsite.md`) → one CI-checked copy (`.claude/commands/addsite.md`) + one
   hardlinked `~/.cursor/skills/addsite/SKILL.md`, using SHA256 compare-and-copy.
   It does **not** support a folder today, but generalizing it is trivial:
   replace the three hard-coded paths with an **array of sync targets** and loop
   `--check` / write over them. So the multi-file recipe layout **is viable** —
   it just needs `sync-addsite.mjs` extended (or a sibling `sync-addsite2.mjs`)
   to sync: core `addsite2.md` → command copy + `~/.cursor/skills/addsite2/SKILL.md`,
   **plus** each `addsite2-recipes/*.md` → `~/.cursor/skills/addsite2/recipes/*.md`.
   Recipe files placed alongside SKILL.md are readable by the agent via the Read
   tool on demand (only SKILL.md auto-loads), which is exactly the
   progressive-disclosure design we want. **Action:** add "extend the sync
   script" to Phase 2.
2. **Recipe-loading ergonomics** — is the agent reliably willing to open a
   second file mid-run? If not, the cheaper win is "thin the prose + move
   incidents to the log" while keeping recipes inline-but-condensed.
3. **Cutover policy** — when does `addsite2` become canonical and `addsite`
   retire? Suggest: after N≥10 real sites onboarded at parity.
4. **Where does `docs/addsite-learnings.md` get read?** Probably *not* every run
   (cost) — only when a matching signal fires. Decide the trigger.
5. **Fleet re-audit scope (§7a)** — part of the `addsite2` project, or a
   separate tracked effort? (Recommend: read-only audit in-scope as validation
   input; the *fixes* tracked separately by value.)
6. **How big is the 🟢 known-pattern slice really?** (§4a) The cost win depends
   on it. The fleet audit (§7a) can measure it from the existing catalog before
   we over-invest in the scripted lane.

## 9. Build phases (proposed)

1. **Phase 0 — log first (cheap, reversible):** create `docs/addsite-learnings.md`,
   move the incident narratives into it (bucket C), leave `addsite` citing them.
   This alone trims the hot path and gives you the "log" you asked for.
2. **Phase 1 — script enforcement + triage:** add the §7 subcommands
   (`reach`, `detail-reach`, `fingerprint`+skeleton, `triage`, `verify-config`,
   `cost`) and the §4a.2 verdict taxonomy to the existing scripts; wire `addsite`
   to call them (raises success + cuts cost on the current skill too).
3. **Phase 2 — author `addsite2.md` core** from the bucket-A rows + recipes from
   bucket-B; implement the §4a triage→build flow; extend the sync script for the
   multi-file layout (§8 #1).
4. **Phase 3 — validate** on the fleet re-audit batch (§7a) + ≥10 real new sites
   at parity, then cut over.

**Recommended starting point:** Phase 0 (zero risk, delivers the log + trims the
hot path immediately), in parallel with the **read-only fleet audit** (§7a) to
get the 🟢-slice and below-bar numbers that justify Phase 1/2 sizing.

---

## 10. Change log (append-only)

> Format per entry: `YYYY-MM-DD — <what changed> — <why>`.
> New `LEARNING` entries migrated out of the skill go here too.

- **2026-06-14** — Created this audit/build-spec. No code or skill changes yet;
  decisions locked in §1. Next action pending user steer: start Phase 0 (seed
  `docs/addsite-learnings.md`) or Phase 1 (script enforcement).
- **2026-06-14** — Investigated `scripts/sync-addsite.mjs` (read-only).
  Resolved §8 #1: multi-file recipe layout is viable; sync script needs a small
  generalization (array of targets) added to Phase 2.
- **2026-06-14** — Folded the BMAD Party-Mode design session into the spec:
  redefined success as **correct-verdict rate** (§2), added the cost×quality×
  quantity funnel (§2.1), the **v2 triage→build pipeline + failure taxonomy +
  requeue/REVIEW lanes + `site-patterns.json` cache** (§4a), `triage`/skeleton
  `fingerprint` scripts (§7), and the **legacy fleet re-audit** plan (§7a).
  No code/skill changes yet. Recommended start: Phase 0 + read-only fleet audit.
- **2026-06-14** — Phase 0 delivered: created `docs/addsite-learnings.md`
  (~30 structured incidents in 9 categories, citable by `LRN-*` id).
- **2026-06-14** — Phase 1 started: added the **`verify-config`** subcommand to
  `scripts/addsite-batch.ts` (Step 7 analyzer-clobber gate as code; additive,
  read-only GET, exit 2 = clobbered). Smoke-tested via the usage path; tsx
  compiles clean, no lint errors. `addsite`'s existing subcommands untouched.
  Remaining Phase 1: `reach` / `detail-reach` / `fingerprint` (+skeleton) /
  `triage` (all Playwright-backed) and the QA verdict-taxonomy alignment.
- **2026-06-14** — Phase 1 cont.: added the **Playwright-backed triage gates**
  to `scripts/addsite-batch.ts`: `reach` (Step 3 reachability, exit 3),
  `detail-reach` (Incapsula detail probe, exit 2/3), `fingerprint` (host+DOM ATS
  detection → lane + recipe), `triage` (Pass A classifier → GREEN/YELLOW/GRAY/RED).
  Lazy `import("playwright")` so pure-fetch commands stay dependency-free. Lint
  clean; smoke-tested `fingerprint` (Workday host → GREEN) and `reach`
  (example.com → PASS 200) end-to-end. Still TODO: `fingerprint` config-skeleton
  emission + `addsite-qa.ts` verdict-taxonomy alignment (ACTIVE/REQUEUE/REVIEW/SKIP).
- **2026-06-14** — Ran the **legacy fleet re-audit** (§7a). Built
  `scripts/addsite-fleet-audit.ts` (read-only, single-process) and audited all
  79 ACTIVE sites: **95% meet the Tier-A bar**; only **4 sites genuinely below
  bar** (1 missing description, 3 no apply path); 57% have a CAPTURED apply form.
  The 92% "Tier-B gaps" headline is dominated by fleet-wide unmapped
  `publishDate` (probe-less artifact, not defects). Findings + honest business
  case recorded in §7a "Audit results". CSV → `.scratch/fleet-audit.csv` (gitignored).
- **2026-06-14** — Phase 1 cont.: **QA verdict-taxonomy alignment** in
  `scripts/addsite-qa.ts`. Added `decideVerdict()` → `qa.verdict` /
  `qa.verdictReason` (ACTIVE/REQUEUE/REVIEW/SKIP per §4a.2), surfaced in JSON +
  stderr tail. Default `0/2` exit unchanged (back-compat); opt-in `--verdict-exit`
  gives the v2 driver distinct codes (0/2/3/4). Lint clean; smoke-tested
  ACTIVE (tafkid → exit 0) and SKIP (ashtrom → exit 2). Remaining Phase 1:
  `fingerprint` config-skeleton emission + `site-patterns.json` cache wiring.
