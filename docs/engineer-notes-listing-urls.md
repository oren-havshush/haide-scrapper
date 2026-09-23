# Engineer notes — several listing pages, one company (`_meta.listingUrls`)

Produced while onboarding `https://renuar.co.il/pages/דרושים` on 2026-09-22.

---

## ✅ RESOLVED (2026-09-22) — listingUrls shipped

One `Site` can now scrape several listing pages, so a company whose jobs are split
by department is **one employer** on the public jobs site instead of one per page.

- Config: `listingUrls` in `updateSiteConfigSchema` (`src/lib/validators.ts`),
  written to `fieldMappings._meta.listingUrls` by `saveSiteConfig`
  (`src/services/siteService.ts`). **No migration** — same shape as `pagination`.
- Worker: `worker/lib/listingTargets.ts` (pure, unit-tested) +
  the per-target loop in `executeScrape` (`worker/jobs/scrape.ts`).
- Gate: `verify-config --expect-listing-urls` (exact set match).
- Skill: `addsite2.md` §2.3. Learnings: `LRN-CO-2`, `LRN-WRK-21`.

---

## TL;DR

- A careers **hub** that links department listings is not a dead end and not a
  wrapper around one board. Its jobs are one click away, split N ways.
- Company identity lives on `Site` — `companyName`, about, HQ, and the logo at
  `/logos/<siteId>.png` — and `Job` reaches its employer only via `siteId`. So
  **one site per listing page = one employer per listing page**, each with its own
  logo file and its own captured profile. Nothing downstream merges them; at the
  time this shipped, zero of 144 ACTIVE sites shared a `companyName`.
- `siteUrl` is `@unique` and not patchable, so the hub cannot be retrofitted onto
  an existing site — an already-onboarded page keeps its row and gains the others.

## Test case — renuar.co.il

| Page | Jobs |
|---|---|
| `/pages/<drushim>` — the hub, links the three below | 0 |
| `/pages/stores-and-points-of-sale` | 28 |
| `/pages/company-headquarters` | 8 |
| `/pages/logistics-operations` | 1 |

All three share one template (`accordion-disclosure.accordion`), so one config
covers them. The logistics page has a single job — below the skill's `< 2` volume
bar as a site of its own, which is exactly the job that would have been lost.

## Semantics, and why

**A non-empty list REPLACES `siteUrl` as the target set.** `siteUrl` becomes the
company's canonical careers page: shown on the dashboard, used by
`company-profile` to derive the homepage, and not itself scraped. The alternative
("always scrape `siteUrl`, listingUrls are extra") was rejected because it makes
hub-as-`siteUrl` impossible without a permanently empty target.

There is precedent: a `pageFlow` site already never navigates `site.siteUrl` — it
goes to `pageFlow[0].url` — so `siteUrl` being a label is not new.

Replacing rather than appending is only safe because of two gates:

1. **The worker refuses to publish a partial set** (below). Dropping a page from
   the config does not quietly shrink the site.
2. **`verify-config --expect-listing-urls`** is an exact set match, so a page
   missing from a PUT exits 2 instead of passing.

## The failure modes this had to close

The design review found four ways a multi-page site could publish a partial set.
All four are closed before any write:

| Failure | What would have happened | Closed by |
|---|---|---|
| A page loads but yields 0 (WAF challenge, re-theme) | 29 of 37 committed; `isSuspiciousDrop` wants < 18, `job_count_drop` wants < 25.9 — neither fires | `listing_url_empty`, judged per page against the previous run (`minPrevious: 5`) |
| A page errors mid-run | the pages that worked become the site's new, smaller published state | `listing_url_failed`, nothing written |
| The run hits the 15-minute cap partway | a **manual** run's timeout handler deletes the site's listings outright | time-budget check **between** pages (120 s reserve) — a page the run cannot afford becomes a refusal instead. **Not** closed inside a page: one page's pagination + detail visits can outrun the reserve, and then the pre-existing manual-timeout delete still applies. Three pages sharing one 15-minute budget makes that likelier, not rarer — keep lists short. |
| `listingUrls` dropped from the config (extension Save rebuilds `_meta` from seven keys) | the next nightly scrapes only the primary page and commits it | `listing_urls_removed` refuses on a scheduled run; a manual run proceeds, which is how a page is retired on purpose |

All three categories are soft failures (`sweepSelection.ts`): never the breaker,
never counted a success, named in the attention queue with the offending URLs.

The baseline for "this page had rows last time" is the `_listingUrl` tag each raw
record carries into `Job.rawData`, read back with one grouped query. No column, no
migration, and rows written before the feature group under `""` so the first
multi-page run of an existing site raises nothing.

## Known limits (from the independent pre-deploy review)

- **`per_url_counts` is "kept after the cross-page raw dedup", not "written".**
  Validation and the normalized dedup run after the outcome is decided, so the
  per-page figure can sit slightly above what lands in the database.
- **The page-qualified fingerprint is the raw tier only.** The normalized dedup
  still keys on `id || url || title|location`, so a site that maps neither an
  id nor a URL can fold two same-titled, same-located jobs from different pages
  into one — exactly as it always could. Not a regression; noted so nobody
  reads the raw-tier comment as a full guarantee.
- **Converting an existing site whose raw `siteUrl` is not already its
  `URL.href` form** (a Hebrew path, an upper-case host) and listing that same
  page in `listingUrls` leaves last run's rows tagged with the raw form and the
  config holding the canonical one. The next scheduled run refuses with
  `listing_urls_removed` — loud, and one manual run re-tags. renuar's
  `siteUrl` is ASCII and already canonical, so it is unaffected.
- **After a config wipe, the manual scrape is the irreversible step.** The
  scheduled run refuses and names the pages; the attention row says
  "Investigate". A manual scrape from there commits the shrink — that is the
  documented operator override, so read the row before clicking.
- The batch dedup normaliser strips a trailing slash while `URL.href` keeps
  one, so a listing URL configured *with* a trailing slash can slip past the
  covered-by guard. Configure listing URLs without one.

## Deliberately not done

- **Per-page config overrides.** `listingUrls` is `{url}[]` today; the worker
  getter already returns a `ListingTarget[]` so adding `itemSelector` /
  `setupScript` per target is a field, not a refactor. Pages that genuinely
  differ go to REVIEW for now.
- **A `Company` model.** `LRN-CO-1` says there is no parent/owner field on `Site`
  and one must not be invented; this keeps company identity exactly where it is.
- **Making `siteUrl` patchable.** It would let an existing site adopt its hub, but
  it is `@unique`, it is the export slug, and it is what every report keys on.
- **Cross-host listing URLs.** robots/policy review is established per origin from
  `siteUrl`; a page on another host would be scraped with no policy of its own.
  `saveSiteConfig` rejects them.
- **Closing the re-analyze hole.** `PATCH /api/sites/:id {status:"ANALYZING"}`
  clears `configLocked` and queues an analysis **without** the ACTIVE-with-jobs
  guard that `createAnalysisJob` applies (the guard that exists because
  careers.iec.co.il lost a working config and all 53 of its jobs). `listingUrls`
  is exposed to that exactly as `setupScript` and `pagination` already are.
  Closing it means either removing the ability to re-analyze an ACTIVE site from
  that route or threading a `force` flag through it — a change with its own
  blast radius, and out of scope here. **Worth doing separately.**
