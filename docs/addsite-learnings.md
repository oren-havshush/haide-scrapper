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

### LRN-APPLY-8 — Wix lightbox apply form (button opens a popup, form not in listing DOM)
- **Date / site:** 2026-06-29 · campkimama.org (`cmqynnjle004901nz99j7vrhl`) 9/9
- **Signal:** the apply button is a Wix Stylable button — `<a role="button"
  data-popupid="..." aria-haspopup="dialog">` with **no `href`** (label e.g.
  `הגישו מועמדות`). The real application form lives in a Wix **lightbox/popup** that
  mounts only on click; it is **absent from the listing DOM** at scrape time
  (querying for the form id returns nothing until the popup opens).
- **Capture-time gotchas:**
  - A programmatic `el.click()` (via `Runtime.evaluate`) does **NOT** open the popup —
    Wix's handler needs a **real pointer click** (`browser_click` on a snapshot ref).
    Open it, then read the form fields.
  - The form can be rich and **captcha-free** (Kimama: name/contact/address, DOB,
    a **Position `<select>`** listing every role, free-text, and **2 file/CV uploads**)
    — genuinely auto-apply-friendly, unlike the Niloos reCAPTCHA form (LRN-SPA-7).
  - All jobs usually share **one** popup (`data-popupid` is identical across items);
    the applicant picks the role from the Position dropdown. It's a site-level form.
- **Fix (worker contract):** store it as a **static `formCapture`** whose `formSelector`
  is the **lightbox form id** (e.g. `#comp-kvgjjpej`). That id matches **nothing** on
  the listing page → the worker's live extract fails → it serializes the static
  `fields` blob into every job's `_formData` (the §7 fallback path). The worker never
  opens the popup. Verify a sampled job's `_formData` lists the `file` field.
- **Generalizes to:** any Wix site whose apply button opens a lightbox/popup form
  (`aria-haspopup="dialog"` + `data-popupid`). **Home:** Step 5b /
  `recipes/form-capture.md` §8.

### LRN-APPLY-9 — RedMatch / TopMatch apply page has NO `<form>` (bare inputs by CSS class) — and it's a shared multi-tenant platform
- **Date / site:** 2026-06-30 · careers.topmatch.co.il/tadiran (`cmqykv29i003i01nzvw1z5jpw`)
- **Signal:** site onboarded listing-only (`pageFlow: []`, API-injected items via
  `CandidateAPI`), so jobs carried only an apply **URL** in `applicationInfo`, never
  the form schema. The apply page (`redmatch-apply/redmatch.apply.html?compPositionID=<id>`)
  renders a full candidate form (שם פרטי/משפחה, אימייל, ת"ז, טלפון, ארץ/עיר selects,
  **קורות חיים file upload**, source dropdowns, privacy checkbox) — but `document.querySelectorAll('form').length === 0`.
  The fields are **bare `<input class="form-control first-name">` / `select.cityBase` /
  `input.inputfile.CV#uploadeFile`** with **empty `name` attributes**, not wrapped in
  a `<form>`. So the worker's auto-capture (`extractFormData` → `document.querySelector("form")`)
  returns null even if a `pageFlow` visited the apply page, and there are no `name`s to map.
- **Fix:** capture a **static `formCapture`** manually:
  - Derive each field's `name` from its CSS class (`first-name`, `last-name`, `Email`,
    `ID`, `cell-phone`, `country`, `cityBase`, `uploadeFile`, `sourcesDDL`, etc.) —
    the empty `name` attribute is unusable.
  - Set `formSelector` to a **bare-input class that never appears on the listing page**
    (e.g. `input.inputfile.CV`). It matches nothing on the listing → worker uses the
    static `fields` blob (same §7 fallback mechanism as LRN-APPLY-7/8, but here it's
    because there is **no `<form>` at all**, not a decoy form).
  - Capture `<select>` options (country, source-type) for auto-apply; the city `<select>`
    is JS-populated (1200+ options) so store just the placeholder.
  - Then PUT + re-scrape; verify a sampled job's `_formData` lists the `file` field.
- **Shared platform — fix once, applies to all tenants:** TopMatch/RedMatch is a
  multi-tenant ATS at `careers.topmatch.co.il/<tenant>/` (all share the same
  `CandidateAPI` + `redmatch.apply.html`). The **same static `formCapture` shape works
  for every tenant** (only the listing `setupScript` / position IDs differ).
  `careers.topmatch.co.il/diplomat-il` is the same platform and was previously logged
  "no apply path (NONE)" — that verdict was **wrong**; it has this exact capturable form.
- **Generalizes to:** any apply page that renders form fields as bare inputs with no
  enclosing `<form>` (worker auto-capture finds 0 forms), and any TopMatch/RedMatch
  tenant. **Home:** Step 5b / `recipes/form-capture.md` §9.

### LRN-APPLY-10 — Invisible (v3) reCAPTCHA does NOT make a form uncapturable
- **Date / site:** 2026-08-03 · minrav.co.il/careers/ (`cmsbxxv9b000601p0hbhkk5r9`)
- **Signal:** onboarding saw Google reCAPTCHA on a per-job Contact Form 7 apply form,
  applied the "Turnstile/CAPTCHA gate → SKIPPED" rule (§8 / LRN-APPLY-3), and shipped
  `formStatus: EMAIL` with `formCapture: null` — discarding a real CV-upload form that
  the site presents as its primary apply path. The user found the form by hand
  (`div.c-form-primary`) and rejected the verdict.
