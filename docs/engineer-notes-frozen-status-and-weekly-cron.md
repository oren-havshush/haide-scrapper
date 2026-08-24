# Engineer notes — FROZEN status + weekly scrape cron (FUTURE / not built)

> Status: **SPEC ONLY — not implemented.** This documents an agreed design so we
> can build it later in one coherent slice. Nothing here is wired up yet.
>
> Decided 2026-06-15. The rolling `minPublishDays` cutoff (the per-job stale
> filter) **was** shipped separately — see "Already shipped" below. FROZEN was
> deferred because it's only correct once a regular scrape cadence exists.

## Goal

Automatically retire sites that have gone quiet. A site that hasn't changed in
**90 days** should move to a new `FROZEN` status (with an admin note) and drop
out of the active feed. This mainly targets **sites without per-job publish
dates** (alubin, mikud, IAA, …), where the rolling `minPublishDays` filter can't
tell whether the listing is stale — for those, "the scraped result set hasn't
changed in 90 days" is our staleness proxy.

## Why it's coupled to the weekly cron

"No change for 90 days" only means something if we scrape on a **fixed cadence**.
The plan is a **once-a-week cron** that scrapes every ACTIVE site. Without it,
scrapes are manual/sporadic and the freeze timer would misfire (a site could
freeze just because nobody re-scraped it, even though its content changed on the
site). **Build FROZEN and the weekly cron together.** Do not ship FROZEN against
the current manual-only scrape flow.

## Design

### 1. Schema (Prisma migration)
- Add `FROZEN` to `enum SiteStatus` (currently `ANALYZING, REVIEW, ACTIVE, FAILED, SKIPPED`).
- Add to `model Site`:
  - `contentHash   String?`   — signature of the last scraped result set.
  - `lastChangedAt DateTime?`  — when `contentHash` last changed.
  - `frozenAt      DateTime?`  — when the site entered FROZEN (mirror the existing `*At` columns).

### 2. Change detection (worker, per scrape)
After a successful scrape, compute a **stable** hash of the result set — e.g.
`sha1` of the sorted list of `externalJobId` (fall back to `title|location` when
an id is absent). Then:
- If `contentHash` differs from the stored value → update `contentHash` and set
  `lastChangedAt = now`.
- Else leave both as-is.

Notes:
- Hash the **identity set**, not volatile fields, so cosmetic re-renders don't
  count as "change". Sorting first makes it order-independent.
- This is the one piece cheap enough to land early as groundwork if we want
  accurate history before the cron exists (decided: NOT now — note only).

### 3. Freeze transition (driven by the weekly cron)
When the weekly scrape runs, after change detection:
- If `lastChangedAt` is non-null and `now − lastChangedAt > 90 days` → set
  `status = FROZEN`, `frozenAt = now`, `adminNote = "Auto-frozen: no change for 90 days"`.
- Emit `site:status-changed` (same event used elsewhere) so the dashboard updates.

### 4. Feed + dashboard
- The public/active jobs feed should **exclude FROZEN** sites (that's the point —
  drop inactive sources).
- Dashboard: show FROZEN as its own filter/badge.

### 5. Un-freeze
- Reuse the existing `--force` reactivation path (`PATCH status → ANALYZING`,
  see addsite2 §B1.5). A manual re-onboard or a detected change on a future
  scrape should be able to bring it back to ACTIVE.

### 6. Interaction with `minPublishDays` (already shipped)
- For sites **with** dated jobs: the rolling 90-day `minPublishDays` filter already
  thins old jobs; once all dated jobs age out, the site falls below the minimum-2
  rule and is a SKIP candidate at scrape time. FROZEN is the **complement** for
  **date-less** sites, using result-set stability instead of dates.

## Open questions for build time
- Exact freeze threshold — 90 days assumed; confirm.
- Should FROZEN sites still be scraped weekly (to auto-thaw on change) or fully
  paused? Leaning: keep scraping weekly but cheaply, so a revived site thaws.
- Where the weekly cron lives (separate scheduler vs worker self-schedule).

---

## Side note (2026-08-24) — the weekly cron needs a drift check, not just a scrape

> **Status: NOTE ONLY, nothing built.** Parked here because it belongs to the same
> slice as the weekly cron. Raised while onboarding flying-cargo.

