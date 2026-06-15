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

## Already shipped (2026-06-15): rolling `minPublishDays`

Independent of FROZEN, the per-job rolling stale-cutoff is live:
- Config accepts `minPublishDays` (int, stored under `fieldMappings._meta`).
- Worker `getMinPublishDate` → `resolveMetaMinPublishDate` computes
  `cutoff = today − N days` on every scrape. Precedence: explicit
  `minPublishDate` (absolute) > `minPublishDays` (relative) > `SCRAPE_MIN_PUBLISH_DATE` env.
- **Date-less jobs are always kept** (`isPublishDateBeforeCutoff` returns false for them).
- addsite2 §10 makes `minPublishDays: 90` a mandatory part of every new onboard.
- Applied **opt-in** (only sites whose config sets it); existing live sites untouched.