- **Root cause — two different failure modes were collapsed into one rule:**
  - **Blocking challenge** (Turnstile, reCAPTCHA v2): fires *before* the form is
    reachable; the fields never render → genuinely uncapturable. LRN-APPLY-3 stands.
  - **Invisible / score-based** (reCAPTCHA **v3**): the form renders in full and every
    field is readable. The captcha gates **submission**, not **capture**.
- **Fix:** identify which kind before skipping. v3 markers — `recaptcha/api.js?render=<sitekey>`
  (a `render=` param rather than a rendered widget), a hidden `g-recaptcha-response` /
  `_wpcf7_recaptcha_response` input, `window.grecaptcha` defined with no visible
  checkbox or challenge iframe. When it is v3 → **capture the form normally**, keep the
  careers email or apply URL in `applicationInfo` as a parallel fallback, and record the
  token caveat in `adminNote`: CF7's token is browser-generated with a ~2 min TTL, so a
  server-side POST of the static fields alone will fail — the submitter has to render
  the page for a fresh token.
- **Generalizes to:** every reCAPTCHA-v3-protected apply form — very common on Israeli
  WordPress + Contact Form 7 / Elementor sites. **Home:** `addsite2.md` §8 captcha gate /
  `recipes/form-capture.md` §0.

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

### LRN-ID-7 — Never hash a field you may later normalize (location churn)
- **Date / site:** 2026-08-03 · minrav.co.il/careers/ (`cmsbxxv9b000601p0hbhkk5r9`)
- **Signal:** the id was `h-<hash(title + '|' + location)>`. A later data-quality fix
  corrected the location (`מטה החברה, תל-אביב` → `תל אביב-יפו`, see LRN-LOC-4) and
  silently re-keyed all 5 affected jobs. Cleaning a field should not churn the dedup key.
- **Fix:** hash only the most stable unique field. Titles were globally unique here
  (11/11 distinct), so `h-<hash(title)>` is both unique and immune to location or
  formatting corrections. Add a disambiguator (LRN-ID-1) **only** when titles genuinely
  repeat — and pick one unlikely to be normalized later (department / branch / req
  number over a free-text location string).
- **Note — re-keying leaves no orphan jobs, but does orphan overrides:** every scrape
  runs `prisma.job.deleteMany({ where: { siteId } })` and re-inserts
  (`worker/jobs/scrape.ts:3208`), so the job set is replaced wholesale. But
  `JobLocationOverride` is keyed by `externalJobId` (`prisma/schema.prisma:144`), so a
  re-key detaches any manual dashboard location override.
- **Generalizes to:** every hash-synthesized id. **Home:** `recipes/setupscript-patterns.md` §3.

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

### LRN-LOC-4 — `CSV files/city.csv` is the canonical spelling — the worker gazetteer disagrees with it
- **Date / site:** 2026-08-03 · minrav.co.il/careers/ (`cmsbxxv9b000601p0hbhkk5r9`)
- **Signal:** the site printed `מיקום: מטה החברה, תל-אביב` — two separate defects: an HQ
  label that isn't a place, and the spelling `תל-אביב`, which exists in **neither**
  reference list. Deriving a "canonical" spelling from the worker gazetteer would have
  produced `תל אביב` — a value the product's own city list does not contain.
- **The two lists are NOT the same** (measured 2026-08-03):

  | list | entries |
  | --- | --- |
  | `worker/data/il-places.ts` (`IL_CITIES` + `IL_REGIONS`) | 1385 |
  | `CSV files/city.csv` (product city list) | 1365 |
  | in gazetteer but **absent** from `city.csv` | **29** |

  The divergences are mostly dual spellings: `תל אביב` (the CSV has only `תל אביב-יפו`),
  `פתח-תקווה`, `קרית שמונה`, `קרית אריה`, `הרצלייה`.
- **Why it bites silently:** the gazetteer runs **only when `location` extracts empty**
  (`worker/lib/normalizer.ts:737-753`), so on any site where location is left unmapped the
  worker can auto-fill a spelling the product list lacks, fragmenting the city filter. No
  gate catches it — `verify-config`, `addsite-qa` and `verify-jobids` all ignore location
  *values*.
- **Fix:** treat `CSV files/city.csv` as the source of truth. After each scrape of an IL
  site, pull the distinct `location` values and assert each appears **verbatim** in
  `city.csv`; correct mismatches in `setupScript` via an alias map plus a comma-split that
  drops non-place qualifiers (`מטה החברה`, `משרדי`, `הנהלה`). Note that a
  wrong-but-non-empty location is never auto-corrected — neither the gazetteer nor
  `locationFallback` can repair it (LRN-LOC-1).
- **Generalizes to:** every Hebrew site. **Home:** Step 4 location /
  `recipes/setupscript-patterns.md` §6.

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

### LRN-COV-4 — WordPress REST API is the best "all jobs + descriptions" source; per-job detail navigation caps at ~40/run
- **Date / site:** 2026-06-22 · tcmcareer.com (`cmqo82ozg000v01qpkz7zncwp`) 240/240
- **Signal:** WP Job Manager site. `ul.job_listings` is **empty** in the served HTML
  (AJAX-hydrated) and only ~20 jobs show behind a "טען משרות נוספות" load-more button,
  so the analyzer's CRAWL_CLASSIFY latched onto garbage Elementor headings
  (`h5.elementor-heading-title`) and a prior run parked the site in REVIEW with
  "WP Job Manager AJAX-only — jobs need click-triggered AJAX; 250+ jobs exist".
  Descriptions live only on detail pages.
