# addsite — learnings log (append-only)

> **Purpose.** The durable home for the hard-won onboarding incidents that were
> previously inlined in the `addsite` skill (~3,000 lines). The skill cites
> entries here by id (e.g. `see LRN-RACE-1`) instead of carrying the narrative
> in the always-loaded hot path. This is the **human-readable** memory; the
> **machine-usable** complement is `site-patterns.json` (see
> `docs/addsite2-migration.md` §4a.4).
>
> **Rules.** Append-only. Never delete an entry without a replacement. One entry
> per reusable signal. Each entry: id, date(s), site(s)+siteId, **signal** (the
> reusable trigger), **fix**, **generalizes-to**, **home** (skill section /
> recipe it backs). Site-specific selectors are NOT learnings — only generalizable
> signals belong here.

**Index**
- [A. Reachability & WAF](#a-reachability--waf)
- [B. Analyzer race / config persistence](#b-analyzer-race--config-persistence)
- [C. Apply form & usable-apply gate](#c-apply-form--usable-apply-gate)
- [D. externalJobId stability](#d-externaljobid-stability)
- [E. Location & gazetteer](#e-location--gazetteer)
- [F. Coverage, pagination & dynamic loading](#f-coverage-pagination--dynamic-loading)
- [G. SPA / ATS frameworks](#g-spa--ats-frameworks)
- [H. Worker behavior & config contract](#h-worker-behavior--config-contract)
- [I. Dedup & API quirks](#i-dedup--api-quirks)

---

## A. Reachability & WAF

### LRN-WAF-1 — UA-keyed WAF (TCP reset before any HTTP response)
- **Date / site:** 2026-05-27 · bezeq.co.il (`cmpmv882i001x01mvhf9qfaqy`)
- **Signal:** bare Playwright UA gets `ERR_CONNECTION_RESET` at the TCP layer in
  2–5s (no HTTP status); the same host returns 200 with a real desktop Chrome UA.
- **Fix:** add per-site `browserOverrides.userAgent` (+ `accept-language` header)
  to the config; worker applies it per scrape (`worker/lib/playwright.ts` `createPage`).
  Local Steps 3b/5/5b must use the same UA or they hit the same reset.
- **Generalizes to:** any UA-keyed WAF. **Home:** Step 3 reachability gate / `reach` script / `recipes/waf-incapsula-and-ua.md`.

### LRN-WAF-2 — Incapsula/Imperva `HeadlessChrome` block on detail pages
- **Date / site:** bankhapoalim.co.il (`cmq68fw91001101m9jpejoc9x`)
- **Signal:** listing loads fine bare, but per-job detail pages return a tiny
  (~800–1000B) HTML containing `Request unsuccessful` / `_Incapsula_Resource` /
  an incident id. The default Playwright UA carries the `HeadlessChrome` token.
- **Fix:** `browserOverrides.userAgent` = normal desktop Chrome UA (drop the
  `HeadlessChrome` token, keep major version near bundled Chromium). Probe one
  concrete detail URL with worker-parity stealth before trusting.
- **Trap:** **the listing passing bare does NOT prove detail pages do.** Always
  re-probe a detail URL for multi-page / detail-form sites.
- **Generalizes to:** Imperva/Incapsula on secondary pages. **Home:** Step 3 detail-WAF / `detail-reach` script.

### LRN-WAF-3 — `bypassCSP` when setupScript XHRs a different subdomain
- **Date / site:** bezeq.co.il (`cmpmv882i001x01mvhf9qfaqy`)
- **Signal:** scrape `COMPLETED` but `jobs=0`; a setupScript that XHRs another
  host (e.g. `d-api.bezeq.co.il`) silently fails; diagnostic shows
  `Failed to execute 'send' on 'XMLHttpRequest': Failed to load 'https://...'`
  (CSP `connect-src`, NOT CORS).
- **Fix:** add `browserOverrides.bypassCSP: true` (worker passes to
  `newContext({ bypassCSP: true })`). Per-site, opt-in.
- **Generalizes to:** any site whose data API is on a CSP-disallowed subdomain. **Home:** Step 6 browserOverrides / WAF recipe.

---

## B. Analyzer race / config persistence

### LRN-RACE-1 — Auto-analyzer clobbers your config after POST (single FIFO worker)
- **Date / sites:** 2026-06-09 batch (msh, hamat, loreal, rad) shipped 0/garbage on first pass.
- **Signal:** `POST /api/sites` enqueues an ANALYSIS job into the single-threaded
  FIFO worker queue; when it runs it re-derives `fieldMappings`, overwrites your
  PUT, and resets the site to REVIEW. Scrapes triggered before it ran got the
  analyzer's bad selectors.
- **Fix:** gate on the site **leaving ANALYZING** before Step 6 PUT; double-PUT
  (5s apart) so your write lands last; do local Steps 3–5b first so the analyzer
  usually finishes in parallel.
- **Generalizes to:** every freshly-created site. **Home:** Step 2 / Step 6 (the single canonical race section in addsite2 core).

### LRN-RACE-2 — Analyzer can still win *after* the double-PUT → verify persisted config
- **Date / site:** 2026-06-08 · yazamco.co.il
- **Signal:** even after the double-PUT, the analyzer finished later and replaced
  `itemSelector=div.job` with a broken `div.title-job.active-s > h3` matching only
  the one expanded accordion row → scrape returned 1 job (all deduped on empty id)
  instead of 12. Checking the PATCH *response* (not the persisted config) misses it.
- **Fix:** Step 7 MANDATORY verify gate — GET the **persisted** config, assert your
  `itemSelector` + field keys + formCapture survived; re-PUT up to 3×, else skip
  (`analyzer kept overwriting config`).
- **Generalizes to:** all sites. **Home:** Step 7 verify gate / `verify-config` script.

### LRN-RACE-3 — Reactivating SKIPPED/FAILED re-queues an analyzer
- **Signal:** `SKIPPED` may only transition to `ANALYZING` (→REVIEW→ACTIVE);
  the `→ANALYZING` transition queues a new analysis that overwrites fieldMappings.
- **Fix:** force `→ANALYZING`, wait for it to settle, THEN PUT (wins the race).
  Prefer delete + re-add fresh if the id need not be preserved.
- **Generalizes to:** all `--force` reactivations. **Home:** B1.5.

---

## C. Apply form & usable-apply gate

### LRN-APPLY-1 — The apply form usually lives on the per-job DETAIL page, not the listing
- **Date / sites:** 2026-06-11 · yes / career.yes.co.il (17 jobs) · l-b.co.il
- **Signal:** listing page opens apply via JS (looks "uncapturable"), but each
  `/jobs-lobby/<id>/` detail page carries a real server-rendered `<form>` that
  captures cleanly headlessly.
- **Fix:** **always drill into a detail page before declaring a form uncapturable.**
  Capture as per-job `applicationInfo` via `pageFlow`. `formCapture` and
  `applicationInfo` are equivalent "form captured" outcomes.
- **Generalizes to:** any site that opens apply from the listing. **Home:** B1.6.

### LRN-APPLY-2 — Batch shipped ACTIVE with `formCapture: null` (skipped Step 5b entirely)
- **Date / sites:** 2026-06-10 · 2.csv batch — 11 sites
- **Signal:** batch driver onboarded from a prebuilt config file and never ran
  Step 5b → ACTIVE with no apply form captured.
- **Fix:** form capture is a pipeline step, not optional. Never log ACTIVE with no
  captured form AND no email/url apply path. (Drove the "no batch path; single ×N" contract.)
- **Generalizes to:** any prebuilt-config driver. **Home:** B1.6 / B2.6 / onboard-one caution.

### LRN-APPLY-3 — Bot-challenge (Turnstile) apply gate ⇒ SKIPPED, not ACTIVE
- **Date / site:** L'Oréal Israel (`cmq6gxn3g001r01m9pfjejdhe`) — Avature `ApplicationMethods`
- **Signal:** guest "Copy & Paste resume" apply exists, but a Cloudflare Turnstile
  fires the instant you Continue past the method step (not on initial load),
  blocking the details form. Capture returns no usable form (exit 2, not exit 7).
- **Fix:** B2.5 "no usable apply path" gate → SKIPPED (until submit runtime can
  solve Turnstile). Confirm by driving one step past the Apply button (look for a
  "verify you are human" interstitial + Cloudflare Ray ID).
- **Generalizes to:** Avature + any post-method Turnstile/reCAPTCHA apply. **Home:** B2.5 / `recipes/form-capture.md`.

### LRN-APPLY-4 — Login/account wall on apply ⇒ SKIPPED (worker also refuses)
- **Signal:** apply form behind sign-in/account-creation (capture exit 7).
- **Fix:** PUT `applyRequiresLogin: true` + `applyLoginReason` (worker
  `getApplyRequiresLogin()` short-circuits future scrapes), PATCH SKIPPED, no scrape.
- **Generalizes to:** all login-gated apply. **Home:** 5b-LOGIN.

### LRN-APPLY-5 — Newsletter form shadows the real apply form
- **Date / site:** gomobile.co.il
- **Signal:** an always-rendered footer newsletter form (email + consent only) is
  the only `<form>` in the DOM when the real apply form mounts in a modal on click;
  a naive "first/largest form" grab returns the newsletter.
- **Fix:** scorer penalizes newsletter/subscribe + email-only forms; pass
  `--apply-selector` to click the modal open before capture. Sanity check: an
  "apply" form with only email + checkbox is almost certainly the newsletter.
- **Generalizes to:** any modal-mounted apply form. **Home:** Step 5b intro / `recipes/form-capture.md`.

### LRN-APPLY-6 — Partial data (title/location only) ⇒ SKIPPED, never ACTIVE
- **Date / site:** bankhapoalim.co.il first pass (3 title-only stubs)
- **Signal:** scrape returns rows with only title+location because detail pages
  (description + apply) were WAF-blocked.
- **Fix:** B2.5 — after one permitted Incapsula UA-override attempt, if detail
  pages stay blocked → SKIPPED (`only partial data`). A job needs description AND
  a usable apply path to be ACTIVE-worthy.
- **Generalizes to:** all detail-blocked sites. **Home:** B2.5.

### LRN-APPLY-7 — `formCapture.formSelector` matched the WRONG form on the listing page (live-extract clobbers static fields)
- **Date / site:** 2026-06-22 · proportsia.co.il (`cmqo82pcr001101qplimsnicc`)
- **Signal:** static `formCapture.fields` are correct (incl. a `file` CV input),
  `verify-config` shows all N fields stored, yet the dashboard per-job **Application
  Form** table is missing the CV field and instead shows junk hidden inputs
  (`*_for_uco_crm_integration`, `*_for_fixdigital_integration`) with `actionUrl` =
  the **listing** URL. The site-level "Application Form (Site-level)" panel (reads
  `_meta.formCapture`) is correct; only the per-job table is wrong.
- **Root cause:** the per-job table renders `rawData._formData`, which the worker
  **live-extracts at scrape time** with `extractFormDataOrFallback`. On a
  listing-only site (no `pageFlow`), that extraction runs against the **listing
  page**, where `formSelector: form.elementor-form` matched the site's own
  WP/Elementor newsletter/contact form. Because a form matched, the worker used it
  and **never fell back** to the static `fields` blob. The real apply form only
  exists on detail pages, which a single-page scrape never visits — so live
  extraction can only ever capture the wrong form. (`worker/jobs/scrape.ts`
  `extractFormData` → `extractFormDataOrFallback`; static blob is used only when the
  selector matches **nothing**.)
- **Fix:** make `formSelector` specific enough that it matches **nothing** on the
  listing page, forcing the static-blob fallback. Appending `:has(input[type="file"])`
  works for CV-upload forms: `form.elementor-form:has(input[type="file"])`. The
  listing newsletter form has no file input → no match → worker serializes the
  captured static fields (incl. CV) into `_formData`. Re-scrape to repopulate
  `_formData` on existing jobs. No worker/dashboard code change needed — this rides
  the existing fallback path.
- **Distinct from LRN-APPLY-5** (newsletter shadow): that is a *capture-time*
  scorer problem; this is a *scrape-time* live re-extraction that silently overrides
  a correctly-captured static blob.
- **Generalizes to:** any listing-only site (no `pageFlow`) whose listing page
  contains a decoy `<form>` matching your `formSelector`, while the real apply form
  lives on detail pages. **Home:** Step 5b / `recipes/form-capture.md` §7.

---

## D. externalJobId stability

### LRN-ID-1 — Never index-based; hash stable content + a disambiguator
- **Date / site:** halilit.com (`cmq68mpnq001501m9p50vwgee`) — id-less branch table
- **Signal:** listing exposes no native id/link; tempting to use row index → any
  reorder/add/remove re-keys every job (mass churn); empty id collapses all rows.
- **Fix:** `setupScript` injects `h-<hash(title+branch)>` (small pure-JS hash,
  ASCII-safe). Disambiguator matches how the site distinguishes same-title roles.
- **Generalizes to:** any id-less listing. **Home:** Step 4 id synthesis / `recipes/setupscript-patterns.md`.

### LRN-ID-2 — Hybrid: native id when present, hash fallback otherwise
- **Date / site:** hamat-group.co.il (`cmq6gxlnk001n01m99axjfu8u`) — 2/12 carry `מס' משרה`
- **Signal:** some items print a real job number, most don't.
- **Fix:** scan for the native id first (`/מס'?\s*משרה/` → digits), fall back to
  `h-<hash(title)>`. `h-` prefix prevents collision with native numbers.
- **Generalizes to:** IL sites with sparse native ids. **Home:** Step 4 hybrid id recipe.

### LRN-ID-3 — Prefer a per-item hidden form input over framework-internal anchors
- **Date / sites:** eimsys.co.il (`cmq68viva001b01m902an8gzs`) `input[name="queried_id"]`;
  msh.co.il (`cmq6gxm6y001p01m9k3k3pwyv`) accordion `#collapse-21421` ≠ real `מס' משרה 4066`
- **Signal:** WordPress/Elementor inline apply forms carry a hidden `queried_id`
  (true post id). Accordion toggles / `aria-controls` are internal widget ids, NOT job ids.
- **Fix:** map the hidden input (`extractAttr: value`); for accordions extract the
  visible `מס' משרה` number via setupScript regex, don't map the `#collapse-` href.
- **Generalizes to:** WP/Elementor "now hiring" + Bootstrap accordions. **Home:** Step 4 id rules.

### LRN-ID-4 — Enforce externalJobId quality with a value-based gate, not prose
- **Date / site:** alubin.com (`cmqe7idzs004l01lcvjr73xau`) — Elementor sectioned listing
- **Signal:** despite the "never raw title / never index" rule being documented,
  a build shipped `externalJobId === raw Hebrew title`. Prose rules don't stop the
  miss; `verify-config` only checks the selector *survived*, not the id *values*.
- **Fix:** added `addsite-batch.ts verify-jobids` — fetches the scraped jobs and
  exits 2 on raw-title reuse (`id === title`), index-based ids, all-identical
  collapse, or fill < 0.9. Wired as a MANDATORY gate before ACTIVE in `addsite2.md`
  §12 + correctness rule #4. Re-keyed alubin to `h-<haideHash(title)>` (ASCII-safe).
- **Generalizes to:** every site — the gate runs on real id values regardless of how
  the config was built. **Home:** `addsite2.md` §12 / `recipes/setupscript-patterns.md` §3.

### LRN-ID-6 — Non-Latin URL slugs: hash the slug, don't use it raw or decoded
- **Date / site:** madanes.com (`cmqo82ph6001301qpa01wzqn7`), 2026-06-22
- **Signal:** id built from a Hebrew URL slug came out as a 200-char
  `madanes-%d7%a0%d7%a6%d7%99%d7%92...` blob (raw percent-encoded `href` segment).
  `decodeURIComponent()` instead yields raw Hebrew → fails the `verify-jobids` ASCII
  check (`nonAscii: N`). Both forms are "technically unique" but unusable on the dashboard.
- **Fix:** keep the slug only as the **hash input** — emit `'<prefix>-' + haideHash(slug)`
  (djb2; short, ASCII, still per-URL-unique). Same pattern as qasisrael.co.il
  (`qas-' + hh(title)`). Result: `madanes-1gfcy2f`.
- **Rule refinement:** the "detailUrl slug" id option (recipe §3 priority 2) applies
  **only to Latin/ASCII slugs**; non-Latin slugs go straight to hash synthesis.
- **Generalizes to:** every Hebrew/RTL or non-Latin slugged site. **Home:**
  `recipes/setupscript-patterns.md` §3.

---

## E. Location & gazetteer

### LRN-LOC-1 — Inject a constant/computed location when the listing omits it
- **Date / sites:** abt-industry.co.il (run `cmp5ibrop000t01lsrqaasmq1`) single office;
  msh.co.il (`cmq6gxm6y001p01m9k3k3pwyv`) 2/6 gazetteer → constant תל אביב;
  natali.co.il (`cmq7sn3au000601mfqhld00pa`) per-item region (2 field→המרכז, 9→רמת גן)
- **Signal:** no structured location field; the IL gazetteer only auto-fills
  `location` for jobs naming a token it recognizes → partial/inconsistent coverage.
- **Fix:** setupScript injects a hidden span per item (constant for single-office;
  computed `לאזור/באזור <region>` else HQ city otherwise). Always inject on every
  item — the gazetteer only runs when `location` is empty, so injecting bypasses it.
  Only blanket-inject when confident every posting shares the location.
- **Generalizes to:** single-HQ / region-in-prose employers. **Home:** Step 4 location / `recipes/setupscript-patterns.md`.

### LRN-LOC-2 — Gazetteer common-word ↔ place collisions
- **Date:** fixed worker-wide 2026-06-10
- **Signal:** the bare `ב<city>` matcher read **"במשמרות" ("in shifts") as the
  moshav משמרות**.
- **Fix:** `BARE_PREFIX_DENYLIST` in `worker/lib/normalizer.ts`. If a resolved
  location is really a common Hebrew word (shift/role/condition term), suspect the
  same collision and add it to the denylist.
- **Generalizes to:** any common-word↔place collision. **Home:** Step 4 location note.

### LRN-LOC-3 — Slice a value out of a larger text node via setupScript (not CSS)
- **Date / site:** goldpro.co.il
- **Signal:** value buried in prose ("מיקום המשרה: תל אביב\n…") with no element
  wrapping just the value. The worker ignores `regex/transform/extractRegex/postProcess`.
- **Fix:** setupScript regex → inject `[data-extracted-location]` span → map a
  normal CSS selector at it.
- **Generalizes to:** any in-prose field. **Home:** Step 4 setupScript fallback.

---

## F. Coverage, pagination & dynamic loading

### LRN-COV-1 — Coverage gate is mandatory; never silently ship page 1
- **Date / site:** 2026-05-31 · NVIDIA Workday (`cmplb58zt000601mvvpvedp8g`) first
  shipped 20 of 480 jobs because the check was skipped.
- **Signal:** dry-run/scrape count < the page's "N of M" total.
- **Fix:** establish true total (results header → SPA API → paginate to exhaustion);
  configure `pagination`/`loadMoreSelector`/setupScript enumeration; always emit
  `coverage: extracted/total`. Ship partial only with explicit user sign-off.
- **Generalizes to:** all paginated/lazy sites. **Home:** Step 4 coverage gate.

### LRN-COV-2 — Worker-supported dynamic loading (don't reinvent)
- **Signal:** infinite scroll / "Load more" / numbered / url-param pagination.
- **Fix:** infinite scroll handled out-of-box (`autoScrollUntilStable`);
  `loadMoreSelector` (composes with `pageFlow`, verified rad.com 8→12);
  `pagination {type:"click"|"url"}` (verified unitask-inc.com `?paged=N` 31/4 pages).
  For MVP always scrape the unfiltered URL.
- **Generalizes to:** all dynamic listings. **Home:** Step 4 dynamic-loading / `recipes/pagination-and-loading.md`.

### LRN-COV-3 — Paginated-listing expansion via setupScript (site's own AJAX)
- **Date / site:** aman.co.il (`/wp-admin/admin-ajax.php?action=data_fetch`, 111 jobs); Assuta/NESS
- **Signal:** site fetches all results from its own AJAX endpoint.
- **Fix:** single-page config; setupScript calls the endpoint, rebuilds the listing
  container with one row per posting. (With the 2026-06-03 multi-page setupScript
  fix this can combine with detail visits — re-verify before trusting.)
- **Generalizes to:** WP admin-ajax listings. **Home:** Step 4 / `recipes/setupscript-patterns.md`.

---

## G. SPA / ATS frameworks

### LRN-SPA-1 — Known offset-API SPAs: enumerate via their API, not the DOM
- **Date / site:** NVIDIA Workday (`cmplb58zt000601mvvpvedp8g`) 480/480, 450 desc (`sites/nvidia/setup.js`)
- **Signal:** host matches Workday (`*.myworkdayjobs.com`) / Greenhouse / Lever /
  iCIMS / SmartRecruiters / Ashby; page URL doesn't change between pages.
- **Fix:** single-page config; setupScript loops the list API by offset until
  `total`, rebuilds rows, enriches descriptions via detail endpoint with bounded
  concurrency (~6) + retry (429). Expect ~90–95% desc coverage.
- **Generalizes to:** all offset-API ATSes. **Home:** Step 4 SPA frameworks / `recipes/spa-frameworks.md`.

### LRN-SPA-2 — Comeet/Spark Hire is NOT an offset-API SPA — do not auto-skip
- **Date / site:** Netafim (`cmq57x5gm000201qpvxa2grkv`) 6/6
- **Signal:** `comeet.com/jobs/...` / `comeet.co`; positions embedded in initial
  HTML, Angular hydrates client-side; render reliably at `domcontentloaded`.
- **Fix:** normal single-page DOM config (`li:has(> a.positionItem)`, `data-qa`
  detail hooks) + guarded polling setupScript; ship the **static `formCapture`
  template** (apply button doesn't mount the form headlessly); set an `adminNote`.
  Was wrongly auto-skipped as "SPA chrome only" — real cause was the analyzer
  clobber + dry-run/scrape mismatch.
- **Generalizes to:** all Comeet/Spark Hire sites (reusable form template). **Home:** Step 4 Comeet recipe.

### LRN-SPA-3 — Elementor popup-driven listings — pull details + id from the popup
- **Date / site:** natali.co.il (`cmq7sn3au000601mfqhld00pa`) 11/11
- **Signal:** Elementor Pro page shows only title + apply button; description /
  requirements / form live in a popup that mounts on click; the button href encodes
  the popup id = WP post id.
- **Fix:** setupScript hides cookie/marketing popups, decodes id from
  `atob(settings).id` (→ stable externalJobId), opens popup programmatically
  (`elementorProFrontend.modules.popup.showPopup`), scans only the heading/text
  widgets (not the whole modal — apply `<select>` leaks region options), injects
  fields. Ship apply form as static `formCapture`.
- **Generalizes to:** Elementor Pro popup listings. **Home:** Step 4 Elementor recipe.

---

## H. Worker behavior & config contract

### LRN-WRK-1 — Worker honors only a fixed set of field-mapping attributes
- **Signal:** API accepts `regex/transform/extractRegex/postProcess/extract` but
  the worker **ignores** them — you get the whole text node dumped in the field.
- **Fix:** only `selector/extractAttr/confidence/source/capturedOnUrl` are honored.
  For anything else use `setupScript`.
- **Generalizes to:** all configs. **Home:** Step 6 payload contract.

### LRN-WRK-2 — setupScript: append to item root; guard re-runs; async OK; runs on detail pages
- **Date:** async-await fix 2026-05-31; multi-page setupScript fix 2026-06-03 (commit `4fe63e2`); mei-avivim.co.il (`cmpxma4wd000001qnyogf85tl`, pageFlow=2)
- **Signal/Fix:**
  - **Append injected spans to the `itemSelector` node**, NOT to an element another
    field reads — hidden text leaks into e.g. the title (bit msh.co.il: spans had
    to go on `.panel`, not `.panel-title__el`).
  - Guard `!s.querySelector('[data-extracted-…]')` so scroll/re-run loops don't dup.
  - `await` supported (worker runs body as AsyncFunction) — **no IIFE** (it'd
    resolve before the inner promise).
  - Runs on listing AND every detail page since 2026-06-03 — write it to no-op in
    the wrong context.
  - Cost: ~1.5s per `runSetupScript` call, once per detail page on multi-page.
- **Home:** Step 4 setupScript rules.

### LRN-WRK-3 — Single-threaded FIFO worker — parallel prod scrapes buy nothing
- **Signal:** worker is one `isProcessing` guard + oldest-PENDING-first poll.
- **Fix:** onboard sequentially on the prod side; parallelize only local discovery
  (Steps 3–5b). Used by the v2 "requeue" mechanic (append to work-list, not retry now).
- **Home:** Step 2 / Step 8 / addsite2 §4a.2.

### LRN-WRK-4 — Prefer universal selectors over framework-specific on detail pages
- **Date / site:** unitask-inc.com
- **Signal:** WP sites mix Elementor + Gutenberg/Classic posts; Elementor-only
  selectors silently drop the non-Elementor posts. Also: worker description-
  enrichment is greedy for `externalJobId` (includes trailing form-label text).
- **Fix:** `article .entry-content` (desc), `article h2` (headings); sample one
  detail page per layout variant in dry-run; prefer a real CSS selector over
  relying on enrichment.
- **Home:** Step 4 setupScript notes.

### LRN-WRK-7 — `POST /api/sites` silently drops `companyName` — PATCH standalone + verify
- **Date / batch:** 5.csv batch, then 6.csv batch (all 10 sites), 2026-06-22
- **Signal:** dashboard shows sites with no company name; `companyName: null` on every
  site even though the create payload included `{"companyName": "..."}` (sent alongside
  `status: "ACTIVE"`).
- **Root cause:** the create endpoint does **not** persist `companyName` from the POST
  body (mirrors the §0.2 PATCH "one field honored" landmine). Putting the field in the
  create body is a no-op.
- **Fix:** after `POST /api/sites`, issue a **standalone single-field**
  `PATCH /api/sites/:id {"companyName": "..."}`, then **GET by URL** (the `/:id` GET can
  return empty for fresh sites) and confirm it stuck. `addsite-batch.ts` create path does
  this; hand-rolled create scripts MUST replicate it.
- **Batch gate:** B3.1 — sweep all sites at end of batch and re-PATCH any null companyName.
- **Generalizes to:** any site creation. **Home:** `addsite2.md` §4 create + §B3.1.

### LRN-WRK-6 — Detail-fetch must capture the COMPLETE body, not cherry-picked headings
- **Date / site:** madanes.com (`cmqo82ph6001301qpa01wzqn7`), 2026-06-22
- **Signal:** site shows per-job meta the scrape is missing —
  `משרה מלאה, ראשון-חמישי 09:00-17:00` (employment type + hours) and
  `חטיבת פרט` (division). The first detail-fetch setupScript grabbed only the two
  headings it recognised (`במסגרת התפקיד` + `דרישות`) and silently dropped the
  `.jobTags` meta block and the intro/lead paragraph.
- **Fix:** capture the whole job-content container (`.jobItemRight`); route typed
  meta into fields (`.jobTags .location` → `location`, `.jobTags .type` → `department`,
  prepend `.jobTags .scope` to `description`); build description/requirements by
  walking **all block descendants in document order** (`querySelectorAll('h2,h3,h4,p,ul,ol')`,
  not `.children`) and splitting on the `דרישות` heading by position.
- **Two traps:** (1) markup nesting varies between jobs on the same site — iterating
  `container.children` works for one job and folds requirements into description for
  another; walk descendants instead. (2) dry-run on ≥2 structurally-different jobs or
  the nesting trap stays invisible.
- **Generalizes to:** any detail-fetch / detail-page description extraction.
  **Home:** `recipes/setupscript-patterns.md` §11 (`LRN-SETUP-3`).

### LRN-WRK-5 — `publishDate` age-bucket flagging (keep-all, not drop)
- **Date / site:** tafkid-plus.co.il (`תאריך פרסום: DD.MM.YYYY`), diplomat-il (hidden `activationDate`)
- **Signal:** `publishDate` mapped with parseable dates.
- **Old behavior (deprecated):** `minPublishDate: "2026-01-01"` dropped jobs strictly before it.
- **New behavior:** worker assigns `ageBucket` (`fresh` / `d90` / `d180` / `d365`) at scrape
  time. Every job is kept. Dashboard shows bold badges and an age counter bar; age filter lets
  you drill by bucket. `minPublishDate` / `minPublishDays` are now inert — do not set for
  new onboards.
- **RedMatch hidden date:** `<span data-field="activationDate" style="display:none">` on listing
  cards → selector `[data-field='activationDate']`, source `LISTING`.
- **Home:** Step 4 publishDate patterns + Step 6 (minPublishDate section).

---

## I. Dedup & API quirks

### LRN-API-1 — `/api/sites?pageSize>100` silently returns `[]`
- **Date / site:** tafkid-plus.co.il (was ACTIVE the whole time; a `pageSize=500` sweep returned `[]`)
- **Signal:** the list endpoint does not clamp/error past its ~100 cap — `pageSize=500`
  / `?page=2` comes back with empty `data`. "Fetch all + substring-match" reports
  every onboarded site as new once the catalog grows past one page.
- **Fix:** dedupe with the **exact `?siteUrl=` query** trying obvious variants
  (trailing slash, http/https, www/bare). If enumerating, page with `pageSize<=100`
  and walk `meta.total`; treat unexpectedly empty `data` as a cap failure to retry
  smaller, not "no match."
- **Generalizes to:** all dedup / enumeration. **Home:** Step 1.

### LRN-API-2 — BOM-free UTF-8 for config writes; bypass PowerShell for Hebrew labels
- **Signal:** `Set-Content -Encoding UTF8` writes a BOM on PS 5.1 (server JSON parser
  may reject); Hebrew form labels get mojibake when routed through the PS parser /
  active code page.
- **Fix:** write config with `UTF8Encoding($false)` (no BOM); write Hebrew form
  capture JSON via the file tool directly (never through PowerShell); verify
  byte-for-byte on read-back.
- **Generalizes to:** all Windows config/label writes. **Home:** Step 6 / Windows gotchas.

---

## Change log

- **2026-06-14** — Created the log; seeded with the incidents extracted from the
  `addsite` skill during the addsite2 audit (see `docs/addsite2-migration.md`).
  These entries remain inlined in `addsite` for now; the citation pass (replace
  narrative with `see LRN-…`) happens in addsite2 Phase 0/2.