### The problem the cron does NOT solve on its own

Config fixes are durable: `itemSelector` / `fieldMappings` / `setupScript` /
`formCapture` live on the site row, and a scrape only ever **reads** them. So a
weekly re-scrape reproduces today's output exactly — the setupScript re-executes
each run and re-injects every field. Only an **ANALYSIS** job rewrites a config
(`LRN-RACE-1/2`), and that is enqueued on site *creation*. **The cron must enqueue
SCRAPE only** — if a future "refresh" ever re-analyzes ACTIVE sites it would flatten
every hand-built config in the fleet at once.

What breaks instead is the **site**, not the config: a re-theme, new section wording,
a value outside a hardcoded list. And the worker's own safety behaviour is what makes
that invisible:

- 0 items extracted → early return `empty_results` (`worker/jobs/scrape.ts:3261`)
- items but 0 valid records → early return `structure_changed` (`:3327`)

Both return **before** `prisma.job.deleteMany` (`:3410`), so the last good harvest is
preserved. Correct for availability, and precisely why a dead config reads as a
healthy site: ACTIVE, COMPLETED, no failure — serving months-old rows. Already
observed on natali / biopharmax / msh (`LRN-WRK-15`, and the caveat block at the top
of `scripts/addsite-fleet-audit.ts`).

Compounding it: **no addsite2 gate ever re-runs after a site goes ACTIVE**
(`verify-config`, `verify-jobids`, `verify-location-csv`, `addsite-qa` are all
onboarding-time). `LRN-COV-5` is the same lesson from the coverage angle — l-w.ac.il
served 9 of its 60 jobs for months.

### Proposed: scrape → audit → alert

1. **Freshness** — compare `Site.lastScrapedAt` against `max(Job.createdAt)`. Scraped
   this week, newest job from months ago ⇒ the config is dead. One query, no browser,
   highest value. `addsite-fleet-audit.ts` recommends exactly this in its own header
   and does not implement it — that is the smallest useful first step.
2. **Surface `failureCategory`** — `empty_results` / `structure_changed` are the
   worker already reporting drift. Nothing reads them after the fact; the cron should
   alert on them rather than only on hard errors.
3. **Re-run the value gates** — `verify-location-csv` plus a coverage re-check (render
   with the stored `itemSelector`, compare live count to saved count). Browser cost, so
   run it over a rotating slice of the fleet rather than all sites every week.

### The gap none of those close: partial drift

If *some* fields break while extraction still succeeds, records persist, `deleteMany`
runs, and the harvest is silently replaced with **worse** data — no `failureCategory`,
no freshness gap, no alert. Only a value-level check catches it. Concrete example:
flying-cargo derives `location` from a hardcoded `CITIES` list in its setupScript, and
splits requirements on a Hebrew heading regex. A job posted in an unlisted city
degrades to the coarse region; a new heading wording folds requirements back into the
description. Both keep fill rates at 1.00. Any site whose setupScript encodes a
site-specific list or regex has the same exposure.

### Also worth fixing while in here

The "Already shipped" section below states that addsite2 §10 makes `minPublishDays: 90`
mandatory for every onboard. **That is now stale** — §10 says `minPublishDays` and
`minPublishDate` are inert and silently ignored at scrape time, replaced by `ageBucket`
(fresh/d90/d180/d365) computed at write time. This matters here because §6 of this doc
builds FROZEN's design on top of `minPublishDays` doing the thinning. Re-check that
interaction before building FROZEN.

---

## Already shipped (2026-06-15): rolling `minPublishDays`

Independent of FROZEN, the per-job rolling stale-cutoff is live:
- Config accepts `minPublishDays` (int, stored under `fieldMappings._meta`).
- Worker `getMinPublishDate` → `resolveMetaMinPublishDate` computes
  `cutoff = today − N days` on every scrape. Precedence: explicit
  `minPublishDate` (absolute) > `minPublishDays` (relative) > `SCRAPE_MIN_PUBLISH_DATE` env.
- **Date-less jobs are always kept** (`isPublishDateBeforeCutoff` returns false for them).
- addsite2 §10 makes `minPublishDays: 90` a mandatory part of every new onboard.
- Applied **opt-in** (only sites whose config sets it); existing live sites untouched.