- **Two-part fix:**
  1. **Use the WP REST API, not the load-more button.** `GET /wp-json/wp/v2/types`
     to find the `rest_base` (here `job-listings`, not `job_listing`), then pull
     `?per_page=100&page=N&_fields=id,link,date,title,content,meta,<region-taxonomy>`.
     Each record yields externalJobId (`id`), detailUrl (`link`), publishDate (`date`,
     real ISO), title (`title.rendered`, entity-decode), description
     (`content.rendered` → `structuredText`; **double-decode** entities — `&bull;`),
     location (region taxonomy / `meta._job_location`), apply (`meta._application`).
     Build `li.job_listing` rows in `setupScript`, map listing-scope. ~4 calls, ~10 s.
  2. **THROUGHPUT cap:** the first attempt used a `pageFlow` (visit each detail page
     for the description) and scraped only **40 of 240** — per-job browser navigation
     costs ~15–20 s/page and the 15-min worker timeout cut it off (run still reported
     COMPLETED). Never use per-job navigation for 100+ job sites; fetch descriptions
     in bulk inside `setupScript` (REST `content.rendered`, JSON endpoint, or pooled
     `fetch()` of detail URLs) and inject `.__ai-description` as listing-scope.
- **Generalizes to:** every WordPress / WP Job Manager board, and any large site whose
  description is detail-page-only. **Home:** `recipes/pagination-and-loading.md` §0.

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

### LRN-SPA-4 — Embedded cross-origin ATS iframe ⇒ false SKIP; onboard the board URL
- **Date / site:** 2026-06-25 · bsel.co.il/he/careers/ → Comeet `betshemeshengines` (`cmqti7q4f000801no2o18183k`) 35/35
- **Signal:** a careers page is auto-SKIPPED (or triaged GRAY/RED) because its raw HTML
  carries **no job rows** — the listings live inside a **cross-origin `<iframe>`**
  (`comeet.com`, `greenhouse.io/embed`, `smartrecruiters.com`, `jobs.lever.co`,
  `ashbyhq.com`, `icims.com`, `myworkdayjobs.com`) that the worker can't read into.
  The wrapper page's `document.querySelectorAll('iframe')` exposes the real board URL.
- **Fix:** before logging RED/GRAY/SKIP, probe the wrapper for an ATS iframe `src`,
  **re-triage that board URL** (fingerprints GREEN), and onboard the **board URL** as the
  `siteUrl` (not the wrapper page). Set `companyName` to the real employer; annotate any
  existing wrapper-page record with an `adminNote` pointing at the board-URL site.
- **Automated (2026-06-25):** `addsite-batch.ts` `triage`/`fingerprint` now scan the
  wrapper HTML for a cross-origin ATS `<iframe>` (`findEmbeddedBoardUrl`) and emit an
  **`embeddedBoardUrl`** field + a `→ re-triage <url>` hint, forcing `lane: "GREEN"`.
  The agent just re-triages `embeddedBoardUrl` and onboards it — no manual iframe probe needed.
- **Generalizes to:** every ATS embedded via iframe on a company careers page. **Home:**
  `addsite2.md` §2.1 / `recipes/spa-frameworks.md#comeet`.

### LRN-SPA-5 — Comeet board specifics (selectors, varying URL separator, grouped department, form schema)
- **Date / site:** 2026-06-25 · betshemeshengines (Comeet/Spark Hire) 35/35
- **Signals & fixes (all verified):**
  - **Markup is `.positionItem` / `.positionLink` / `.positionsGroupTitle`, NOT
    `data-qa='position*'`** — the old `site-patterns.json` skeleton selectors matched
    nothing. `itemSelector: li:has(> a.positionItem)` (wrap the `<a>` so `detailUrl`
    resolves); `title: .positionLink`; `location: .positionDetails li` (first li, often
    the company name — gazetteer extracts the city).
  - **`externalJobId` = LAST path segment of the item `href`** (position UID `9C.354`).
    **The separator varies** (`/--/`, `/---/`, `/-----/`, `/None/`) because it's the
    slugified title — split on `/` and take the last segment; do NOT regex a fixed `/--/`
    (that fell back to the full URL for most items on the first pass).
  - **`department` = nearest preceding `.positionsGroupTitle`** — walk
    `.positionsGroupTitle, a.positionItem` in document order, carry the heading, inject
    per item.
  - **`description` = merge `[data-qa='requirementFieldContent']` blocks**
    (Description + Requirements) on the DETAIL page via a 2-step `pageFlow` +
    `structuredText` (setupscript §7–8).
  - **Static `formCapture` must use the full schema** (`name,label,fieldType,required,
    tagName`) — the recipe's old `{name,type}` shape is **rejected by
    `updateSiteConfigSchema`**. Apply form is a cross-origin iframe
    (`comeet.co/.../apply`); `formSelector` must match nothing → static fallback.
- **Generalizes to:** all Comeet/Spark Hire boards. **Home:** `recipes/spa-frameworks.md#comeet`
  + `scripts/site-patterns.json` comeet skeleton.

