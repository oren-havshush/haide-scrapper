# Engineer notes — Pagination support & `setupScript` lifecycle on multi-page sites

Produced while re-onboarding `https://www.aman.co.il/careers/all/` on 2026-05-25.

---

## ✅ RESOLVED (2026-06-08) — pagination shipped

The engineering asks below have been **implemented**. The worker now
supports listing pagination via a first-class `pagination` config field
(`worker/jobs/scrape.ts:getPaginationConfig` / `advanceToNextPage`;
zod schema in `src/lib/validators.ts`):

- **`type: "url"`** — re-navigates the listing with an incrementing query
  param (`{ type:"url", param, start, step, maxPages, settleMs }`). It
  **composes with `pageFlow`**, so each paginated listing page still has
  its detail pages visited. Auto-stops on a repeated/empty page.
- **`type: "click"`** — clicks a `nextSelector` until it disappears/
  disables (`{ type:"click", nextSelector, maxPages, settleMs }`).
- A separate `loadMoreSelector` field handles append-style "load more".

Verified end-to-end on unitask-inc.com (2026-06-08): `type:"url"`,
`param:"paged"`, `start:1`, `maxPages:5` → 31 jobs across 4 pages, each
with full detail-page descriptions + the apply form. The "numbered
pagination AND detail fields can't coexist" conclusion below is therefore
**obsolete** — kept only for historical context. The path-based aman.co.il
case can now be onboarded with `type:"url"` (`param` per its scheme) or a
`type:"click"` next-link selector.

---

## TL;DR

- **Listings with numbered pagination (e.g. aman.co.il — 114 jobs across 12 pages) currently scrape only page 1.** Worker has no pagination support: no `nextPageSelector`, no `pagination` config slot honored, no URL-template support. Confirmed today — aman's latest production scrape returned 10 jobs.
- The workaround that has worked elsewhere (Assuta, NESS) is a `setupScript` that hits an internal AJAX endpoint and rewrites the listing DOM with all jobs in one shot. **This workaround does not work on multi-page sites** — strongly suggests `setupScript` is not executed on the listing page when `pageFlow` has a detail step. Confirmed today on aman: PUT'd a known-good `setupScript` to a multi-page config; scrape still returned 10 jobs (same as the no-`setupScript` baseline).
- Two engineering asks below, either one unblocks aman and similar sites.

---

## Test case — aman.co.il

- siteId: `cmp9uvymo001t01lsb6gwy6at`
- Listing URL: `https://www.aman.co.il/careers/all/`
- Live total displayed on page: `114 משרות`
- Pagination type: path-based — `…/careers/all/page/2/`, `/page/3/`, … `/page/12/`
- Server-side rendered (no JSON API fires on initial page load)
- BUT: the page's own filtering JS uses an admin-ajax endpoint that returns **all** jobs (as rendered HTML) in one POST. Verified by direct fetch:

  ```
  POST https://www.aman.co.il/wp-admin/admin-ajax.php
  Content-Type: application/x-www-form-urlencoded
  body: action=data_fetch&s=

  → 200 OK, ~534KB JSON; data.applications contains 111 <article class="positions_page__application">
  ```

  (111 vs. 114 — small gap is likely category-filtered/expired postings; close enough that pagination is no longer the blocker.)

---

## Reproduction — `setupScript` ignored on multi-page listing

Today (2026-05-25 12:46 UTC) we PUT this config to aman's site:

```jsonc
{
  "itemSelector": "article.positions_page__application",
  "setupScript": "(async function() { var r = await fetch('/wp-admin/admin-ajax.php', { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':'XMLHttpRequest'}, credentials:'same-origin', body:'action=data_fetch&s=' }); var d = await r.json(); var inner = document.querySelector('.positions_page__content-applications-inner'); if (inner) inner.outerHTML = d.applications; return document.querySelectorAll('article.positions_page__application').length; })();",
  "fieldMappings": { /* 6 fields, unchanged */ },
  "pageFlow": [
    { "url": "https://www.aman.co.il/careers/all/", "action": "navigate" },
    { "url": "https://www.aman.co.il/careers/*/*/", "action": "navigate" }
  ]
}
```

GET confirmed the config persisted (`_meta.setupScript` length 1157, all selectors intact).

