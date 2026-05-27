# Engineer notes — SPA timing & async `setupScript`

From onboarding `nvidia.wd5.myworkdayjobs.com/...?q=Israel` on 2026-05-25 (siteId `cmplb58zt000601mvvpvedp8g`).

## TL;DR

1. Worker runs `setupScript` **before** the SPA hydrates → empty DOM, no-op.
2. Worker does **not** await async `setupScript` promises → `fetch` enrichments fail silently.
3. Multi-page drops every item when the listing's only `<a href>` is relative.
4. `detailUrl` injected via hidden `<a data-extracted-*>` lands in `rawData.detailUrl`, top-level column stays `null`.

## Evidence

**(1)** Workday serves `<div id="root"></div>` (6.6 KB shell). Sync `setupScript` iterating `[data-automation-id="jobResults"] > ul > li` ran on 0 elements. Workaround: `MutationObserver` on `document.body` re-processing on mutation — got 20 jobs with clean `location` + `publishDate`.

**(2)** `setupScript` hitting `/wday/cxs/{tenant}/{site}/job/...` per item (same-origin, returns `jobDescription` JSON). Playwright dry-run: 20/20 descriptions in ~1.8 s. Same script in prod: every `[data-extracted-description]` empty. Worker doesn't await the returned promise — even on single-page configs.

**(3)** Multi-page with `pageFlow[1]=…/job/*` returned 0 jobs across 3 attempts. Items only have `<a href="/en-US/.../job/...">` (relative). Hypothesis: worker matches `item.href` literally without resolving against page origin, so no row qualifies.

**(4)** `detailUrl` with `[data-extracted-detailurl]`+`extractAttr:"href"` → `rawData.detailUrl` absolute ✓, top-level `null`. Same on keshet (`cmp59hc8g000h01lsbef61gcl`).

## Asks

- **A.** `await page.waitForSelector(revealSelector || itemSelector)` then `await page.evaluate(setupScript)`. Unlocks SPAs and JSON-API enrichments (Workday → full descriptions in one in-page fetch).
- **B.** Resolve relative `href` against page origin before matching `pageFlow[1].url`.
- **C.** Promote `rawData.detailUrl` to top-level column unconditionally.