### LRN-SPA-6 — Wix repeater: a job's fields are sibling `comp-*__item-<suffix>` sharing one suffix
- **Date / site:** 2026-06-29 · campkimama.org (`cmqynnjle004901nz99j7vrhl`) 9/9
- **Signal:** a Wix **repeater** renders each job as a set of sibling components that
  all carry the **same `__item-<suffix>`** on different `comp-` prefixes — e.g.
  title `comp-m9sbzwuu5__item-<s>`, description `comp-m9sbzwuv__item-<s>`,
  **requirements `comp-m9zsa5ow__item-<s>`**, apply button `comp-m9sbzwuv6__item-<s>`,
  row container `comp-m9sbzwut__item-<s>`. The analyzer commonly maps only
  title+description and **silently misses requirements** (a whole separate comp).
- **Fix:** anchor the setupScript on one comp's items, derive the `<suffix>`
  (`id.replace('comp-<descPrefix>__item-','')`), then `getElementById('comp-<otherPrefix>__item-'+suffix)`
  to pull each remaining field (requirements, etc.). To find the prefixes, dump all
  ids matching `[id*="__item-<suffix>"]` for one job and read the tag/text. Distinct
  from the existing **Wix richText** recipe (setupscript §10), which is for free-form
  `richTextElement` blocks, not a repeater.
- **Generalizes to:** every Wix repeater jobs board. **Home:**
  `recipes/setupscript-patterns.md` §10 / `recipes/spa-frameworks.md#wix`.

### LRN-SPA-7 — Niloos / Hunter ATS minisite = Nuxt SPA + reCAPTCHA apply ⇒ link/email only
- **Date / site:** 2026-06-29 · imj.org.il (`cmqymqkbn004101nzck442rnv`); Niloos vacancies
  at `minisite.niloos.ai/vacancy/<id>` (alias `minisite.hunter-edge.me`)
- **Signal:** per-job apply links point at `minisite.niloos.ai/vacancy/<id>`. That page
  is a **Nuxt SPA** (static HTML has **zero** `<form>`/`<input>`; markers `__nuxt`,
  `_nuxt/entry.*.js`) backed by `jobsite-api.hunterhrms.com/api` (`/getVacancy`,
  `/jobs`, `/submit`) and it **loads Google reCAPTCHA**. The apply form only renders
  client-side and submission requires a reCAPTCHA token.
- **Fix:** do **not** try to capture the form fields (JS-rendered + captcha-gated =
  not auto-submittable; same class as LRN-APPLY-3). Keep the Niloos **apply link** as
  the per-job `applicationInfo` (formStatus URL), or fall back to the site's careers
  **email** where present. If the brief is email-apply-only, gate the setupScript to
  emit only `mailto:` jobs and drop the Niloos ones (see imj setupScript).
- **Generalizes to:** every Niloos/Hunter (`hunterhrms` / `hunter-edge`) minisite.
  **Home:** `recipes/spa-frameworks.md#niloos`.

---

## H. Worker behavior & config contract

### LRN-WRK-8 — Cloudflare "email protection" leaks `[email protected]` — worker now auto-decodes
- **Date / site:** 2026-06-23 · totali.com/en/Jobs/ (`cmqo82ous000t01qpt7duk823`)
- **Signal:** an email-apply site renders the apply address through Cloudflare's
  email-obfuscation widget — `<a class="__cf_email__" data-cfemail="HEX">[email protected]</a>`
  (the same `HEX` also rides a `/cdn-cgi/l/email-protection#HEX` href). Any field that
  reads that text (`description`, `applicationInfo`, the normalizer's
  `extractApplicationInfoFallback`) captured the literal placeholder
  **`[email protected]`** instead of the real address. The on-page text only resolves
  if Cloudflare's JS happens to run; under the scraper it frequently does not.
- **Root cause:** there was **zero** cf-email handling anywhere in the worker — text
  extraction took the placeholder verbatim.
- **Fix (worker-side, global):** `worker/lib/domFieldExtract.ts` now decodes every
  `[data-cfemail]` / `.__cf_email__` node **in the clone, before text extraction**:
  first hex byte is the XOR key, XOR each subsequent byte → the real address, then
  `node.replaceWith(decoded)`. Because every field flows through `domFieldExtract`,
  this fixes description AND applicationInfo (and the description→applicationInfo
  fallback) for **all** sites at once — no per-site setupScript needed anymore.
  No behavior change for non-Cloudflare sites (selector matches nothing).
- **Self-contained constraint:** the decode helper lives INSIDE `domFieldExtract`
  (the fn is `.toString()`-serialized into `page.evaluate`); keep it ref-free.
- **Pre-fix workaround (still valid, now redundant):** a `cfDecode()` inside the
  site's `setupScript` that reads `data-cfemail` and injects a clean field. totali's
  config still does this; harmless overlap with the worker decode.
- **Generalizes to:** any WordPress/Cloudflare jobs site that email-protects the
  apply address. **Home:** Step 5a email-apply / `domFieldExtract`.

### LRN-WRK-9 — Old ACTIVE config with empty `pageFlow` ⇒ descriptions silently never fetched
- **Date / site:** 2026-06-23 · totali.com/en/Jobs/ (`cmqo82ous000t01qpt7duk823`, re-onboard)
- **Signal:** an *already-ACTIVE* site (onboarded before detail-enrichment was wired
  up) returns 18 jobs with **empty description/location/applicationInfo**, even though
  a `description` selector is mapped. `_debugDescription` shows the selector matched
  nothing because it was applied to the **listing page only**.
- **Root cause:** the worker visits detail pages **only when `pageFlow.length >= 2`**
  (`classifyFieldsByPage` + the detail-collection loop in `scrape.ts`). The legacy
  config had `pageFlow: []`, so the description selector — which only resolves on the
  detail page — ran against the listing and produced "".