Triggered scrape `cmpl7aft8000001mvcrc38yed`:
- status: `IN_PROGRESS` → `COMPLETED` in ~80s
- jobCount: **10** (identical to all previous multi-page runs without `setupScript`)

If the `setupScript` had run on the listing page, the worker would have seen 111 `<article>` elements after the DOM swap and produced ~111 jobs. Getting exactly 10 — the un-modified server-rendered count — means either:

1. The worker never invoked the `setupScript` on the listing page of this multi-page site, or
2. It invoked it but read the items *before* awaiting its returned promise.

(2) is unlikely because the same `(async function () { ... })()` pattern works on single-page Assuta/NESS configs — the worker clearly does await the returned promise there. So (1) is the working hypothesis: **multi-page suppresses `setupScript` on the listing**, not just on detail pages.

This had already been raised as an open question in `docs/engineer-notes-auto-apply.md`:

> The current skill doc says: "On multi-page sites the worker does not run `setupScript` on detail pages." What it doesn't clarify is whether `setupScript` still runs on the **listing page** of a multi-page site.

Today's test strongly suggests the answer is **no**.

The config has been reverted to its prior clean state (no `setupScript`, multi-page, 10 jobs/scrape) so the production data isn't affected.

---

## Engineering asks — pick either, both would be ideal

### Ask A — Run `setupScript` on the listing page of multi-page sites

This is the smallest change and unblocks aman immediately (plus any other site where the listing is paginated but the back-end exposes a "give me everything" AJAX/REST endpoint).

The flow we'd want:
1. Worker navigates to `pageFlow[0].url`.
2. Worker runs `setupScript` (if set) and awaits its returned promise — same as it does on a single-page site today.
3. Worker reads `itemSelector` matches **after** `setupScript` has completed.
4. For each item, worker follows the detailUrl to `pageFlow[1].url` (the existing multi-page behavior).

Open question for you: does this potentially break sites that rely on `setupScript` running on a single-page site only? I don't think so — the existing single-page semantics would be a strict subset of "listing-page setupScript", which is what the engineer-notes-auto-apply doc already proposed. Worth double-checking with a quick grep over saved configs to see if any single-page setupScript would misbehave if also called pre-detail-fetch.

### Ask B — Native pagination support

A real pagination feature in the worker. Two reasonable shapes:

**B.1 — `nextPageSelector` on `pageFlow[0]`**

```jsonc
"pageFlow": [
  {
    "url": "https://www.aman.co.il/careers/all/",
    "action": "navigate",
    "pagination": {
      "type": "nextLink",
      "selector": "a.next.page-numbers",  // or generic `a[rel="next"]`
      "maxPages": 20                       // safety bound
    }
  },
  { "url": "https://www.aman.co.il/careers/*/*/", "action": "navigate" }
]
```

Worker loop: read items on the current page, click `selector` (or navigate to its `href`), wait for items to re-render, repeat. Stop on `selector` missing, no new items, or `maxPages` hit.

**B.2 — URL template**

```jsonc
"pageFlow": [
  {
    "url": "https://www.aman.co.il/careers/all/",
    "action": "navigate",
    "pagination": {
      "type": "urlTemplate",
      "template": "https://www.aman.co.il/careers/all/page/{page}/",
      "startPage": 1,
      "maxPages": 20
    }
  },
  ...
]
```

Worker iterates `template` with `{page}` substituted, collects items from each, stops on `maxPages` or empty/404.

B.1 is more general (works for sites where the next link is JS-driven). B.2 is dead simple for path/query pagination like aman.

Once either of these ships, the addsite skill picks it up via the docs (currently it explicitly tells onboarders to scrape only page 1).

---

## Sites currently bottlenecked by this

Anything onboarded with `pageFlow` set AND a listing that shows fewer items than the site's total. Confirmed examples today:

- **aman.co.il** — 10/114 jobs scraped
- Likely others — worth running a one-shot audit:
  ```sql
  -- per-site: scrape.jobCount vs whatever "total expected" you track,
  -- flag sites with pageFlow.length > 0 and ratio < 0.5
  ```

---

## What the addsite onboarder will do in the meantime

Per the updated skill (`addsite.md`), onboarders will:
- Continue to scrape only page 1 for sites with numbered pagination.
- Avoid the "`setupScript` on multi-page" pattern — it doesn't work today.
- Note the gap in their final report so the user can decide whether to escalate.
