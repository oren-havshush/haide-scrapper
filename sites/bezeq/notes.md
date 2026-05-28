# bezeq.co.il

- **Listing URL:** https://www.bezeq.co.il/career_new/
- **siteId:** `cmpmv882i001x01mvhf9qfaqy`
- **Status:** waiting on worker deploy (config built, scrape will succeed
  once `browserOverrides` lands on the worker)
- **Job count:** 26 (live API as of 2026-05-26)

## Site shape

The careers landing page (`/career_new/`) doesn't render jobs in the
DOM at all — it shows two filter dropdowns (region + profession) and a
search button that redirects to
`https://www.bezeq.co.il/career/jobs/form/?jobs=<encoded-filter>` once
the user picks something. The page's own JS calls a JSON API on load to
populate the dropdowns:

```
GET https://d-api.bezeq.co.il/api/Adam/GetActiveJobs
  → { data: [ { order_id, description, notes_text, work_area,
                profession_name, tat_profession_name, Order_place,
                updateDate_ddmmyyyy, deadline_date, client_name, … } ] }
```

We scrape by running a `setupScript` that does a synchronous XHR to that
endpoint and injects 26 hidden `<div class="haide-job">` items with
`[data-field="…"]` spans + an `<a data-field="detailUrl"
href="https://www.bezeq.co.il/career/jobs/form/?jobs={order_id}">` per
job. Single-page (`pageFlow: []`). The bezeq config in prod
(`fieldMappings._meta.setupScript`) already contains the full script.

## The WAF block

bezeq.co.il rejects bare-Playwright TCP connections with
`ERR_CONNECTION_RESET` in ~3s. Confirmed by `sites/bezeq/probe.ts` —
the bare permutation resets every URL on `www.bezeq.co.il`, while the
same Chromium with a UA where `HeadlessChrome` is replaced by `Chrome`
gets HTTP 200 + the full 209KB body.

Failure pattern in prod scrapes: status `FAILED`, `jobCount: 0`, empty
`errorMessage`, total elapsed ~2–5s. This is the worker's `gotoForgiving`
re-throwing the navigation error before the setupScript can run.

## The fix

A new per-site `browserOverrides` block on the site config (lands in
`fieldMappings._meta.browserOverrides`, applied by the worker in
`createPage()`). Implementation lives across:

- [src/lib/validators.ts](../../src/lib/validators.ts) — schema
- [src/services/siteService.ts](../../src/services/siteService.ts) — persistence
- [worker/lib/playwright.ts](../../worker/lib/playwright.ts) — `BrowserOverrides` + merge logic in `createPage`
- [worker/jobs/scrape.ts](../../worker/jobs/scrape.ts) — `getBrowserOverrides` + thread through `executeScrape`
- [addsite.md](../../addsite.md) — Step 3 gate behavior + Step 6 doc

bezeq's override payload (Windows Chrome 131 — known-good across all
recent IL WAF checks, less likely than a server-side Linux UA to be on
a blocklist):

```json
"browserOverrides": {
  "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "extraHeaders": {
    "accept-language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7"
  }
}
```

## Onboarding sequence after worker deploy

```powershell
pwsh -File sites/bezeq/apply-overrides.ps1
```

This PUTs the existing config (with the new `browserOverrides` field
added) twice, PATCHes the site back to `ACTIVE`, triggers a scrape, and
polls until `COMPLETED` or `FAILED`. Expected: `jobCount: 26`.

## Notes / fallbacks

- If after deploy the scrape still fails (TCP reset on the worker host
  with a real Chrome UA), the block is geo/IP-based, not UA-based.
  That triggers Phase 3 — extending `browserOverrides` to carry a
  per-site `proxyUrl` and routing bezeq through an IL-egress proxy.
- The probe script ([probe.ts](probe.ts)) is parameter-free and safe to
  re-run from any host (locally or via SSH on the worker) to re-diagnose
  if behavior changes.