- **Fix:** give the site a real two-step flow and route fields with `capturedOnUrl`:
  `pageFlow:[{url:LISTING,action:"navigate"},{url:"<detail-glob>*",action:"<detail-link-selector>"}]`.
  Listing-scope fields (`title`, `detailUrl`, `externalJobId`) set
  `capturedOnUrl: <listingUrl>`; detail-scope fields (`description`, `location`,
  `applicationInfo`) set `capturedOnUrl: <a real detail URL>`. Fields with **no**
  `capturedOnUrl` default to detail-scope and break if their selector isn't on the
  listing — so `title` MUST be tagged listing-scope or it comes back empty on detail.
- **externalJobId from the title's trailing `(NNNNNN)`:** setupScript appends a
  per-item `.__ai-jobid` span on the listing (`title.match(/\((\d{3,})\)\s*$/)`),
  mapped listing-scope. Changing the id scheme is safe — every scrape does
  `prisma.job.deleteMany({siteId})` then re-creates (no orphans).
- **description without losing line breaks:** add a CLASS to the real job-body widget
  (`body.classList.add('__ai-jobbody')`) and map `description → .__ai-jobbody` so
  `domFieldExtract`'s block→`\n` logic runs on the real `<p>` tree. Do NOT inject a
  copy div with `textContent = innerText` (collapses newlines). Per LRN-SETUP-1,
  append the clean single-value spans (`.__ai-location`, `.__ai-applyinfo`) to
  `document.body`, NOT inside `.__ai-jobbody`, or they corrupt the description text.
- **Generalizes to:** any pre-enrichment ACTIVE site, or any new listing-only site
  whose description lives on detail pages. **Home:** Step 5b / pageFlow setup.

### LRN-WRK-13 — `loadMoreSelector` stops after one click when the theme hides the button mid-request
- **Date / site:** 2026-08-16 · l-w.ac.il/jobs/ (`cmsvmcyxs000m01lkm0qajne1`) shipped 9 of 60 jobs
- **Signal:** `_meta.loadMoreSelector` is set and the worker log shows it firing, but the
  listing never expands:
  ```
  [scrape] loadMore: button disabled/hidden after 1 clicks (count=9)
  [scrape] loadMore: 1 clicks done, final count=9
  ```
  The button works perfectly when clicked by hand, so the selector is not the problem.
- **Root cause:** `clickLoadMoreUntilStable` (`worker/jobs/scrape.ts`) re-reads the button
  at the **top of each iteration** and breaks on `offsetParent === null`. Many themes set
  the button to `display:none` for the duration of their AJAX round trip and restore it
  when the new rows land. Measured on l-w.ac.il (`POST /wp-admin/admin-ajax.php`,
  `action=get_jobs&paged=N`):
  ```
  t+150ms  display:inline-block  paged=1  items=9
  t+1s     display:none          paged=1  items=9    <- worker samples here, breaks
  t+2s     display:inline-block  paged=2  items=18   <- button is back
  ```
  The loop's `settleMs` wait only guards the **item count**, never the button's return, so
  a button that is slower to reappear than the rows are to render kills the loop after the
  first click. Silent: the run reports COMPLETED with a plausible job count.
- **Fix (site-level, no deploy):** drop `loadMoreSelector` and use a Strategy C
  `setupScript` click loop that waits for the button to become visible **again** before
  each click (`pagination-and-loading.md` §2). l-w.ac.il: 9 → 60 in ~24s, well inside the
  90s setupScript budget. Guard the whole loop behind `if (document.querySelector(BTN))`
  so it no-ops on detail pages instead of burning the wait budget 60 times.
- **Fix (worker-level, not yet applied):** in `clickLoadMoreUntilStable`, poll for the
  button to become visible again (up to `settleMs`) before treating hidden as terminal,
  and only break on hidden after the item count has also stopped growing.
- **Detection:** always run the §6.2 coverage gate against the number the *site* reports —
  a load-more listing that returns exactly one page-worth of items (9, 10, 20 …) is the
  signature. `verify-config` and `verify-jobids` both pass on the truncated set.
- **Generalizes to:** every append-style "load more" listing whose button hides itself
  while loading. **Home:** `recipes/pagination-and-loading.md` §2 Strategy A.

### LRN-WRK-12 — Single-page path runs `setupScript` BEFORE `autoScrollUntilStable` — enrichment scripts must self-scroll
- **Date / site:** 2026-07-01 · tnuva.co.il/jobs/ (`cmqyh9j7k002n01nzpb7145ri`) shipped 20 of 99 jobs
- **Signal:** an infinite-scroll listing has a **per-card enrichment `setupScript`**
  (injects `.__ai-*` spans, fetches detail pages) but the scrape only returns the
  first screenful of jobs (~20), even though the worker "supports infinite scroll".
- **Root cause:** in the **single-page path** (`extractRawFieldsFromListingPage`),
  the worker runs `setupScript` **first**, THEN its own `autoScrollUntilStable`, and
  only re-runs the script afterwards when `loadMoreSelector` is set:
  ```
  if (setupScript) runSetupScript(...)          // enriches only the ~20 visible cards
  await autoScrollUntilStable(...)              // loads the rest — too late, unenriched
  await clickLoadMoreUntilStable(...)
  if (setupScript && loadMoreSelector) runSetupScript(...)   // re-run gated on loadMoreSelector
  ```
  So the built-in autoScroll can't save an enrichment script: the extra cards it
  loads never get their `.__ai-*` spans. (Note the **multi-page/`pageFlow` path is
  the opposite** — it scrolls at ~L1373 *before* setupScript at ~L1379 — which is
  why this only bites single-page listing-only configs.)
- **Fix:** make the enrichment `setupScript` **scroll to the bottom itself, first**,
  before enriching — a `while (grew) { window.scrollTo(0, scrollHeight); await sleep }`
  loop with a no-growth break and item cap, then run the per-card enrichment over the
  now-complete DOM. (Tnuva: 20→99 jobs after adding the self-scroll preamble.)
- **Also caught here (secondary):** the analyzer had defaulted `externalJobId` to the
  URL slug (`tnuva-<decoded-slug>`); the real printed job number (`.jobIdNum` / "משרה
  מס' 198417") sat on the detail page we were **already fetching** — grab the canonical
  number in the same pass. And scope description to the content block
  (`.job-content section.free-content`), NOT the whole `.job-content`, which included the
  "משרות נוספות שאולי יעניינו אותך" related-jobs section.
- **Generalizes to:** every single-page, listing-only site that combines infinite
  scroll with an enrichment setupScript. **Home:** Step 4 setupScript rules /
  `recipes/pagination-and-loading.md` §3.

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

### LRN-WRK-10 — `deadline` field exists; there is NO worker "drop-expired" — do it in setupScript
- **Date / site:** 2026-06-29 · imj.org.il (`cmqymqkbn004101nzck442rnv`)
- **Signal:** some jobs print an application cutoff (e.g.
  `ניתן להגיש מועמדות עד לתאריך D.M.YYYY`). Two needs: (1) surface it, (2) stop
  scraping jobs whose cutoff already passed.
- **Field:** there is a **first-class `deadline`** field — DB column `Job.deadline`,
  normalizer key `deadline`, dashboard label "Application Deadline" (distinct from
  `publishDate`/`ageBucket`). Map it like any other field; parse the date in
  setupScript and inject `.__ai-deadline` as ISO `YYYY-MM-DD`.
- **Drop-expired has NO worker support:** `minPublishDate`/`minPublishDays` are inert
  and `ageBucket` only *labels* (LRN-WRK-5) — neither looks at `deadline`. So to drop
  past-deadline jobs, **do it in the setupScript**: parse the cutoff and `continue`
  (don't emit the item) when `deadlineISO < todayISO`. The next scrape's
  `deleteMany`+recreate removes the now-dropped jobs from the dashboard. A *global*
  drop-expired feature would be a worker change + deploy (not done).
- **Generalizes to:** any site printing an apply deadline. **Home:** Step 4 field
  table (`deadline`) / `recipes/setupscript-patterns.md`.

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

### LRN-API-3 — PATCH status with inline PowerShell JSON → misleading `500 INTERNAL_ERROR`
- **Date / site:** 2026-06-23 · forvismazars.com/il/en/join-us (`cmqo82p8c000z01qpdb1dolda`)
- **Signal:** `PATCH /api/sites/:id` with an **inline** body from PowerShell —
  `curl.exe ... -d '{"status":"SKIPPED"}'` or `--data-raw '{"status":"SKIPPED"}'` —
  returns `{"error":{"code":"INTERNAL_ERROR","message":"An unexpected error occurred"}}`
  for **every** target status (SKIPPED/ACTIVE/FAILED/ANALYZING), even though the
  transition is valid. Easy to misread as "the API blocks transitions from REVIEW."
- **Root cause:** PowerShell mangles the embedded double quotes in the inline arg, so
  the server receives malformed JSON; `await request.json()` throws a `SyntaxError`,
  which is **not** an `AppError`, so the route's generic catch returns a 500
  `INTERNAL_ERROR` instead of a 400. Confirmed via prod `web` logs:
  `Unexpected error: SyntaxError: Expected property name or '}' in JSON at position 1 at JSON.parse`.
- **Proof it's the body, not the transition:** the **same** site's `adminNote` PATCH
  succeeded because it was sent via a **file** (`-d "@patch.json"`); switching the
  status PATCH to a file (`'{"status":"SKIPPED"}' | Out-File -Encoding ascii s.json; curl.exe ... -d "@s.json"`)
  succeeded instantly. `VALID_STATUS_TRANSITIONS` already allows `REVIEW → SKIPPED`.
- **Fix (agent-side):** ALWAYS send PATCH/PUT/POST JSON bodies via a **file**
  (`-d "@file.json"`), never an inline single-quoted `-d`/`--data-raw` string, when
  curling from PowerShell. Write the file with the file tool or `Out-File -Encoding ascii`.
  The dashboard Skip button + `addsite-batch.ts` are unaffected (they send valid JSON).
- **Optional server hardening (not required):** wrap `request.json()` in the site/job
  PATCH routes to throw a `ValidationError` ("Invalid JSON body") so a bad body returns
  a clear 400 instead of a confusing 500.
- **Generalizes to:** every PATCH/PUT/POST in the pipeline issued via PowerShell curl.
  **Home:** Step 9 PUT / Step 12 verdict PATCH / Windows gotchas (§14).

---

## LRN-WP-1
- Date: 2026-06-28
- Site: labs-eco.com
- Signal: WordPress site with a `job` custom post type (clean listing at `/careers`,
  detail pages at `/job/<slug>`) was triaged as GRAY ("no obvious listing structure")
  because the site had only 3 jobs — the `topCluster` heuristic barely detects
  clusters that small, and WordPress was not recognized as a GREEN-lane vendor.
- Fix: Added `wordpress-job-cpt` vendor detection to both `fingerprint` and `triage`
  commands in `addsite-batch.ts`. Checks for WordPress markers (`wp-content`, `wp-json`,
  generator meta) combined with job CPT signals (`/job/` link hrefs, `single-job` /
  `job-template` / `type-job` body classes). When matched → GREEN lane.
- Generalises to: any WordPress site using a custom post type for jobs/careers/positions.
  Common pattern on Israeli company sites; the jobs are server-rendered HTML with
  semantic selectors — trivially scrapable.
- **Home:** Triage §2.2 in addsite2.md.

### LRN-WP-2 — WordPress REST returns the whole archive, not the open roles
- **Date / site:** 2026-08-03 · minrav.co.il/careers/ (`cmsbxxv9b000601p0hbhkk5r9`)
- **Signal:** `recipes/pagination-and-loading.md` calls the WP REST API "the **PREFERRED**
  path for ANY WordPress job board". Here `/wp-json/wp/v2/careers?per_page=100` returned
  **33** posts (`x-wp-total: 33`) while the careers page rendered — and itself declared —
  **11** ("11 משרות"). The extra 22 are closed/archived postings still stored as CPT
  entries, and **no REST field separates them**: all carry `status: "publish"` and an
  empty `acf: []`. Following the recipe would have shipped 22 dead jobs at fill=1.00,
  passing every gate.
- **Fix:** use WP REST as a **cross-check**, not the source of truth, unless a status /
  meta / taxonomy field provably marks open roles. Reconcile against the site's own
  declared count or the rendered DOM before picking a source. Here the DOM (11 items
  behind a load-more button) was authoritative.
- **Still useful for:** confirming coverage, and as an id source — REST exposes real post
  ids, which beat hash synthesis when the listing carries no native id (see LRN-ID-7).
- **Generalizes to:** any WP job board whose CPT retains closed postings — i.e. most of
  them. **Home:** `recipes/pagination-and-loading.md` §0.

---

### LRN-SPA-8 — Civi.co.il embedded jobs board: false AWSM scrape + listing-only content truncation
- **Date:** 2026-06-29
- **Site:** kfir-elevators.com / כפיר מעליות (`cmqylnf9t003q01nzjxamzlwj` → `cmqz4xfcn004o01nzebbuhdfj`)
- **Signal 1 — wrong data source:** The careers page at `kfir-elevators.com/משרות-פנויות-2/` was
  onboarded as the `siteUrl`. The page carries both (a) leftover WP Job Openings (AWSM plugin) demo
  posts and (b) a cross-origin `<iframe src="https://app.civi.co.il/promos/id=TWALK2UYXF&src=5920">`.
  The worker cannot read into a cross-origin iframe, so it fell back to the AWSM posts — 5 demo jobs
  whose content field contains **Hebrew lorem-ipsum placeholder text**. These passed the title/fill-rate
  gate (fill=1.00), but descriptions were gibberish, job IDs were WP post IDs (not the real
  `je-public-id`), and the apply form was a statically-captured AWSM page URL, not per-job.
- **Signal 2 — listing-only content truncation:** Even when the civi board URL is onboarded
  directly (as `siteUrl`), the listing page carries only short job previews (`.descr`). The full
  description (`#je-descr`) and requirements (`#je-details`) exist only on per-job detail pages at
  `https://app.civi.co.il/promo/id=<JOB_ID>&src=<SRC>`. With `pageFlow=[]` (listing-only), the
  worker never visits those pages, so descriptions come out empty.
- **Fix:**
  1. **Always onboard the civi board URL directly** (`app.civi.co.il/promos/id=<TOKEN>&src=<SRC>`),
     not the wrapper company page. The board URL is visible in the wrapper page's iframe `src`.
     Set `companyName` on the new site; SKIP the wrapper-page site with an adminNote.
  2. **In the setupScript, `await fetch()` each job's detail page** (same-origin — no CORS issue)
     and inject `#je-descr` text as `.__ai-description`, `#je-details` text as `.__ai-requirements`,
     and a per-job apply blob as `.__ai-applicationInfo`. This way `pageFlow=[]` (listing-only)
     still produces full descriptions and per-job apply.
  3. **externalJobId = the first arg of `openPromo(event, JOB_ID, SRC_ID)`** extracted from the
     `.thumb-content` `onclick` attribute. These are the public-facing job numbers (`je-public-id`),
     unique and stable.
  4. **Location = hardcode the company HQ** via `.__ai-location` injection in the setupScript.
     Civi boards carry no per-job location field; the company address in the site footer is the
     right default. Use `locationFallback` as a second option only if you want the gazetteer to
     fill when the injected span is absent.
- **Detail-page URL pattern:** `https://app.civi.co.il/promo/id=<JOB_ID>&src=<SRC_ID>`
  (constructable from the listing — no AJAX handshake needed).
- **Apply form:** The detail page carries a per-job HTML form (`form.Form`) with fields
  `Form_submitted` (hidden), `name`, `phone`, `email`, `cv` (file). The form `action` is the
  detail-page URL itself (`/promo/id=<JOB_ID>&src=<SRC>`). Static `formCapture` with
  `formSelector: "form.Form"` and an `actionUrl` placeholder is fine as a site-level fallback;
  the per-job `.__ai-applicationInfo` JSON blob (injected in the setupScript, mapped to the
  `applicationInfo` field) carries the exact per-job URL and is what the dashboard uses.
- **Generalizes to:** any company site that embeds a civi.co.il jobs board in an iframe.
  Also generalizes to any listing-only ATS board where full content lives only on detail pages —
  same-origin `await fetch()` enrichment in the setupScript avoids a full `pageFlow` round-trip.
- **Recipe:** `addsite2-recipes/spa-frameworks.md` `#civi`.

---

### LRN-WRK-11 — Apply-form UI text contaminates description when container is too wide
- **Date / sites:** unioncareer.co.il / לקס מוטורס (`cmqyizf3s003301nzvot8l7ut`), 2026-06-30
- **Signal:** description ends with garbage like `צירוף קובץ\nקובץ קו"ח\n\nx\n\nהגעתי דרך חבר\nהמידע האישי…`
  — the literal text content of the apply form's file-upload widget and checkbox, followed by the
  legal/privacy boilerplate and the "share on social" footer.
- **Root cause:** the setupScript fetched detail-page content using
  `.single-job-content-container`, which wraps **both** the job body (`.single-job-content`)
  and the apply sidebar (`.single-job-form-box`). Calling `.innerText` on the wrapper
  pulled the form widget labels directly into the description string.
- **Fix:** target the smallest element that contains **only the job prose**, not the
  surrounding layout wrapper. On this platform: `.single-job-content`. More general rule:
  when `innerText` of your chosen container includes words like `שלח`, `קורות חיים`,
  `קובץ`, `אימייל`, `הגשת מועמדות`, suspect you have the wrong element.
- **Detection:** `descHasForm` flag — check `/(שלח|קורות חיים|קובץ|הגשת מועמדות|צירוף)/.test(description)`.
  The `verify-jobids` script doesn't catch this; the QA `computeCorrectnessSuspects`
  "description present but avg N chars" heuristic may partially catch it.
- **Generalizes to:** any site where the job body and apply form share a parent container.
  Always grep the scraped description for known form-widget strings before shipping ACTIVE.

---

### LRN-SPA-9 — unioncareer.co.il: WordPress multi-company department portal
- **Date / site:** unioncareer.co.il / לקס מוטורס (`cmqyizf3s003301nzvot8l7ut`), 2026-06-30
- **Platform:** WordPress + custom `jobs` post type. Each group company has a dedicated
  department URL: `unioncareer.co.il/departments/<slug>/`. Job detail pages are at
  `unioncareer.co.il/jobs/<slug>/`.
- **Key selectors:**
  - Item: **`section.jobs-section ul.jobs-list li.jobs-item`** — must include the
    `section.jobs-section` ancestor scope. Bare `li.jobs-item` matches items from ALL
    company sections on the page and overcounts.
  - Job ID: `a.jobs-item-a[data-jobid]` — clean numeric string, e.g. `"3033"`. Use
    directly as `externalJobId`; no prefix needed (each department URL is its own site).
  - Title: `.job-item-title`
  - Department/category: `.job-prof-name`
  - Region (listing card): `.job-work-area` — gives a broad region (`מרכז`, `צפון`), NOT city.
- **Location:** the real city is in the detail page under a **`מיקום:`** paragraph
  (`<p><b><u>מיקום:</u></b><br>פתח תקווה</p>`) inside `.single-job-content`.
  Inject `.__ai-location` in the detail-fetch setupScript; do NOT map `.job-work-area`
  as `location` (it's too coarse to be useful).
- **Description container:** `.single-job-content` — NOT `.single-job-content-container`
  (that outer wrapper includes the apply sidebar; see `LRN-WRK-11`).
- **Apply form:** Contact Form 7 (`form.wpcf7-form`). Static `formCapture` fields:
  `full-name`, `the-phone`, `the-email`, `the-file` (file, required) **plus**
  `here-by-friend` (checkbox, "הגעתי דרך חבר") and `friend-name` (text, "נא לציין את שם החבר").
  Hidden: `job-number`, `post-url`. The CF7 form ID differs per department but the WP REST
  endpoint pattern is: `unioncareer.co.il/wp-json/contact-form-7/v1/contact-forms/<ID>/feedback`.
- **Company name:** must be PATCH-ed separately after site creation — the platform hostname
  is shared across all group companies so auto-detection gives the platform name, not the brand.
- **Generalizes to:** any WordPress site that uses a single domain for multiple employer
  brands and scopes each brand to a `/departments/<slug>/` page.

---

## Change log

- **2026-06-14** — Created the log; seeded with the incidents extracted from the
  `addsite` skill during the addsite2 audit (see `docs/addsite2-migration.md`).
  These entries remain inlined in `addsite` for now; the citation pass (replace
  narrative with `see LRN-…`) happens in addsite2 Phase 0/2.
- **2026-08-03** — Added `LRN-APPLY-10`, `LRN-ID-7`, `LRN-LOC-4`, `LRN-WP-2` from the
  minrav.co.il re-fix (a reCAPTCHA-v3 apply form was wrongly skipped as uncapturable;
  location normalized to the `CSV files/city.csv` spelling). Also corrected two pieces of
  guidance that would have caused a repeat: the §8 captcha gate in `addsite2.md` now
  classifies blocking-challenge vs invisible-v3 captchas instead of skipping both, and
  `recipes/form-capture.md` §4 no longer claims the worker serializes a `<form>` mapped
  to `applicationInfo` (it does not — `domFieldExtract.ts` returns plain text).
