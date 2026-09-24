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
- **CEILING — `bypassCSP` frees the request, never the cross-origin response body.**
  The case above is a subdomain the site owns, which serves CORS headers to its own
  front-end. Against a genuine **third party** the same `Failed to fetch` appears and
  `bypassCSP` does not help, because CORS is a different mechanism. Measured on
  pac.ac.il fetching `campaign.adamtotal.co.il` (2026-08-16):
  ```
  bypassCSP=false   cors: fail   no-cors: fail          -> CSP blocked the request
  bypassCSP=true    cors: fail   no-cors: opaque, 0     -> request out, body unreadable
  ```
  Diagnose in two minutes: run the fetch with `bypassCSP` false then true, and try
  `mode:"no-cors"`. An opaque/0 response while `cors` still fails means the ceiling —
  **stop designing around a fetch** and reach the data by navigation instead (a
  `pageFlow` detail step, with a setupScript on the target page extracting the value
  into a hidden element the mapping can select). That is what pac.ac.il ended up doing,
  and it is what forced the mailto-only card to be dropped (LRN-WRK-16).
- **Generalizes to:** any site whose data API is on a CSP-disallowed subdomain; the
  ceiling applies to every third-party ATS (AdamTotal, Comeet, TopMatch …).
  **Home:** Step 6 browserOverrides / WAF recipe.

### LRN-WAF-4 — ShieldSquare (Radware) hCaptcha wall reads as GRAY, not RED
- **Date / site:** 2026-09-17 · ayalon-ins.co.il (no site created)
- **Signal:** `triage` returned `lane: GRAY, reachable: true, topCluster 2`, which
  looks like a thin listing worth a manual look. It is actually a 302 on the first
  request to `validate.perfdrive.com/...` serving `<title>ShieldSquare Captcha</title>`
  with a blocking hCaptcha widget. This happens with a bare headless Playwright **and**
  with curl using a real desktop Chrome UA. Pages under `/career/*` and
  `/about-us/career/*` redirect, and so does the site's own JSON API
  (`/api/careers`); `robots.txt` does not. The redirect target returns 200, so a
  status-code reachability probe counts it as reachable.
- **A single 200 got through once.** One bare curl to `/api/careers` returned 200
  JSON, after this IP had already been challenged several times. Three immediate
  repeats of the same request were redirected, and so was a retry sending the
  cookies that response had set. Cause unknown.
- **Fix:** none within the worker's means. A UA override does not help, and nothing
  may solve an hCaptcha. **SKIP**, like a blocking Turnstile (`LRN-APPLY-1`). First
  search for the employer's own board on another host (§2.1). Aggregators such as
  Jobnet/Drushim are not the employer and don't count.
- **Diagnose:** `curl -sL -o NUL -w "%{url_effective}"` against the listing. If the
  final host is `validate.perfdrive.com`, or the title is `ShieldSquare Captcha`, it
  is this block. Don't spend a build attempt on it.
  - **One 200 is not access.** Repeat the request a few times before believing it.
    The worker needs every scheduled scrape to get through, not an occasional one.
    Don't guess at the cause, and don't change IPs or headers to chase it.
  - **The site's own API can be behind the same wall** (it was here). Finding the
    jobs request in the browser's Network tab is worth one check, but don't expect
    it to get around the block.
  - **"It works in my browser" does not mean the worker can get in.** A browser that
    has already passed the challenge gets its later requests allowed. The worker
    never passes it.
  - Probe just enough to confirm the block. More requests teach nothing and may
    make our traffic look worse to the blocker (advice, not verified).
- **Generalizes to:** any Radware/ShieldSquare-fronted site. The `reach`/`triage`
  probe should treat a cross-host redirect to a known challenge host as RED.
  **Home:** Step 3 reachability gate / `reach` script.
- **Worker-confirmed and SKIPPED (2026-09-23, re-onboarding attempt).** The original
  entry asserted "none within the worker's means" without testing from the container —
  the probe recipe did not exist yet. Now measured. Site created this time
  (`cmudy8r0p000801r0yqe11adn`, **SKIPPED**). Two read-only parity probes inside
  `haide-scrapper-worker-1`, both ending on the captcha, egressing from
  **194.88.110.149** (the `ssr=` param base64-decodes to the box IP) with
  `SCRAPE_PROXY_URL` **unset**:
  - default **HeadlessChrome** UA → HTTP 200, 17,781 B, `bodyTextLen 58`, 0 anchors;
  - `SCRAPE_USER_AGENT` = desktop **Chrome/131** → HTTP 200, 17,861 B, same body, 0 anchors.

  So `browserOverrides.userAgent` does **not** fix this one, and `LRN-WAF-5`'s
  "a local block is not a worker block" escape hatch **does not apply** — same shape as
  `LRN-WAF-6`. On the Chrome-131 run the Angular app partly booted (`/api/shared`,
  `/dictionary/he.json`, `/api/search/service-providers` all 200) **before** the
  challenge interdicted, which is the same "the origin API is behind the same wall"
  finding the entry already recorded for `/api/careers` — a couple of 200s mid-boot are
  not access.
- **The gate STILL does not catch this, six days on.** `triage` returned
  `lane: GRAY, reachable: true, topCluster 2` on 2026-09-23 — the exact miss this entry
  asked to fix. `scripts/lib/challenge-detect.ts` (shipped 2026-09-22, `LRN-WAF-6`)
  covers Reblaze and Incapsula only, and **every rule misses ShieldSquare**:
  `BLOCK_TEXT_RE` has no ShieldSquare phrase; rule 2 fires only for the two named
  bootstraps; the redirect lands on a standard **200**, so the nonstandard-status rule
  is silent; and the interstitial is **~17.8 KB**, far over `MIN_REAL_HTML_BYTES`
  (2000), so the size backstop never fires. `classifyResponse` therefore returns
  `challenged: false` on a pure captcha page.
  **Fix to make — and the obvious version of it is WRONG.** Measured against all 147
  ACTIVE sites (2026-09-23, raw-HTML fetch): 4 carry Radware/ShieldSquare markers, and
  **2 of those are healthy pages** — mizrahi-tefahot.co.il (192,710 B, has anchors,
  29 jobs) and careers.iec.co.il (700,222 B, has anchors, 28 jobs). So
  `__uzdbm_`, `stormcaster.js`, `SSJSConnectorObj` **and the literal string
  `validate.perfdrive.com`** all ship on working pages. Promoting any of them to
  `BLOCK_TEXT_RE` would RED four live sites serving 82 jobs — the exact
  `_Incapsula_Resource`/ono.ac.il trap this module is built around. They are
  **BOOTSTRAP class**: conclusive only when `looksLikeShell` (no anchors) also holds.
  That combination is measurably safe here — the two interstitials in the scan,
  fibi.co.il (118,374 B) and iaa.gov.il (15,049 B), both have **no anchors**, while both
  healthy pages do.
  The only safe *conclusive* markers are the titles, and there are **three variants**,
  not one: `ShieldSquare Captcha`, `Radware Captcha Page` (iaa.gov.il) and `Radware Page`
  (fibi.co.il). Zero false positives across the 147 — the healthy pages' titles are
  ordinary Hebrew job-page titles.
  **Size cannot help at all:** FIBI's interstitial is 118 KB, 59× `MIN_REAL_HTML_BYTES`.
  **And the genuinely conclusive signal is not available to the function:** what proves a
  block is being *redirected to* `validate.perfdrive.com`, but `classifyResponse(html,
  status?)` never receives the final URL — that needs a signature change or a
  caller-side check.
  **Caveat on the measurement:** the scan used raw `fetch`, while the gates pass rendered
  `page.content()`. Marker presence is solid either way (inline source scripts), but
  re-confirm the anchors signal on rendered DOM before leaning on it. The one rendered
  data point agrees: the worker probe saw `totalAnchors: 0` on the captcha page.
  **Do not read the scan as "iaa/fibi are broken":** both served *this dev IP* an
  interstitial while completing fine in production (10 and 15 jobs) — `LRN-WAF-5` again.
- **Cheap tell that worked:** `robots.txt` is served **unchallenged** (200) while
  `/career/*` 302s — same as `LRN-WAF-6`. It is permissive (`Allow: /`, no `/career/`
  disallow), so the blocker is **technical, not policy**. `sitemap.xml` also returns 200
  but serves the **Angular SPA shell, not XML**, so there are no detail URLs to harvest
  around the wall.

### LRN-WAF-5 — Incapsula that blocks the SPOOFED Chrome UA and the dev IP, not the worker
- **Date / site:** 2026-09-17 · tikshoov.co.il (`cmu5mleu7000c01p950bo7eqx`, ACTIVE, 101 jobs)
- **Signal:** `triage` said YELLOW (topCluster 101), then every local request —
  curl, bare Playwright, Playwright with a real Chrome UA — got a 914-byte 403
  `Request unsuccessful. Incapsula incident ID`. The dev IP was flagged after the
  first load. From inside the worker container the **default headless UA passed 3/3**
  and the **spoofed desktop-Chrome UA was 403'd** — the inverse of `LRN-WAF-2`,
  presumably because a Chrome-131 UA on a HeadlessChrome fingerprint is a mismatch.
- **Fix:** no `browserOverrides`. Run discovery and the setupScript dry-run from the
  worker container (`docker exec -i -e NODE_PATH=/app/node_modules -w /app
  haide-scrapper-worker-1 node /tmp/x.cjs`; `/app` is not writable, `/tmp` needs
  NODE_PATH). In-page `fetch()` of all 101 detail pages passed from there.
- **Traps:**
  - `triage`'s `CHALLENGE_RE` has no Incapsula markers, so a blocked page can still
    be called reachable. `reach` alone does not settle this site class.
  - `addsite-qa` probes ONE detail page from the local IP and compares every sampled
    location against its body. A blocked probe yields "location X (and N others) not
    found in detail page body" — REVIEW on correct data. Tell: X is the probed job's
    own location. Verify values against worker-fetched bodies instead.
  - `company-profile` runs locally too, so it reads the block page. It CAN run in the
    worker: tar `scripts src worker "CSV files/city.csv" package.json tsconfig.json
    .claude/scrap-token` (exclude node_modules) into `/tmp/cp`, symlink
    `/app/node_modules`, run `/app/node_modules/.bin/tsx scripts/company-profile.ts
    --site <id> --dry-run --out /tmp/cp/out.jsonl` with `SCRAP_BASE=http://web:3000`
    (the public host resolves to 127.0.1.1 inside the container). `rm -rf /tmp/cp`
    afterwards — it holds the token.
  - **Look at the logo before any real run.** Here the dry-run's "logo" was an inline
    `<svg>` rasterised to 530x1000: the **Facebook "f" icon**. The capture has no flag
    to pick another candidate, so the profile was written by hand —
    `POST /company-logo` with the footer PNG's bytes, then `PUT /company-profile` with
    the four text fields and no logo key. A tall, square-ish black glyph from
    `inline-svg` is a social icon until proven otherwise. Also note the header `<img>`
    was a 30th-anniversary variant; the footer mark was the real logo.
- **Generalizes to:** any Imperva site where local and worker results disagree. Test
  from the worker before SKIPPING, and before adding a UA override.
  **Home:** Step 3 reachability / §12 QA.

### LRN-WAF-6 — Reblaze answers with **HTTP 247**, and both reach gates call that a PASS
- **Date / site:** 2026-09-22 · career.rafael.co.il (`cmucbm75u000101rxp617f04a`, REVIEW)
- **Signal:** `triage` said GRAY `topCluster 0`, which reads like "no listing structure".
  It was not: every HTML path returns a **581-byte stub** — `window.rbzns` plus
  `/kramericaindustries.ac_v2.lib.js` (Reblaze `ac_v2`) — and `<body>` renders **empty**.
  The status code is **`247`**, not 403. That one detail defeats both gates:
  - `reach` printed `PASS bare (status=247)` — it only rejects 4xx/5xx.
  - `detail-reach` printed `OK: detail page reachable at worker parity` — `INCAPSULA_RE`
    has no Reblaze markers, so nothing matched.
  Neither gate has a **response-byte floor**, so a 581-byte stub is "reachable". A site
  can therefore clear Step 3 and Step 5 and still have never been seen.
  **PARTLY FIXED 2026-09-22 in `17dbfbb`** ("addsite gates: share one challenge/block
  detector across reach, detail-reach and triage"). This exact case is now caught: `247` is
  absent from `STANDARD_OK_STATUSES` and `scripts/lib/challenge-detect.ts:107-109` returns
  `nonstandard-status-247`, and the Reblaze bootstraps (`rbzns`, `winsocks(`,
  `.ac_v2.lib.js`) are matched at `:45` when the document also looks like a shell. Still
  open is the GENERAL version this bullet describes: neither gate has a byte floor of its
  own — they only print `bytes` — and the module's `MIN_REAL_HTML_BYTES = 2000` (`:59`)
  applies only when the page ALSO has no `<a`, so a padded interstitial still passes (see
  `LRN-WAF-4`: FIBI's ShieldSquare page is 118 KB). Verified at HEAD `e33bc85`, 2026-09-24.
- **Tell:** `parityBytes` / `uaBytes` in `detail-reach` output. ~600 bytes is a stub;
  a real listing is tens of KB. **Read the byte counts, not just the verdict line.**
  Corollary: `topCluster 0` on a reachable host means "look at the HTML", not "GRAY".
- **Fix:** none found. UA override is the prescribed first attempt (`waf-bypasses.md` §5)
  and it does **not** work here — parity 593 B vs real-Chrome-131 UA 581 B, both stubs.
  Routed to REVIEW, which is also where the analyzer landed on its own.
- **Ruled out — tested from the worker, same day.** A parity probe run inside
  `haide-scrapper-worker-1` (exact `launchBrowser`/`createPage` options, full mask,
  13 s settle) returned **HTTP 247, 581 bytes, `bodyTextLen 0`, `window.rbzns` still
  defined, 0 anchors** — byte-identical to the dev-IP result. Two things that looked
  like worker advantages turned out not to apply:
  - **`SCRAPE_PROXY_URL` is unset** in the deployed container, so the worker egresses
    from the box's own IP. There is no separate network path. `LRN-WAF-5`'s "a local
    block is not a worker block" escape hatch **does not apply** to this site.
  - The worker's **fuller fingerprint mask** (`webdriver` + `languages` + `plugins`,
    vs `detail-reach`'s `webdriver` alone) made **no difference**.
  So the block is automation **fingerprinting**, not IP flagging. Do not re-onboard
  with the current stack — it will reproduce exactly. Remaining options are a
  residential/mobile IL egress via `SCRAPE_PROXY_URL`, or a stealth/persistent-profile
  browser; neither is available to the worker as it stands.
- **Worth generalising from the probe itself:** the local gates are *not* worker parity.
  `detail-reach` masks only `navigator.webdriver` and cannot see `SCRAPE_PROXY_URL` or
  `SCRAPE_USER_AGENT`. When a WAF verdict actually matters, probe **inside the
  container** by piping a CJS script over stdin —
  `ssh <host> "docker exec -i -e NODE_PATH=/app/node_modules -w /app
  haide-scrapper-worker-1 node -" < probe.cjs` — which leaves **nothing on the box**
  (no `/tmp` file to clean up, unlike `LRN-WAF-5`'s recipe) and needs no token.
- **Worth knowing anyway:** `/robots.txt` is served **unchallenged** (200) while
  everything else is stubbed. It is the stock **SAP SuccessFactors** career-site file
  (`Disallow: /search/f/`, `/search/*/f/`), so a single 58-byte fetch identified the
  vendor through the WAF — and confirmed `/search/` itself is *permitted*, i.e. the
  blocker is technical, not policy. **On any WAF'd careers host, fetch `robots.txt`
  first**: it is usually allowlisted and it fingerprints the ATS for free.
- **Fixed (2026-09-22):** detection moved out of `addsite-batch.ts` into
  `scripts/lib/challenge-detect.ts`, shared by `reach`, `detail-reach` and `triage`, with
  `scripts/lib/challenge-detect.test.ts` covering it. All three now reject this site:
  `reach` exits 3 (`reblaze-bootstrap`), `triage` returns RED naming the WAF and the byte
  count instead of `GRAY topCluster 0`, `detail-reach` exits 3.
- **The trap that fix walked into — a WAF marker is NOT a block signal.** Folding
  `_Incapsula_Resource` into the shared classifier as a conclusive marker immediately REDed
  **www.ono.ac.il, an ACTIVE and perfectly healthy site**: Imperva fronts the whole domain,
  so its plumbing ships on *working* pages too (from the worker: HTTP 200, 314 KB, 501
  anchors, marker present). Markers therefore come in two tiers:
  - **block text** — phrases only a block page contains (`Request unsuccessful`,
    `Incapsula incident`, `Just a moment`). Conclusive at any size.
  - **bootstrap** — vendor plumbing (`rbzns`, `_Incapsula_Resource`) that also ships on
    healthy pages. Only counts when the document has **no anchors**, i.e. is really a shell.
  Size is *not* evidence of content either: a padded shell can exceed any byte threshold,
  so "has anchors" is the content test and the byte floor is only a last-resort backstop
  for an unrecognised WAF. Both of those were caught by deliberately breaking the rules and
  watching which assertions failed — the first draft of the test passed with the Incapsula
  rule deleted, because a 223-byte fixture was being caught by the size rule instead.
- **Generalizes to:** every Reblaze-fronted Israeli site (common in defence, finance and
  government), and to any WAF whose script tags appear site-wide. When adding a new vendor,
  decide which tier its marker belongs in before adding it — guessing "conclusive" costs a
  live site.
  **Home:** `scripts/lib/challenge-detect.ts`; `recipes/waf-bypasses.md` §5; Step 3 reachability.

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

### LRN-APPLY-11 — A Turnstile that guards submission, not the form, is an owner decision (precedent: ACTIVE)
- **Date / site:** 2026-09-17 · career.adamtotal.co.il, tenant `harel` (`cmu5o7j7b000i01p96jcemdht`).
  Same platform: railcareer.adamtotal.co.il (`cmovl9bxk000401m71q52najw`).
- **Signal:** every apply form on the detail page (`#ajax-cv-form`, the refer-a-friend
  form, the internal-candidate form) holds a `div.cf-turnstile[data-sitekey]` and a hidden
  `cf-turnstile-response` input, and the page loads `challenges.cloudflare.com/turnstile/v0/api.js`.
  But no interstitial comes first: clicking "לפרטים והגשת מועמדות" shows every field
  (`Fname*`, `Lname*`, `Phone*`, `Email`, `CvFile`). In headless Chromium the widget renders no
  iframe and the token stays empty (length 0).
- **Why the rules collided:** the §8 gate lists Turnstile as a *blocking challenge* → SKIP, and the
  success criteria call "apply behind Turnstile" a false ACTIVE. But LRN-APPLY-10 defines blocking as
  "the fields never render", and here they do. It is neither LRN-APPLY-3 (an interstitial before the
  form, which skip-classifies) nor v3 reCAPTCHA (whose score runs on its own).
- **Owner decision:** ship **ACTIVE**. The job data is complete, and a candidate using a real browser
  can apply. Capture the form statically, add the hidden `cf-turnstile-response` field (marked
  required) so the gate is visible in `_formData`, and put in `adminNote` that the submission is
  behind Cloudflare Turnstile, with the real endpoint. AdamTotal:
  `POST /Jobs/SubmitApplication` (multipart), with `OrderNo`=`data-job-id` and `Token`=the tenant
  token added by jQuery (neither is a form field).
- **Rail was not a precedent:** it went ACTIVE with an empty `adminNote`, from a dashboard-built
  config (all `MANUAL`, saved 2026-05-11) older than this skill and LRN-APPLY-3. Its stored
  `formSelector` (`#surveyElement1 … form`, GET) no longer exists on the live page, which now carries
  the same Turnstile form. Before citing an ACTIVE site as precedent, check its `adminNote` and
  its config dates.
- **Still SKIP** a Turnstile that shows *before* the fields (interstitial, "verify you are
  human", Ray ID), per LRN-APPLY-3.
- **Diagnose in one pass:** on the detail page, open the apply UI and read
  `form.offsetHeight`, the field list, and `input[name="cf-turnstile-response"].value.length`.
  Fields visible + widget inside the form = this learning. No fields until the challenge = LRN-APPLY-3.
- **Generalizes to:** every AdamTotal (`*.adamtotal.co.il`, "Powered by Mida") tenant, and any ATS
  that embeds Turnstile inside an already-rendered form. The worker has no Turnstile handling, so
  automated submission of these sites needs a browser-side token. **Home:** `addsite2.md` §8
  captcha gate / `recipes/form-capture.md` §0.

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

### LRN-ID-8 — `verify-jobids` cannot see a collision that already collapsed — test ids on the LIVE page
- **Date / site:** 2026-08-16 · samelet.com (`cmozl1to4000y01phtdi6xe7r`) shipped 7 of 8 jobs
- **Signal:** `verify-jobids` returns `fill 1.00, distinctRate 1.00` and the site looks
  healthy, but the listing shows more items than the database holds.
- **Root cause:** the gate reads **stored** jobs. When two postings share an id, the worker
  dedupes at write time, so by the time the gate runs there is exactly one row and the
  duplicate is invisible. `.cv_scope` (a printed requisition number) was reused across two
  unrelated openings — "מיישם/ת SAP MM" and "מנהל/ת שיווק למותגי סמלת" both carried `1213`.
  Stored distinctness is therefore **structurally incapable** of detecting this class.
- **Fix:** run `.scratch/id-stability.ts` (or any live extraction) BEFORE the rescrape and
  compare `distinct(ids)` against the **live item count**, not the saved count. Here:
  8 items, 8 ids, 7 distinct → collision. addsite2.md §6.2 already warns "a printed job
  number can be reused across distinct postings by the same recruiter — verify uniqueness",
  and §12 says "Exit 0 but saved jobs < DOM total means the id collides"; neither is
  automated, so both depend on the operator remembering.
- **Rule:** a printed requisition number is NOT automatically unique. Prefer the unique
  record id (CMS post id, detail-URL param). On samelet the permalink
  `?post_type=cvs&p=<id>` was 8/8 distinct and sitting on the same card.
- **Generalizes to:** every site keyed on a human-entered "job number" field.
  **Home:** Step 9 externalJobId gate.

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
  msh.co.il (`cmq6gxm6y001p01m9k3k3pwyv`) 2/6 gazetteer → constant תל אביב — **REVERTED
  2026-08-19, see LRN-LOC-9: the gazetteer resolves this site unaided and the constant was
  both stale and non-canonical; do not cite msh as precedent for blanket injection**;
  natali.co.il (`cmq7sn3au000601mfqhld00pa`) per-item region (2 field→המרכז, 9→רמת גן)
- **Signal:** no structured location field; the IL gazetteer only auto-fills
  `location` for jobs naming a token it recognizes → partial/inconsistent coverage.
- **Fix:** setupScript injects a hidden span per item (constant for single-office;
  computed `לאזור/באזור <region>` else HQ city otherwise). Always inject on every
  item — the gazetteer only runs when `location` is empty, so injecting bypasses it.
  Only blanket-inject when confident every posting shares the location.
- **Generalizes to:** single-HQ / region-in-prose employers. **Home:** Step 4 location / `recipes/setupscript-patterns.md`.

### LRN-LOC-5 — A multi-city posting must stay multi-city: emit a comma-separated list, not one city
- **Date / site:** 2026-08-17 · opl.co.il/דרושים (`cmsxh4kiv002801p8aju03od8`)
- **Signal:** two of eight postings name several places in the title
  (`נציג/ת שינוע – ת"א וירושלים`, `… ברחבי הארץ – כרמיאל, עפולה, גלילות וב"ש`).
  Both landed as `location: "Unknown"` — the fallback resolved neither, and the
  obvious "fix" (inject the first city) would have silently discarded the rest.
- **Fix:** `Job.locations String[]` is first-class and `Job.location` is just
  `locations[0]`, so the value to inject is the **whole list**:
  `normalizeLocations()` splits on `,|/;` and canonicalises each part
  independently (`ת"א`→`תל אביב-יפו`, `ב"ש`→`באר שבע`). A setupScript place-scanner
  over the title emits `'ת"א, ירושלים'` → `["תל אביב-יפו","ירושלים"]`. Scan
  longest-needle-first with Hebrew word boundaries, tolerating ONE leading particle
  (`ו/ב/ל/מ/ה/ש/כ`) so `בחיפה` and `וב"ש` match while `הגליל` can't match inside
  `גלילות`. **Inject only on a hit** — leaving the span absent on a miss keeps the
  gazetteer fallback alive (an always-injected span overrides it, LRN-LOC-1).
- **The standing condition (approved 2026-08-09):** a job may carry several
  locations ONLY if **every city is a verbatim entry in `CSV files/city.csv`**.
  Do not assume `isCanonicalLocation()` settles it: that tests `IL_CANONICAL`, a
  **separately maintained** list that merely *happens* to equal city.csv today
  (re-measured 2026-08-18: 1367 = 1367, zero divergence either way — the 29-entry
  gap in LRN-LOC-4 no longer reproduces). The rule still needs its own check,
  because the real leak is `normalizeLocations()`'s raw-string passthrough
  (`return out.length ? out : [original]`): an unresolved token comes back
  **verbatim** and lands in the DB — `הגליל` → `["הגליל"]`, a value in neither
  list. Validate against the CSV and gate it in code:
  `npx tsx scripts/verify-location-csv.ts --site-id <id>` (exit 2 = a stored value is
  absent from city.csv; checks `location` and every `locations[]` element).
  When the setupScript emits places itself, keep an `EMIT_AS` map so tokens outside
  the CSV resolve to the nearest entry inside it — on opl.co.il `הגליל` normalises to
  itself and is absent from city.csv, so it is emitted as `אזור הצפון`.
- **CORRECTION 2026-09-24 — the passthrough named above is gone; the leak is not.**
  `34e328b` (2026-09-17) removed `return out.length ? out : [original]`, so
  `normalizeLocations()` now returns `[]` for an unresolved value, and for `locations[]` the
  gate this bullet asks for is real. The leak moved up one level: the CALLER keeps the raw
  string as the primary value. It was `canonicalLocations[0] ?? rawLocation` in
  `buildJobRows`; `d2e9213` (2026-09-23) moved it into `worker/lib/jobLocation.ts:95,101,116`
  (`list[0] ?? override` / `?? extracted` / `?? fallback`). Measured at HEAD `e33bc85`:
  `resolveJobLocation({extracted:'New York'})` stores `location: "New York"` with
  `locations: []`. Nothing downstream rejects it — `buildJobRows` rows go straight to
  `createMany`, and `worker/lib/validator.ts` checks presence and a 150-char cap only, before
  normalisation. So `locations[]` is gated and `location` — the column the public site reads —
  is not. Found 2026-09-24 while checking what a worldwide careers board (Mobileye, 28 of 187
  postings outside Israel) would store for a non-Israeli posting.
- **Emitted value != stored value.** `LOCATION_ALIAS` holds 46 accepted *input*
  spellings, and **none of them is in city.csv** (`מרכז`, `ת"א`, `גוש דן`,
  `אזור המרכז`, `תל אביב`). They are legal to emit because `normalizeLocations()`
  maps them into canonical values first: OPL emits `אזור הצפון` and `כל הארץ`, which
  are stored as `אזור צפון` and `פריסה ארצית`. Assert the rule on what is **stored**,
  never on what the setupScript emits.
- **Generalizes to:** any employer with branch networks or "אזור X ו-Y" titles —
  common on IL retail/logistics/leasing careers pages. **Home:** Step 4 location.

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
- **The two lists are NOT the same** (measured 2026-08-03; **re-measured 2026-08-18: they are now IDENTICAL — 1367 entries each, zero divergence in either direction. The gap below has been closed. Treat the lists as independently maintained and re-measure rather than trusting either figure**):

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

### LRN-COV-5 — "Did we get every job?" is three checks, and only two can be automatic
- **Date / site:** 2026-08-16 · l-w.ac.il 9 of 60, samelet.com 7 of 8, pac.ac.il 6 of 7
- **Signal:** a run reports COMPLETED with a plausible count, every gate passes, and
  the number is still wrong.
- **Root cause:** every gate inspects what was **saved** — `verify-config` checks the
  selectors survived a PUT, `verify-jobids` reads stored rows, `addsite-qa` samples
  stored jobs. None opens the listing and counts. LRN-COV-1 mandates a coverage gate
  but only at onboarding, and ships no script.
- **The three tiers — different costs, different limits:**
  1. **items seen vs jobs saved** — new sites *and* rescrapes, fully automatic. The
     worker now emits `listing_vs_saved_gap` from `context.listingItemsSeen`. Catches
     the dedup collapse (samelet: 8 cards, 7 rows, because two shared requisition
     `1213`). MUST stay a warning: duplicate postings, deliberately-skipped dead
     detail pages, validator rejects, the `maxJobs` cap and mailto-only cards
     (LRN-WRK-16) are all legitimate causes.
  2. **this run vs the previous run** — rescrapes only, already implemented as
     `job_count_drop` (`COUNT_DROP_WARN_RATIO`). **Caveat:** the 0.3 threshold sits
     below observed healthy churn on this fleet (האקדמית רמת גן 26 → 13 = −50%,
     YES 17 → 11, אביבים 21 → 15), so it will be noisy once scrapes are scheduled.
  3. **the site's TRUE total vs what we saw** — new sites *and* rescrapes, and
     **impossible from inside a run**. The worker's notion of "live" is already the
     truncated set: on l-w.ac.il it saw 9 cards and saved 9 while the site had 60, so
     tiers 1 and 2 both read all-clear and there was no baseline to fall from. Needs
     ground truth the worker does not hold — the site's own printed count, a REST
     total, or a human. Partial automation: capture the total at onboarding, store it,
     and warn when a later scrape lands materially below it.
- **Detection:** a saved count equal to exactly one page worth of items (9, 10, 20) is
  the signature of truncation.
- **Generalizes to:** every site, every scrape. **Home:** Step 4 coverage gate.

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

### LRN-WRK-14 — A filled `publishDate` can still be 100% useless — assert on `ageBucket`, not on fill
- **Date / site:** 2026-08-16 · l-w.ac.il (`cmsvmcyxs000m01lkm0qajne1`), 12 of 60 filled, 0 of 60 usable
- **Signal:** QA reports `fillRates.publishDate: 0.4`, which reads as a coverage gap —
  "most jobs just don't print a date". The real defect is worse and invisible: **every
  filled value was unparseable**, so `ageBucket` was null on 100% of jobs and the
  dashboard's age badges / age filter were dead for the whole site.
- **Root cause:** the mapping pointed at the visible line, which renders as
  `"פורסם ב-06.08.2026"`. `parsePublishDateToUtc` (`worker/lib/normalizer.ts`) accepts
  `YYYY-MM-DD`, a bare `D.M.YYYY`, or `Mon D, YYYY` — anchored with `^`, so any prefix
  (a Hebrew label, "Posted:", "Published on") fails both branches and returns null.
  Nothing downstream complains; the column is just quietly non-functional.
- **Fix:** take the machine-readable value. Yoast JSON-LD `datePublished` was present on
  100% of detail pages. `domFieldExtract` returns `""` for `<script>` nodes, so it cannot
  be selector-mapped — surface it via setupScript as a hidden span holding `YYYY-MM-DD`.
  Result: 60/60 parse, revealing 17 postings over 90 days old and 4 over a year that had
  all been showing as undated.
- **Invariant worth gating:** `publishDate` non-empty AND `ageBucket` null is **always** a
  bug — there is no legitimate case. A fleet sweep on this invariant also surfaces stale
  rows scraped before age-buckets existed (ageBucket is computed at scrape time only, so
  it does not backfill).
- **Generalizes to:** any field whose value feeds a parser — validate through the
  **consumer**, not for non-emptiness. **Home:** Step 7 age-bucket flagging.

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

### LRN-WRK-15 — Stale rows mask a broken live config; under cron the risk becomes PARTIAL extraction
- **Date / site:** 2026-08-16 · natali.co.il, biopharmax.co.il, msh.co.il
- **Signal:** a site looks healthy in every audit — jobs present, descriptions
  populated, ACTIVE — while its config matches little or nothing live. Measured:
  all three ACTIVE / COMPLETED / **no failure category**, serving rows last written
  2026-06-09 (natali 11 jobs with every selector matching 0, biopharmax 5 with the
  domain moved, msh 6 behind a WAF).
- **Root cause:** job rows persist until a scrape replaces them, so a config can rot
  for weeks while the database serves the last good harvest. The worker *does* record
  `failureCategory = structure_changed / empty_results`, but only when a scrape
  actually runs — and these had not been rescraped since June, precisely because they
  were correctly flagged "do not rescrape until re-captured". The signal is therefore
  **lagging**: it appears only after the risk has been taken. `addsite-fleet-audit.ts`
  cannot close the gap either; its own header says it judges sites "WITHOUT a per-site
  browser probe".
- **Detection — depends on scheduling:**
  - **On a cron:** cheap and reliable. Every site is rescraped each cycle, so
    `failureCategory` fires on its own; query the latest ScrapeRun per site.
  - **Not on a cron:** `failureCategory` is stale. Use `Site.lastScrapedAt` vs
    `max(Job.createdAt)` — rows weeks old with no new write is the signature; all three
    sites above are visible by that alone. Confirm with a live probe: zero
    `itemSelector` matches on an HTTP 200 means drift, not an empty listing.
- **What survives a cron — partial extraction:** total failure is already guarded
  (`recordsToPersist.length === 0` returns **before** the `deleteMany`, so stored jobs
  are preserved and the run is tagged `structure_changed`). Partial extraction has no
  such guard: a drifted config matching 3 of 11 items deletes the other 8 — COMPLETED
  run, no failure category, no warning. Alarm on a large non-zero drop (LRN-COV-5
  tier 2), paired with a cause signal since real churn reaches 50%.
- **Generalizes to:** every ACTIVE site between rescrapes. **Home:** fleet audit.

### LRN-WRK-16 — Navigate Mode silently drops any card without an http href
- **Date / site:** 2026-08-16 · pac.ac.il — 7 cards on the listing, 6 jobs saved
- **Signal:** a site with a `pageFlow` detail step returns fewer jobs than the listing
  shows, with no error and no warning.
- **Root cause:** in `extractRawFieldsWithPageFlow` the URL-collection loop is guarded
  by `if (href)` with no else branch, and the multi-page path builds its output solely
  from visited detail URLs. A card whose apply target is a `mailto:`, `tel:` or a JS
  handler contributes no URL and therefore never becomes a row. (Note `skipped_no_url`
  in `countDeadDetailPages` does NOT cover this — it only fires for an empty entry
  *inside* the collected URL array, and these cards never enter it.) On a site with
  **mixed** apply paths only the non-http subset is lost, which is the kind of partial
  loss nobody notices.
- **Detection:** count apply targets that are `http` vs otherwise; the difference is
  exactly the loss. Also visible as `listing_vs_saved_gap` (LRN-COV-5 tier 1).
- **Fix:** it is a deliberate design — the same guard stops dead links burning the
  scrape budget — so this is a decision, not a bug. Either accept the loss (chosen for
  pac.ac.il, to reach the requisition numbers on the apply page), stay listing-only and
  key the id off a stable card attribute, or synthesise a navigable URL for the odd
  cards. **Whichever you choose, record it in `Site.adminNote`** — the job otherwise
  vanishes with nothing to explain it later.
- **Generalizes to:** every pageFlow site with mixed apply paths. **Home:** Step 4
  detailUrl row.

### LRN-WRK-18 — `setupScript` is NOT re-run after a pagination navigation, so listing-scoped injections exist on page 1 only
- **Date / site:** 2026-08-17 · unitask-inc.com (`cmsxdjtz1001m01p8dpwsxup8`, 31 jobs over 4 `?paged=` pages)
- **Signal:** a listing-scoped field backed by a `setupScript`-injected `data-*` span
  fills correctly for exactly the first page's worth of items and falls back for the
  rest. Unitask: `externalJobId` came back 8 real ids + 23 synthesised `h-<hash>`
  (LRN-WRK-17), i.e. 8/31 — and every gate still passed, because `verify-jobids` sees
  fill 1.00 / 31 distinct once the hash fallback has papered over the gap.
- **Root cause:** in `worker/jobs/scrape.ts` the multi-page path runs the script once at
  **line 1402**, before the per-listing-page loop that starts at **1491**; the only
  re-run is guarded by `loadMoreSelector` (1415). `goToNextListingPage` replaces the DOM
  for `?paged=2..N` and nothing re-injects, so pages 2+ are extracted from a listing the
  script never touched. Detail pages are unaffected — the script *is* re-run per detail
  page at **1719-1725**, which is why sibling detail-scoped fields (location,
  requirements) read 31/31 in the same run.
- **Fix (no worker change):** move the field to **detail** scope — set its
  `capturedOnUrl` to a detail URL so `classifyFieldsByPage` routes it to the detail pass,
  and source the value from something the detail page carries (Unitask: the
  `postid-<n>` body class / the printed `מספר משרה` heading rather than the card's
  `post-<id>` class). Re-scrape → 31/31 real ids, 0 synthesised.
- **Second fix, for a server-rendered listing that already carries the full job** (2026-09-17,
  career.adamtotal.co.il `harel`): drop `_meta.pagination` and let the setupScript `fetch()` the
  same-origin `?page=2..N`, `DOMParser` the HTML, and append the new cards (dedup on the card id)
  to page 1 before it enriches. This avoids a detail fetch per job. The first scrape with
  `pagination.type: "url"` stored 25 of 83 with injected fields (`synthesised_external_job_id: 58/83`,
  `unknown_location_rate: 58/83`); after the fix 83/83. Not possible across origins (LRN-WAF-3).
- **Trap:** the synthesised-id fallback makes this look healthy. `fill=1.00,
  distinct=31` is not evidence the mapping worked — **count the id PREFIXES**
  (`h-` vs your own) before believing an id gate on any paginated site.
- **Generalizes to:** every site combining `pagination` (url or click) with a
  listing-scoped `setupScript` injection — the fleet's `?paged=`/`?page=` WordPress and
  Drupal boards especially. Prefer detail scope for injected fields whenever pagination
  is configured, or re-derive them from the card markup with a plain selector.
  **Home:** Step 4 externalJobId row; addsite2.md §6.3 setupScript rules.

---

### LRN-WRK-17 — The externalJobId hash fallback existed only on paper; the worker now applies it
- **Date / site:** 2026-08-16 · חיותא, קבוצת אמנת- Sysnet, גולדברג פרושן (0% fill each)
- **Signal:** an ACTIVE site stores `externalJobId` NULL on every row. It scrapes
  perfectly well — until the next rescrape demotes it to REVIEW.
- **Root cause:** the rule was documented and unimplemented. addsite2.md §6.2 lists a
  hash as the tier-3 id source and LRN-ID-1 / LRN-ID-2 describe the `h-<hash>`
  convention, but every one of those instructs a human writing a per-site
  `setupScript`. The worker persisted `normalized.externalJobId || null` and had no
  fallback, so skipping the rule at onboarding left NULLs that nothing caught —
  scraping still works because dedup falls back to `jobKey = externalJobId || url`.
  Only `decideActivationStatus` notices, and only later.
- **Fix:** `worker/lib/synthesizeJobId.ts`, consulted **only** when extraction produced
  nothing for a job. Hashes title + department + detail URL and pointedly **not**
  location (re-canonicalised every run — LRN-ID-7 records ids churning for exactly that
  reason); index-free so a reordered listing yields identical ids; `h-` prefix marks it
  synthetic and keeps `verify-jobids` from reading an all-integer set as index-based;
  returns null rather than invent an unstable key when nothing stable exists. `jobKey`
  deliberately stays on the **extracted** id so manual location overrides written
  before this existed still resolve.
- **Surfaced, not silent:** `synthesised_external_job_id` (informational) and
  `synthesised_id_collision` — the latter is the LRN-ID-8 job-loss class and needs a
  human.
- **Verified:** dry-run over the three sites' real rows — 10/10 ids, all distinct, zero
  collisions, each moving 0% → 100% fill and clearing the ≥0.9 gate.
- **Generalizes to:** every site onboarded without the id rule. **Home:** Step 4
  externalJobId row.

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

### LRN-WP-3 — Elementor Loop Grid: every job AND its apply form live on the listing page, inside collapsed `<details>`
- **Date / site:** 2026-08-20 · flying-cargo.com/careers/ (`cmt08f7va002f01kfcxpyuhhh`, 38 jobs)
- **Signal:** WordPress + Elementor archive (`body.post-type-archive-<cpt>`, items
  `div.elementor.elementor-<tplid>.e-loop-item`). Each card is a `details.e-n-accordion-item`
  holding the full job body **and its own complete `form.elementor-form`** with a CV
  `input[type=file]`. Three traps in one page:
  1. **Collapsed accordions read as empty.** The body is in the DOM but the `<details>` is
     closed, so `innerText` returns `""` (`textContent` still works). A probe that measures
     fill with `innerText` reports `description=0` and looks like a detail-page-only site.
  2. **The apply form is on the LISTING page**, contradicting `form-capture.md` §1 ("almost
     always lives on the per-job detail page"). `querySelectorAll('form')` returns one
     structurally identical form per job.
  3. **No detail links in the cards** — the only `<a>` is the privacy policy, because the
     accordion *is* the detail view. There is no natural `detailUrl`.
- **Fix:** stay listing-only (`pageFlow: []`) and do it all in `setupScript`:
  `document.querySelectorAll('details').forEach(d => d.setAttribute('open',''))`, then read
  the WP post id off the card's own class (`/(?:^|\s)post-(\d+)/`) and use the open
  `wp-json/wp/v2/<cpt>?per_page=100&_fields=id,link,date` as a sidecar for detailUrl +
  publishDate. `X-WP-Total` gives the coverage ground truth (38 = 38 rendered cards) — a
  cross-check, not the source of truth (LRN-WP-2).
- **id choice:** the form's hidden `form_fields[job_number]` *looks* like the id but is
  **blank on 3 of 38** cards; the `post-<id>` class is 38/38 distinct. On any WordPress
  board prefer the WP post id over a printed/hidden "job number" (`LRN-ID-5`).
- **Per-job apply data on a listing-only site.** `form_fields[job_number]` is the only
  per-job value in the submit and the thing that routes an application to the right role,
  but a site-level `_meta.formCapture` cannot carry it — and on a listing-only site the
  worker **unconditionally overwrites** `raw["_formData"]` with the site-wide blob for
  every record (`scrape.ts:3238-3249`, no "already set" guard, unlike the pageFlow branch
  at `:3014-3018`). So per-job data must ride on **`applicationInfo`**, which wins over
  `_formData` in `normalizer.ts:751-759` and is written independently — keeping the
  site-level panel intact. Mapping an arbitrary key (`jobNumber`) also works: field names
  are **not** whitelisted (`scrape.ts:334-369`), unknown keys survive into `rawData`
  (`normalizer.ts:726`, `scrape.ts:3453`) and render under "Additional Fields".
- **Verify the submit contract by intercepting and ABORTING it**, never by sending one:
  `page.route('**/admin-ajax.php', r => { capture(r.request().postData()); r.abort(); })`.
  That is what proved `post_id`/`form_id` are constant across all 38 (they identify the
  Elementor template/widget, not the job) — an assumption that reads plausibly and is wrong.
- **Their form can be broken in a way that no gate sees.** Here `form_fields[name]` is used
  by BOTH the full-name input and the region select, and `form_fields[email]` by BOTH email
  and phone (Elementor field IDs left at default). Each key posts twice, PHP keeps the last,
  so the employer receives region-as-name and phone-as-email — for human applicants too.
  Capture it verbatim with disambiguated labels and record it; do not silently "fix" it.
- **Splitting the body:** the description/requirements split here needs the `LRN-SETUP-10`
  line-based state machine, **not** a tail-split — 2 of 38 ads put benefits/hours
  ("שעות עבודה 08:00-17:00", "תנאים מעולים") *after* the דרישות list, and "everything after
  the heading" files those as requirements. Note `תנאים` is description-class while
  `תנאי סף` is requirements-class.
- **Run `verify-location-csv` — it is not in the addsite2 gate matrix.** This onboard
  shipped `צריפין` on 10 jobs; it is in neither `CSV files/city.csv` nor the worker
  gazetteer, and nothing auto-repairs it (the gazetteer and `locationFallback` only fill an
  EMPTY location). `verify-config`/`addsite-qa`/`verify-jobids` all pass regardless, because
  none of them look at location *values*.
- **Generalizes to:** any Elementor Loop Grid / accordion jobs archive (a common Israeli
  WordPress build), and more broadly to **any** board whose prose sits in `<details>`, tabs,
  or `hidden` containers — measure fill with `textContent`, or force the container open,
  before concluding a field is missing.
- **Home:** `recipes/setupscript-patterns.md`, `recipes/form-capture.md` §7, addsite2.md §2.2.

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

### LRN-API-4 — The config mirror rots quietly, and its own tooling encourages that
- **Date / site:** 2026-08-16 · a routine full export changed 142 files; only **7** were
  real drift, **129** differed solely by the `_exportedAt` stamp
- **Signal:** among those 7 were **three setupScripts that existed nowhere but the
  production database** (electra, landing-iac, pac).
- **Root cause — two compounding tooling faults:**
  1. `scripts/export-site-configs.ts` rewrites `_exportedAt` on every file whether or
     not anything else changed, so any run looks like a 140-file diff. That noise is
     why the export is run rarely — and rare runs are why mirrors go stale.
  2. The same script with `--site <id>` regenerates `INDEX.md` from **only that site**,
     deleting the other 136 rows. Committed without reading the diff, it silently
     destroys the index.
- **A stale mirror is worse than none:** `main` held a kahane setupScript predating the
  2026-08-13 rewrite, still doing `textContent.replace(/\s+/g, ' ')`. Restoring from it
  would have reinstated the flattened descriptions the blob campaign was removing. A
  missing backup fails loudly; a stale one fails quietly and looks like success.
- **Detection:** run the **full** export (never `--site`) and diff; ignore
  `_exportedAt`-only changes, everything else is unmirrored drift. Also flag any site
  whose live config has a `setupScript` with no matching `.setup.js`.
- **Fix:** write `_exportedAt` only when something else changed; make `--site` merge its
  INDEX row rather than regenerate the file; run the full export after any config
  change rather than as an occasional chore.
- **Generalizes to:** the whole mirror. **Home:** `sites/_configs/INDEX.md`.

### LRN-SPA-10 — Comeet: the group heading is not always the department, and the data-qa blocks carry the apply iframe

- **Date / site:** 2026-08-17, נטפים (`comeet.com/jobs/netafim/B7.002`), rebuilt from scratch.
- **Signal:** three separate mismatches against the shared Comeet recipe
  (`addsite2-recipes/spa-frameworks.md#comeet`), all on a board the recipe otherwise fits.

1. **`.positionsGroupTitle` was the LOCATION, not the department.** The recipe injects it
   as `department` ("MRO", "אגף ייצור"). On this board the headings are places —
   `Hatzerim, Israel`, `Magal, Israel`, `Yiftah, Israel`, `Colombia`, `India Pune`,
   `Yinchuan, China`. Department/employment type live in `.positionDetails li` 1 and 2
   instead. **Read the actual headings before mapping them** — the grouping dimension is
   a per-tenant Comeet setting, not a platform constant.
2. **`[data-qa="positionDescription"]` / `positionRequirements` are two-column
   `.row.noPaddingTop.careerCard` wrappers.** Column 1 (`.positionInfo`) is the prose;
   column 2 holds the cross-origin apply iframe. Running `structuredText` on the wrapper
   swept in the CTA text ("Apply for this job") and a stray literal `</div>`. Scope to
   `el.querySelector('.positionInfo') || el`.
3. **Both blocks stack TWO label lines** — the block heading (`Requirements`) plus the
   employer's own sub-label (`דרישות התפקיד:`). A one-shot label strip removes only the
   first; strip in a loop.

- **Also:** a global employer's board is not an Israeli jobs board. Netafim's board had 44
  positions, only 25 in Israel (the rest Colombia/Ecuador/Mexico/Guatemala/India/China/
  Netherlands/EMEA, several Spanish-language). The previous config "solved" this with a
  `?location=Yiftah,%20Israel` URL filter, which cut it to **5 of 44** — losing 20 Israeli
  jobs at the other four sites. Prefer scraping the full board and dropping non-Israeli
  items in the setupScript over a URL filter that silently narrows coverage.
- **Also:** the coarse group heading disagreed with the per-job
  `[data-qa="headerLocation"]` — group `Tel Aviv, Israel` resolves to `גבעתיים`. Take
  location from the detail header, not the heading.
- **Generalizes to:** every Comeet tenant, and to any ATS whose listing groups rows under
  a heading whose meaning is tenant-configurable.

### LRN-SETUP-5 — JS `\b` is ASCII-only, so Hebrew label-stripping regexes silently no-op

- **Date / site:** 2026-08-17, נטפים.
- **Signal:** `/^(...|דרישות)\b/` never matched `"דרישות התפקיד:"`. Hebrew letters are not
  `\w` in a non-`u` JavaScript regex, so `\b` finds no boundary between `ת` and a space —
  the strip silently did nothing and the redundant label shipped inside `requirements`.
- **Fix:** drop `\b` and gate on shape instead (short first line + known keyword prefix,
  optionally a trailing colon), or use `\p{L}` with the `u` flag. Prefer line-based
  parsing over one big regex: it is also immune to the non-U+0020 spaces these boards emit.
- **Generalizes to:** every Hebrew-content setupScript that strips labels or splits
  sections — the same trap hits `\bדרישות\b`-style section splitters.

### LRN-API-5 — `export-site-configs.ts` deletes hand-written prose from INDEX.md

- **Date:** 2026-08-17, found while mirroring נטפים.
- **Signal:** the full export dropped the "**Keeping the mirror honest**" paragraph — the
  very warning `LRN-API-4` added. `INDEX.md` is rebuilt wholesale from a template literal
  in the script, so anything hand-added to the generated file disappears on the next run.
- **Fix:** the paragraph now lives in the script's template, not just in the output. Any
  further guidance for that file belongs in `scripts/export-site-configs.ts`, never in
  `INDEX.md` itself.
- **Note:** older INDEX rows recorded setupScript **file bytes** while the script writes
  JS **string length**; on Hebrew-bearing scripts these differ (ykm 4445 vs 4431). A
  one-time shrink in that column across many rows is that artifact, not config drift.
- **Generalizes to:** every generated-file-with-docs in the repo.

### LRN-ID-9 — An anchor `href` can be a *per-page-load* id: check stability across loads, not just across items

- **Date:** 2026-08-17, found rebuilding ern.co.il (מנורה ERN).
- **Signal:** the careers page is a Bootstrap accordion whose every panel links to
  `#collapse-<md5>-<index>`. That reads like a native per-item identifier, so the
  original config mapped `externalJobId` to the `.panel-title` `href`. It is actually
  **two** defects stacked: the suffix is index-based, and the md5 is **regenerated on
  every page load** — four fresh loads produced four different hashes
  (`8bda9230…` in the June DB, then `5ef12a84…`, `864be3f0…`, `d44bad11…`).
  `jobKey = externalJobId ?? detailUrl`, so every scrape re-keyed all 8 jobs and
  orphaned the previous 8.
- **Why every gate stayed green:** `verify-jobids` scores fill and distinctness *within
  one scrape*, and per-load-random ids are perfectly filled and perfectly distinct. Both
  properties it measures were satisfied by the very thing that made the ids useless.
  Nothing in the pipeline compares ids **between** scrapes.
- **Fix:** load the listing 2–3 times in **independent browser contexts** and diff the
  extracted id vectors before trusting any id. If they differ, the id is per-render —
  fall back to `'<prefix>-' + haideHash(title)` (recipe §3). ERN ships `ern-<hash>`;
  two consecutive production scrapes now yield identical ids and the table stays at
  8 rows instead of growing by 8 each run.
- **Generalizes to:** any accordion / tab / modal / `aria-controls` target, and any
  framework that mints DOM ids at render time (Bootstrap collapse, Elementor toggles,
  Wix `comp-*` suffixes). Treat a fragment href as decoration, not identity — the
  rehearsal in `.scratch/ern/rehearse.ts` is the reusable shape for this check.

### LRN-LOC-6 — `locations[]` was invisible in the dashboard, and editing a row silently deleted the extras
- **Date / site:** 2026-08-17 · opl.co.il (`cmsxh4kiv002801p8aju03od8`), job `opl-xeolkp`
- **Signal:** a correctly-stored two-city job (`locations: ["תל אביב-יפו","ירושלים"]`)
  read as "the second city was ignored" — because `JobsTable` rendered only
  `job.location`, which is by definition just `locations[0]`. The data was right;
  the consumer was lossy.
- **The worse half:** the cell is click-to-edit, and it seeded its draft from
  `location` too. Opening and saving a multi-city row therefore posted a single
  city, and `updateJobLocation` rewrote `locations` from that one value — a silent
  destructive edit of data the scraper got right.
- **Fix:** render and edit `locations.join(", ")`, falling back to `location` when
  the array is empty; the override endpoint already splits a comma list back into
  `locations[]`, so the round-trip is lossless. Also added `locations` to the
  mutation's return `select` so the refetched row carries the full list.
- **Generalizes to:** every array-backed field with a scalar "primary" mirror
  (`location`/`locations` today). When a field has both shapes, check what the UI
  binds to before concluding the extractor dropped something — and check whether
  an inline editor writes the scalar back over the array.

### LRN-SETUP-6 — Drop the "position not on the list, send us your CV" row: it is a mailbox, not a vacancy
- **Date / site:** 2026-08-17 · opl.co.il/דרושים (`cmsxh4kiv002801p8aju03od8`)
- **Signal:** the listing's last accordion row is a permanent open-CV catch-all
  (`למשרה שאינה ברשימה הנ"ל - הקליקו כאן למשלוח קו"ח`) with an apply iframe but an
  **empty description body**. It matches `itemSelector` like any other row, so it
  ships as a job with `description: ""` — dragging the description fill rate down
  and putting a non-job in front of users. It survived in the DB for months.
- **Fix:** `li.remove()` it in the setupScript **before** extraction, matched on the
  title (`/למשרה\s+שאינה\s+ברשימה/`) OR an empty body, so the row never reaches
  `itemSelector`. Removing beats a `:has()` selector here: the empty body is
  whitespace text nodes, so `:empty` does not match it.
- **Watch the count:** the drop must be visible and intentional — rehearse and print
  `items before -> after` (9 → 8 here), otherwise a too-greedy matcher silently eats
  real vacancies and the coverage line still looks plausible.
- **Generalizes to:** the "משרה שלא ברשימה" / "שלחו קו״ח כללי" / "לא מצאת משרה
  מתאימה?" row that IL career pages routinely append to a listing, and to any
  always-present non-vacancy row (spontaneous applications, talent pool).

### LRN-SETUP-7 — Splitting one body into description + requirements: move the nodes, never copy the text

- **Date:** 2026-08-18
- **Site:** gtech.co.il (Elementor/WordPress post per vacancy)
- **Signal:** the whole ad lives in one `.elementor-widget-theme-post-content`
  block with a `דרישות:` heading partway down. The obvious build — map
  `description` to that block, and inject `.__ai-requirements` with the text
  *after* the heading — passes every gate: fill rates 1.0, Tier-A complete,
  `verify-jobids` clean. It is still wrong: `requirements` is then a verbatim
  slice of `description`, so 11/14 rows shipped the same prose twice (the other
  3 differed only because the worker's block-aware extractor prepends `• ` to
  `<li>` while a setupScript's `innerText` does not — the duplication was total
  in all 14). Nothing in QA looks for a field that is a substring of another.
- **Fix:** split the DOM instead of the string. Walk the content host's
  children, find the heading node, `appendChild` it and every following sibling
  into a hidden `div.__ai-requirements` on `<body>` — `appendChild` *moves*
  nodes, so what lands in `requirements` leaves `description` in the same pass.
  Map `description` to the (now shorter) content element and `requirements` to
  the new container. Two details that matter: when the heading runs inline with
  its content (`דרישות התפקיד:תואר ראשון…`) clone the node and strip the label
  from its first text node rather than rebuilding it from `textContent`, which
  would drop `<br>`/`<li>` structure; and bail out of the split when the text
  ahead of the heading is under ~40 chars, since an empty description is worse
  than an unsplit one.
- **Verify:** assert `requirements[:60] not in description` per row, not just
  fill rates. Before: 14/14 duplicated. After: 0/14, and `description` avg
  dropped 519 → 251 chars while the pair still carries the whole ad.
- **Generalizes to:** every site whose detail page is one prose block with
  labeled sections (דרישות / כישורים / תנאי סף / יתרון) — the same shape the
  merge-the-sections guidance in `setupscript-patterns.md` §8 covers from the
  opposite direction. Merging sections into `description` and lifting one out
  into `requirements` are the same operation; do it by moving nodes once, not by
  reading the text twice.

### LRN-SPA-11 — Civi: a detail page can return 200-but-empty, and `#je-details` is optional
- **Date / site:** 2026-08-18 · `app.civi.co.il/promos/id=5N5DYKF7RR&src=17409` (כפר המכביה),
  rebuilt from scratch after the previous record was deleted.
- **Signal:** two independent gaps that both look like "the scraper is fine, the site is thin":
  1. `promo/id=777931` answered **HTTP 200 with a 45-char body** — no `#je-*` nodes, no
     `form.Form`. Same-origin `fetch` from the board, direct navigation, retries: all identical,
     so it is a Civi-side defect on that one promo, not rate limiting. The card on the listing
     still carried the full 1220-char ad.
  2. `#je-details` was populated on only **4 of 9** postings. The other five headline their
     requirements *inside* `#je-descr` — `מה אנחנו מחפשים?`, `יש לכם?`, `דרישות:`,
     `דרישות התפקיד:`, `אתם מתאימים אם:` — so a `#je-details`-only mapping silently ships
     the requirements buried in the description and `requirements` fill sitting at 0.44.
- **Fix:** treat the detail page as an *enrichment*, never the sole source. Fall back to the
  listing `.descr`/`.title` whenever the fetched document yields nothing (description 8/9 → 9/9),
  and when `#je-details` is empty apply the LRN-SETUP-7 split to `#je-descr`: find a
  heading-like line, take until the next heading or blank line, and **remove it from the body**
  (requirements 4/9 → 8/9, zero overlap). Match headings after stripping leading emoji/bullets —
  `✨ מה מחכה לכם?` and `🏊 תעודת מציל בתוקף` both start with non-letter characters, and a
  heading only counts when the line holds nothing but the heading; `מה אנחנו מחפשים? נציגי קבלה
  ושירות לעבודה תפעולית…` is an intro sentence, not a section break.
- **Also on this board:** some postings repeat `<title> (<jobId>)` as the first line of
  `#je-descr` — strip that lead. The listing page carries **zero** `<form>` elements, so
  `formSelector: "form.Form"` correctly matches nothing there and forces the static captured
  fields (LRN-APPLY-7). The visible file input has no `name`; Civi uploads asynchronously and
  posts a hidden `input[name=cv]`.
- **Generalizes to:** every ATS where the row exists on the listing but the detail page is a
  separate document that can fail independently — the per-item fetch needs a fallback, and a
  0% field is worth probing per-row before concluding "the site does not publish it". Fill
  rates hide this: 8/9 and 4/9 both read as "mostly fine" until you diff against the listing.

### LRN-SETUP-8 — One prose block per job: map it once, and let QA's "Tier-B unmapped" stand

- **Date:** 2026-08-18
- **Site:** inmanage.co.il (17 `.job-item` cards, listing-only)
- **Signal:** every card is exactly `title` + a `דרישות התפקיד:` heading + one
  `p.js_job_require` prose block. Detail pages render the *same* card, so there is
  no second body to fetch. LRN-SETUP-7 says to split the DOM rather than copy the
  string — but here there is nothing to split: one block, one meaning. The original
  (2026-06) build mapped `description` to `.job-content` (the whole card) *and*
  `requirements` to `.js_job_require`, so all 17 rows shipped the requirements twice,
  wrapped in the card's `הגשת מועמדות` boilerplate. That is the blob.
- **Fix:** map the block to `description` only and leave `requirements` unset.
  `description` is the Tier-A gated field (≥0.6) and the one the product renders;
  `requirements` is Tier-B and ungated. `addsite-qa` then returns **REVIEW** with
  `Tier-B exposed but unmapped: requirements` — that verdict is correct about the
  DOM and wrong about the site. Override to ACTIVE when Tier-A is complete, and say
  why in `adminNote`, or the next person "fixes" it straight back into a duplicate.
- **Also on this build:** the native `data-job-id` values are bare integers
  (8, 14, 16, 23 … 44). `verify-jobids`' `indexLike` heuristic hard-fails any
  all-integer set, so a real CMS record id trips it exactly like `item-0` would.
  Inject `im-<data-job-id>` instead of mapping the attribute directly — still derived
  from the stable native id, but the prefix carries the "not an index" signal that the
  gate cannot otherwise read (same dodge as `lw-`/`pac-`, LRN-ID-8).
- **Generalizes to:** small IL company career pages that publish a requirements
  bullet-list and nothing else. Two fields both "available" in the DOM is not the same
  as two fields of content — before mapping the second one, check whether it is the
  first one under a different heading.

### LRN-SETUP-9 — `\n<br>\n` in pretty-printed markup ships a blank line between every list item

- **Date:** 2026-08-18
- **Site:** inmanage.co.il (`p.js_job_require`, 17 cards)
- **Signal:** the description passed every blob check — `isBlob()` is false, the rows
  have real `\n`, fill is 1.0 — and still read wrong in the product: a blank line
  between every single requirement. Cause is `domFieldExtract` meeting hand-indented
  HTML. The source is `…חובה \n<br>\nניסיון…`; the extractor turns the `<br>` into
  `\n` and the two surrounding text-node newlines survive, giving `\n\n\n`, which the
  `\n{3,}` guard caps at `\n\n` — a blank line, not the single break the page renders.
  Nothing flags it: "has newlines" is the only structural check anywhere in the gates.
- **Fix:** don't map a `<br>`-separated block straight to `description`. Build it in
  the setupScript: clone the node, `br → '\n'`, split, trim each line, drop empties,
  re-join with a single `\n`. **Order matters** — collapse whitespace *last*. The same
  site's third authoring style separates items by runs of 2+ spaces, and normalising
  whitespace before splitting erases the only separator those lines have (cost one
  rehearsal round: id 16 came back as a single 195-char line).
- **Restructure, don't re-style.** The first build of this also prefixed `• ` to every
  line, on the reasoning that `<li>` extraction does it and `BULLET_GLYPHS` expects it.
  The user rejected it: the page has no bullets, and "same as in the site" means the
  glyphs the ad actually prints (these ads mark some items with a literal `*` — keep
  that, verbatim). A leading bullet is also a *neutral* character, which makes the
  RTL rendering strictly worse — see LRN-UI-1. Add structure; never add characters.
- **Guard the space-split:** fire it only when a line holds **3+** runs of 2+ spaces.
  One double space is a typo — `תואר ראשון BSc  במדעי המחשב` appears on 9 of these 17
  cards and must not become two requirements.
- **Assert content preservation, not just shape.** Re-flowing text can silently drop
  words. Compare `source.replace(/[•*\s]/g,'')` to `output.replace(/[•*\s]/g,'')` per
  row and print the match count (17/17 here), plus a count of fragments under ~4 chars
  to catch over-splitting. Fill rate and line count both look fine on shredded prose.
- **Generalizes to:** any hand-written (non-CMS-templated) listing where the ad body is
  one `<p>` with `<br>` separators — common on small IL company career pages. Check the
  raw `innerHTML`, not `innerText`: the browser hides the extra newlines, so the defect
  is invisible until it reaches the database.

## LRN-UI-1

### LRN-UI-1 — A correct Hebrew description renders as gibberish without `dir` on the block

- **Date:** 2026-08-18
- **Site:** inmanage.co.il (surfaced there; applies to every RTL site in the fleet)
- **Signal:** the user reported a description as "still blob … fix the word order"
  after the stored text had been verified line-by-line against the page. It was not
  the data. `JobsTable`'s `DetailSection` rendered `<p className="whitespace-pre-line">`
  with **no `dir`**, so the dashboard's LTR base direction applied to Hebrew lines. The
  bidi algorithm then lays an RTL line out left-to-right and its runs land in the wrong
  visual order: `ניסיון של שנה עד שנתיים בתפקיד Help Desk ברמה גבוהה – חובה` displayed
  as `ברמה גבוהה – חובה Help Desk ניסיון של שנה עד שנתיים בתפקיד` — logically-last words
  first. The stored string was correct the whole time.
- **Fix:** `dir="auto"` on the **container**, with each line its own `<p>`:
  ```tsx
  <div dir="auto">{value.split("\n").map((l, i) =>
    <p key={i} className="whitespace-pre-wrap min-h-[1em]">{l}</p>)}</div>
  ```
  Container-level, not per-line: per-line `auto` flips any item that happens to open
  with a Latin word (`AWS| AZURE - חובה`) to LTR and breaks the alignment mid-list.
  One direction per description matches what the source pages do — inmanage.co.il sets
  `direction: rtl` on the requirements block as a whole (the `<body>` stays `ltr`).
  `min-h-[1em]` keeps deliberate blank lines from collapsing once `pre-line` is gone.
- **Diagnosis trick:** render the *stored* string in a headless browser under the app's
  exact CSS, once per variant (with/without `dir`), and screenshot. Comparing the four
  panels took one Playwright script and settled in seconds what "the word order is
  wrong" meant — `repr()` of the string proves only that the logical order is right,
  which is exactly the half that was never broken.
- **Generalizes to:** every surface showing scraped Hebrew — job description,
  requirements, applicationInfo, and any public-site renderer outside this repo. Before
  concluding a scraper shipped bad text for an RTL site, check whether the *viewer* has
  a base direction. Logical order and visual order are different bugs with different owners.

### LRN-ID-10 — Elementor accordion/tab DOM ids are index-based and get REUSED
- **Date / site:** 2026-08-19 · gazit.co.il/קריירה/ (rebuild; old `cmp02pnno000401k5jrfqrarf` → new `cmszz0jfd000s01kfclgejiix`)
- **Signal:** the previous config shipped `externalJobId` = the Elementor panel id
  (`elementor-tab-content-4171` … `-4175`). These pass `verify-jobids` cleanly — fill 1.00,
  all distinct, not literally `item-N`, so the `indexLike` heuristic does **not** fire.
  They are nonetheless positional: Elementor builds them as `<widget-suffix><ordinal>`.
  Proof from this site's own history: the stored `-4173` was `מהנדס/ת שירות לתחום הדימות`;
  after the employer reordered the accordion, live `-4173` is `אחראי/אחראית מבנה`. The id
  survived; the job behind it did not. Dedup silently rewrites one posting into another —
  no error, no warning, and the QA suite cannot see it from a single scrape.
- **Fix:** on Elementor (and any accordion/tabs widget), never map the panel id. Elementor
  form widgets embed the real WordPress record id as a hidden input on each panel's inline
  form: `item.querySelector('input[name="post_id"]').value` → `gazit-<post_id>`. Stable
  across reordering, unique per posting, and free — no hashing needed.
  Fall back to `h-<hash(title|dept|location)>` only when no form is present.
- **Detection rule that generalises:** an id whose numeric tail is a small consecutive run
  (`…71, …72, …73, …74, …75`) is positional until proven otherwise, however "distinct" it
  looks. Consecutive-run ids should be treated like `item-N`. Compare against a *previous*
  scrape's title-for-id mapping, not just within one run — `verify-jobids` only inspects a
  single snapshot, so this class of bug is invisible to it by construction.
- **Generalises to:** every Elementor accordion/toggle/tabs job board (very common on
  Israeli WordPress company sites), and to any widget-generated `*-<n>` DOM id.

### LRN-SETUP-10 — Splitting one description blob by heading needs a state machine, not "everything after"
- **Date / site:** 2026-08-19 · gazit.co.il/קריירה/
- **Signal:** each job is a single `.elementor-tab-content` holding description *and*
  requirements. The obvious split — "everything from `דרישות התפקיד:` onward is
  requirements" — is wrong here: `מה אנחנו מחפשים?` (requirements) is followed by
  `מה אנחנו מציעים לך?` (benefits, i.e. description). A tail-split swallows the benefits
  block into requirements, and a naive both-fields-get-the-whole-blob approach violates the
  no-duplicate-field-content rule outright.
- **Fix:** iterate the content node's **direct children** and run a two-bucket state
  machine. A child is a heading when it is short (`< 60` chars), single-line, and ends in
  `?` or `:`; a heading whose text matches `^(דרישות|מה אנחנו מחפשים|מי מתאים|כישורים|תנאי סף|דרוש)`
  switches the active bucket to requirements, any other heading switches it back to
  description. Non-heading children append to whichever bucket is active. Because every
  child lands in exactly one bucket, non-overlap is guaranteed *by construction* rather
  than asserted afterwards.
- **Also:** injected `<span>`s carrying pre-rendered text bypass `domFieldExtract.ts`'s
  `<li>` handling, so the worker never prefixes `•`. Add the bullet inside `structuredText`
  or lists arrive as flat prose. (Not a blob — `isBlob` only fires with zero `\n` — so
  nothing warns you.)
- **Also (2026-08-19 · tigbur.co.il, 553 ads — the same machine over *lines*, not DOM
  children):** three refinements the DOM version never hits. (1) Switch back only on a
  **description-class** heading (תיאור/שעות/היקף/שכר/מציע/מיקום/פרטים…), never on "any
  other heading" — requirement blocks carry their own sub-heads (`השכלה:`, `ניסיון:`,
  `מיומנויות:`) and an any-heading rule dumps the whole requirements body into
  description. (2) The label is often **mid-line** (`…מתן שירות טלפוני דרישות: ידע בסיסי…`,
  one line, no break): match it inside the line, keep the head, file the tail — otherwise
  the worker's own `_enrichedFromDescription_requirements` recovers it and you ship the
  duplicate you were trying to avoid. (3) A **compound label** (`כישורים ודרישות התפקיד:`)
  needs up to two extra words, but only consume them when a separator follows — greedy
  consumption eats real content, and a separator-less label (`דרישות התפקיד`) must drop
  its trailing word or it lands in requirements as a one-word fragment. Verify with the
  LRN-SETUP-9 preservation assert **after** subtracting label text: the only row that may
  legitimately lose content is one where the ad itself repeats a line.
- **Generalises to:** any single-container job body with labeled Hebrew sections, and any
  site where a description-class heading follows a requirements-class heading.

---

### LRN-LOC-6 — A board that prints only a coarse region: mine the city out of the ad text in setupScript
- **Date / site:** 2026-08-19 · tigbur.co.il/לוח-משרות-ראשי (`cmszzye81000z01kfx0iobe0d`), 553 jobs
- **Signal:** the feed exposes one coarse `region` per job (`מרכז - גוש דן`,
  `חיפה והצפון`) while the ad body names the real city. Mapping the region wins the
  fill-rate gate but masks the city on every posting — this is the exact case
  `buildLocationWarnings`' `region_over_city` flags, and the worker's own
  `extractLocationFromGazetteer` never runs because it only fires when `location`
  is **empty**.
- **Fix:** mine the city in `setupScript` and inject it, keeping the region only as a
  fallback. Match **exactly** against an embedded subset of `CSV files/city.csv` (this
  board's names + the major localities — 100 entries ≈ 800 B, and the whole `≥4` list
  is 10.5 KB, so the full gazetteer will never fit the 8 000-char `setupScript` cap).
  Five passes, best first: `מיקום:`/`כתובת` label → softer cue (`באזור X`, `בעיר X`,
  `לסניף X`, and `בצפון ת"א`-style direction+city) → a line that is nothing but a place
  → bare `ב`/`ל` prefix (min 4 chars) → multi-word/long names anywhere, which is how a
  city in the **title** (`…כפר גני פתח תקווה`) or a parenthetical list
  (`(ת"א, רמת גן, יבנה)`) is caught; collect up to 3 so `locations` stays multi-city
  (LRN-LOC-5). Result on 553 ads: city-level location 0% → 82.8% (458 jobs), 81
  multi-location, every stored value canonical, 0 values that trace to neither the ad
  text nor the board's own region field.
- **Do NOT** hand raw candidate phrases to `normalizeLocations()` and let it resolve
  them: its cascade ends in a **levenshtein-1** step, so `בארגון`→`ארגמן`,
  `בטיחות`→`טפחות`, `מיקום`→`יקום`, `במשמרת`→`שמרת`. Exact-match in the browser, or
  the location column fills with plausible-looking garbage. Equally, `ALIAS` keys need
  the gershayim/geresh squash (`ת״א` is U+05F4, not `"`) or every abbreviation misses.
- **Generalizes to:** every staffing/recruiter board with a region filter and a
  free-text body (tigbur, natali, and the `region_over_city` warning list).
  **Home:** Step 4 location / `recipes/setupscript-patterns.md`.

---

### LRN-SETUP-11 — A setupScript that injects prose as `textContent` is a blob factory: leave prose on its native nodes
- **Date / site:** 2026-08-19 · campkimama.org (`cmt041iz3001j01kfgslz6kls`), 9 jobs — re-onboard
  of the 2026-06-29 record (`cmqynnjle004901nz99j7vrhl`), which shipped **6 of 9 descriptions
  as blobs** and 0 newlines in any of the 18 prose fields.
- **Signal:** the site is on the "Needs Fix" list for blobs, the stored `itemSelector` and
  field selectors all still match the live page, and a rescrape changes nothing. The cause
  is not drift and not stale rows (LRN-WRK-blob causes 1–3) — it is a **fourth** cause: the
  site's own `setupScript` built the field with
  `mk('__ai-description', el.textContent.replace(/\s+/g,' ').trim())`. `domFieldExtract`'s
  `<br>`/block→`\n` and `<li>`→`•` work (commits `bfe1935`, `ecb8101`) never get a chance:
  by the time they run, the field is a single `<span>` holding one flat string.
- **Fix:** map prose fields to the **native DOM nodes** and reserve the setupScript for
  scalars. On a Wix repeater (LRN-SPA-6) every field is already addressable by an id prefix,
  so `description` → `[id^="comp-<descPrefix>__item-"]` and `requirements` →
  `[id^="comp-<reqPrefix>__item-"]` need no injection at all; the setupScript then only
  appends `__ai-externalJobId` / `__ai-location` / `__ai-applicationInfo` to the row root
  (LRN-SETUP-1). Result here: 6/9 blobs → 0/9, all 9 requirements bulleted, 0 desc/req
  overlap (LRN-SETUP-7), ids identical across two consecutive scrapes.
- **Watch the invisible characters.** The "strip the `דרישות התפקיד:` label" pass matched 8
  of 9 rows; the 9th carried a **U+200B** after the colon, so `\s` did not match it and the
  label shipped. Squash `[\u00A0\u200B-\u200F\uFEFF]` before testing a Hebrew label regex —
  same family of trap as LRN-SETUP-5 (`\b` is ASCII-only).
- **The old location was outside the gazetteer.** The 2026-06 config hardcoded
  `כל הארץ`, which is **not** in `CSV files/city.csv`; the canonical nationwide value is
  `פריסה ארצית`. A hardcoded constant still has to pass `verify-location-csv`.
- **Generalizes to:** every site whose blob survives a rescrape while its selectors verify
  clean — grep the stored `setupScript` for `replace(/\s+/g` before classifying it as drift.
  **Home:** `recipes/setupscript-patterns.md` §7 / Step 4 description.

### LRN-SETUP-12 — The apply CTA is not description text: strip "שלחו קו״ח למייל" + the address, keep it in `applicationInfo`
- **Date / site:** 2026-08-19 · kley-zemer.co.il (`cmt06bb61001p01kfoht2o5co`), 3 jobs — re-onboard
  of the 2026-06-28 record (`cmqyexbel001v01nz2e0m1iuj`), which shipped 2 of 3 descriptions as blobs.
- **Signal:** an email-apply site (LRN-FORM-3). The ad's last line is a call to action —
  `שלחו קורות חיים למייל: jerusalem@kley-zemer.co.il` — and importing the detail node whole
  carries it into `description`, where it duplicates `applicationInfo` and reads as spam in
  the product's job card. `formStatus: EMAIL` and a 100% `applicationInfo` fill do **not**
  mean the address is gone from the prose; nothing in the QA gates looks for it.
- **Fix:** clean the imported node in the setupScript, in this order — (1) remove
  `[data-cfemail], .__cf_email__, a[href^="mailto:"], a[href*="email-protection"]`, (2) walk the
  remaining **text nodes** and strip a bare-email regex plus a CTA regex
  (`(?:שליחת )?(?:ל?שלוח|שלחו|שלח/י|להעביר)? ?(?:את )?(?:קורות ?ה?חיים|קו"ח)(?: (?:או|ו) ?פרטים)? ?(?:ל?מייל|ל?דוא"ל|ל?אימייל)? ?:?`),
  (3) drop `p/div/strong/span` left whitespace-only and any trailing `<br>`. Editing text nodes
  rather than `innerHTML` keeps the block structure that LRN-SETUP-11 exists to preserve.
  Strip only the CTA fragment, not the sentence: `- לסניף ירושלים שלחו קורות חיים למייל:` must
  keep `- לסניף ירושלים`, which is also the location evidence.
- **The gazetteer reads shift words as places.** The old record stored `משמרות` for the driver
  job — the gazetteer matched `משמרות בוקר בלבד` ("morning shifts only") to the moshav משמרות.
  `locationFallback` cannot repair a wrong guess (LRN-LOC-1), so the setupScript now matches the
  ad prose against a city.csv-verbatim list with alias entries for neighbourhoods and industrial
  zones (`צהלה` → `תל אביב-יפו`, `קריית אריה` → `פתח תקווה`) and falls back to `פריסה ארצית`.
- **A CMS id beats a Hebrew slug.** The card image carries `id="BSUniqueID_<num>_<n>_BSIMAGE"` and
  the detail body is `id="BSText<num>_<n>_BSTEXT"` — one key that both addresses the prose container
  and yields a stable `externalJobId` (`kz-58336_8`), byte-identical across two consecutive scrapes.
- **Generalizes to:** every email-apply site (LRN-FORM-3) and every detail-fetch setupScript that
  imports a whole prose container. **Home:** `recipes/setupscript-patterns.md` §7.

### LRN-LOC-7 — An ad that names a *country* has no location: emit `Unknown`, don't synthesize a nationwide value or the HQ
- **Date / site:** 2026-08-19 · biopharmax.com/he/careers/ (`cmt06x4p2001x01kfyxslnx1p`), 4 jobs —
  re-onboard of the 2026-06-09 record (`cmq6nxder000401liq0l2zw3a`), whose 5 stored jobs were all
  stale one-line blobs against an itemSelector that matched 0 elements.
- **Signal:** the detail page has a real `Job location:` section, and its entire body is `– Israel`.
  Three of four ads say only that ("Israel", "Israel and abroad"); one names `Herzliya` and
  `central Israel`. A city-token map finds nothing in the first three, so the fallback branch decides
  what ships for 75% of the site.
- **The trap:** two plausible fallbacks are both guesses. `פריסה ארצית` (as LRN-SETUP-12 used) reads
  the country as "nationwide"; the company's Israeli HQ from the contact page (`4 Hasadnaot St,
  Herzlia`) reads it as "head office". Neither is in the ad, and `locationFallback` cannot repair a
  wrong guess later (LRN-LOC-1). Asked directly, the user chose neither: **do not guess.**
- **Fix:** emit the literal `Unknown` sentinel. `normalizeLocations` returns `[]` for it,
  `verify-location-csv` skips it, and the dashboard city filter simply has no claim to fragment.
  Emit a real value **only** when the token is present in the ad *and* verbatim in
  `CSV files/city.csv` — here only `bpx-3071` → `הרצליה, אזור מרכז`, both stated in its body.
  Note the sentinel is non-empty, so it also suppresses the site-level `locationFallback` — which is
  the point.
- **Corollary — QA's location correctness suspect fires on every correct Hebrew mapping.** The gate
  substring-matches the emitted value against the detail body; an English page mapped to a city.csv
  Hebrew value can never match. It flagged `פריסה ארצית` and `Unknown` alike. Benign here, but it
  means the suspect is not evidence either way on a non-Hebrew site — check the mapping by hand.
- **Scope filters belong in the setupScript, gated on positive evidence.** This board carries 7
  posts, 3 of them India (Pune). The user's scope is Israel-only, so the script `remove()`s a card
  unless it shows positive Israel evidence — a future Germany posting is dropped by default rather
  than shipped because it failed an India blacklist. Print `items before -> after` in the rehearsal
  (7 → 4) so a too-greedy matcher can't silently eat real vacancies (LRN-SETUP-6).
- **Two free wins on a WP/JetEngine board:** the card class `jet-listing-dynamic-post-<id>` is the
  native post id (`bpx-3070`, byte-identical across two consecutive scrapes), and Yoast's JSON-LD
  `"datePublished"` carries a real post date that nothing renders in the DOM — mapping it took
  `publishDate` and `ageBucket` from 0% to 100%.
- **Generalizes to:** every multinational careers board scraped for one country, and every ad whose
  location field holds a country. **Home:** `recipes/setupscript-patterns.md` §7.

---

### LRN-SPA-12 — A "blob site" can be a platform migration: re-triage the URL before blaming the config
- **Date / site:** 2026-08-19 · natali.co.il/דרושים → `app.civi.co.il/promos/id=Y5499HHEL5&src=19522`
  (old record `cmq7sn3au…`, 11 jobs / 7 blobs → new record `cmt07ezrv…`, 20 jobs / 0 blobs)
- **Signal:** the site sat on the blob queue with an Elementor-popup `setupScript` that
  decoded `openPopup` ids and scraped modal widgets. None of it was broken code — the
  employer had rebuilt the careers page. The stored `siteUrl` **301s** to `/careers/`,
  whose jobs are an `<iframe src="https://app.civi.co.il/promos/…">`. The old script kept
  matching a layout that no longer exists, so the record slowly rotted into blobs.
- **Fix:** re-run `triage` on the stored URL as step 1 of any blob/drift investigation.
  It follows the redirect, spots the cross-origin ATS iframe and emits `embeddedBoardUrl`;
  onboard **that** as the `siteUrl` (LRN-SPA-8) and delete the wrapper record — the worker
  cannot read across the iframe boundary, so a wrapper record can only ever go stale again.
  The whole Civi recipe then applies unchanged (`recipes/spa-frameworks.md#civi`).
- **Generalizes to:** every site whose config predates a website redesign. A `301` on the
  stored `siteUrl`, or a `topCluster` that no longer matches the stored `itemSelector`, is
  the tell. **Home:** §2 triage / `recipes/spa-frameworks.md#civi`.

---

### LRN-LOC-8 — Mining cities from ad prose: ban the `ה` prefix, and emit `Unknown` explicitly
- **Date / site:** 2026-08-19 · נטלי (Civi board, 20 jobs) — Civi exposes no per-job
  location field, so every city has to come out of the body text (LRN-LOC-6).
- **Signal 1 — common words that are also city.csv rows.** A gazetteer-style scan of these
  ads returns `מתן` ("מתן מענה"), `מלאה` ("משרה מלאה"), `משמרות` ("עבודה במשמרות") and
  `רווחה` ("גורמי הרווחה") — all four are real localities. Mine against an **explicit
  allowlist** of the cities the employer actually uses plus the majors, never the full list.
- **Signal 2 — the `ה` prefix manufactures places.** Accepting attached one-letter prefixes
  is what lets `ברמת גן` / `בר"ג` match, but including `ה` turns `הגדרה` ("definition")
  into `גדרה`. Hebrew never prefixes `ה` to a city name: accept `ב ל מ ו ש כ`, drop `ה`.
- **Signal 3 — an empty location is not the `Unknown` sentinel.** Leaving `.__ai-location`
  unset for an ad that names no city lets the worker's labeled scan lift the first
  `מיקום: …` line out of the body — here `מיקום: מרחק הליכה מתחנת רכבת סבידור`, a landmark,
  which `verify-location-csv` then fails. Emit the literal `Unknown` yourself (LRN-LOC-7);
  being non-empty it also correctly suppresses `locationFallback`.
- **Result:** 20 jobs, 5 distinct values, all verbatim in `CSV files/city.csv`, 2
  multi-location (`רמת גן + ראשון לציון`, `+ ירושלים`), 3 honest `Unknown`.
- **Generalizes to:** every board with no location field and a free-text body.
  **Home:** Step 4 location / `recipes/setupscript-patterns.md`.

### LRN-LOC-9 — Before injecting a location, check whether the built-in gazetteer already resolves it — and reverse a blanket injection that outlived its accuracy
- **Date / site:** 2026-08-19 · msh.co.il / מגדל שוקי הון (`cmt09nz46002r01kf1pfdohdt`,
  re-onboard of `cmq6gxm6y001p01m9k3k3pwyv`) — 5-job in-page accordion, no location element.
- **Signal — the injected constant had gone stale and was never re-checked.** The 2026-06
  config blanket-injected `data-loc = "תל אביב"` on **every** panel per LRN-LOC-1. Two
  problems compounded: (a) one of the five live ads (job 4078) names no location at all, so
  the constant asserted a workplace the ad never claims; (b) `תל אביב` is **not** a verbatim
  `CSV files/city.csv` row (`תל אביב-יפו` is), so all six stored jobs failed the standing
  city.csv condition — the injection had bypassed the normalizer that would have fixed the
  spelling. A blanket injection is a **standing assertion**: it keeps claiming the old
  location for every future posting, and nothing re-validates it.
- **Fix — map nothing and let the worker enrich.** `normalizer.ts` runs
  `extractLocationFromGazetteer(title + description + requirements)` whenever `location`
  extracts empty, then canonicalises the hit. Dry-run the real ad text through that exact
  function *before* writing any injection:
  ```
  npx tsx -e 'import {extractLocationFromGazetteer} from "./worker/lib/normalizer"; …'
  ```
  Here it resolved 4/5 unaided — including both abbreviated forms (`ממוקמים בת"א`,
  `מיקום: סעדיה גאון, ת"א.`) → `תל אביב-יפו` — and returned `null` for the ad that names
  no city, which the persist path then stores as the honest `Unknown` sentinel (LRN-LOC-7).
  Result: 5 jobs, 1 distinct value, `verify-location-csv` clean, 1 honest `Unknown`.
- **The ordering rule:** injection is the *fallback*, not the default. Reach for a hidden
  span only when the gazetteer measurably under-performs on that site's real text
  (LRN-LOC-6/8). When it already wins, an injected span is strictly worse — it overrides
  the tested path (LRN-LOC-1), skips canonicalisation, and cannot degrade to `Unknown`.
- **Amends LRN-LOC-1:** its msh.co.il citation is **reverted** — do not use that site as
  precedent for blanket injection. Its abt-industry (genuinely single-office) case stands.
  Re-read LRN-LOC-1's own caveat: "only blanket-inject when confident **every** posting
  shares the location" — on a live board that confidence expires as new ads are posted.
- **Generalizes to:** every re-onboard of a site whose old config injected a constant
  location, and any single-HQ employer whose ads mention the city in prose.
  **Home:** Step 4 location / `recipes/setupscript-patterns.md`.

---

## LRN-SETUP-13 — a `setupScript` runs BEFORE the worker's autoscroll, so a client-rendered listing is EMPTY when it fires; make the script wait for itself
- **Date / site:** 2026-09-06 · colmobil.co.il (`cmtprk0bt000201rwti39frf6`)
- **Signal:** the config PUT and `verify-config` both pass, the scrape saves the right
  number of jobs with the right titles and ids — and **every `setupScript`-injected field
  is 0%** (`description=0`, `department=0`, `location="Unknown"` on 98/100). Nothing errors
  and nothing warns; the run looks healthy.
- **Cause:** `worker/jobs/scrape.ts` runs `runSetupScript()` immediately after the body
  becomes non-empty, and only THEN calls `autoScrollUntilStable()` / extraction. On a
  React/Next island (colmobil's board hydrates via a server action several seconds after
  DOMContentLoaded) `document.querySelectorAll(itemSelector)` returns **0** at that moment,
  so the script enriches nothing. Extraction runs later, once the cards exist, and happily
  reports 100% on the fields that come straight from the DOM — which is exactly what makes
  this look like a selector problem rather than a timing one.
- **The obvious fix is a trap:** `revealSelector` IS the documented setupScript gate (the
  worker waits up to 20s for it), but it is *also* the per-item reveal that extraction
  **clicks** (`findReveal(item, revealSelector)` → `reveal.click()`). Pointing it at the
  item selector on a site whose item **is the job anchor** (`a.job-card-wrap`) would click
  114 links and navigate the page away. Only use `revealSelector` for a real accordion
  toggle that is not itself the item.
- **Fix — make the script gate itself.** Poll for the items and require the count to be
  *stable*, not merely non-zero, so a partially-hydrated list isn't half-enriched:
  ```js
  var prev = -1, stable = 0;
  for (var t = 0; t < 60; t++) {            // ≤30s, inside the 90s setupScript budget
    var n = document.querySelectorAll(CARD).length;
    if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
    prev = n;
    await sleep(500);
  }
  ```
- **How to catch it before shipping:** a dry-run that calls `waitForSelector(item)` first
  **cannot reproduce this** — it hands the script a populated DOM the worker never gives it.
  Mirror the worker instead: `goto(domcontentloaded)` → `waitForFunction(body.children.length > 0)`
  → run the script. On colmobil that prints `cards at setupScript entry: 0`, which is the
  whole bug in one line.
- **Generalizes to:** every SPA/Next.js listing enriched by a `setupScript` — and to the
  concurrency budget too: the same script took **89s** (right at the 90s cap) with 8 fetch
  lanes and **4.3s** with 24. Partial progress survives a timeout, because the injections
  are DOM mutations already applied when `page.evaluate` throws.
  **Home:** Step 4.3 setupScript / `recipes/setupscript-patterns.md`.

---

## LRN-ID-11 — a native 3–4 digit req number is indistinguishable from a row index; namespace it
- **Date / site:** 2026-09-06 · colmobil.co.il (`cmtprk0bt000201rwti39frf6`)
- **Signal:** `verify-jobids` exits 2 with `index-based ids (re-key on reorder)` even though
  the ids are the employer's **own** printed job codes (`div.code` → `4907`, the same number
  in `h1.job-title` and in the detail URL `/jobs/4907/`), 114 of 114 distinct and stable.
  The gate's test is `/^(item[-_]?)?\d{1,4}$/`, which no bare integer can pass.
- **Fix:** inject the code with a site prefix — `colmobil-<code>` — rather than abandoning a
  perfectly good native id for a hash. It stays the site's own stable key, becomes
  self-describing, and is unambiguously not an ordinal. Do this on the FIRST config, before
  any scrape: `externalJobId` is the dedup key, so prefixing it later re-keys every job.
- **The gate cannot be satisfied by prose, and it has a mirror-image false positive:** with
  the prefix, `addsite-qa` then flags `externalJobId looks like URL/title slug (15/15 match)`
  — because the code also appears in the detail URL. Both heuristics are pointing at the same
  genuinely-native id from opposite sides. Resolve it with evidence, not argument: confirm
  every id matches `^<site>-\d+$`, that its code equals its own detail-URL segment, and that
  distinct == total; then record that check in `adminNote` so the next reader doesn't re-open it.
- **Generalizes to:** any ATS/CMS that prints a short numeric requisition number (dealer
  groups, WordPress job CPTs, in-house boards) — prefer the native number, namespaced, over
  a synthesised `h-<hash>`. **Home:** Step 4 `externalJobId` / Step 9 id gate.

---

## LRN-LOGO-1 — an `<img src="*.svg">` logo was unreachable, so the capture stored a COMPETITOR's mark
- **Date / site:** 2026-09-06 · colmobil.co.il (`cmtprk0bt000201rwti39frf6`)
- **Signal:** `/company-profile` reports `COMPLETE` with a logo, and the logo is **OMODA** —
  one of the car brands the company imports. Nothing warns, because every gate it passes
  is about the *file* (magic bytes, dimensions, not-a-favicon, not-a-widget-host), and the
  file is a perfectly good 300x300 PNG logo. It is just the wrong company's.
- **Cause — a gap that turns into a wrong value, not a missing one.** The harvest could see
  only two kinds of logo: an **inline** `<svg>` in the header (rasterised in-page), and a
  raster URL. `collectLogoCandidates()` drops every `.svg` URL outright, so a mark shipped
  as `<img src="…/logo.svg">` was reachable by neither path. The company's own logo being
  invisible does not end the search — it just leaves whatever else carries `logo`/`לוגו` in
  a filename or alt, and on an importer's site that is a **footer strip of other companies'
  brands** (`oralogotrans.png`, `שמיץ-logo.png`, `logoblack-1…png`). Same outcome as the
  natali/bankhapoalim widget cases behind `isWidgetHost()`, reached by a different road:
  **when the real logo is unreachable, the runner-up is somebody else's identity.**
- **Fix:** `scripts/lib/svg-img-logos.ts` — rasterise header/nav/home-link `<img>` whose src
  is an SVG, in the page, and append to `harvest.inlineLogos` so they compete as the inline
  marks they effectively are. Scoped to the SAME selector as the inline-svg rasteriser, which
  is what keeps the footer brand strip out. Runs as its own `page.evaluate` **after** the
  harvest, deliberately: Playwright serialises the harvest closure, so nothing inside it can
  call an imported function, and putting the rule (`isSvgSrc`) in a module keeps it unit-testable.
- **Two traps found while fixing it, both of which fail SILENTLY:**
  1. **`__name is not defined`.** tsx compiles with `keepNames`, wrapping every named function
     in a `__name(...)` call that does not exist in the browser. A named arrow inside
     `page.evaluate` throws on its first line — and a `catch` that returns `[]` reports that
     as "no logos found". Write evaluate bodies with **no** inner named functions.
  2. **`pathCount: 0` is not a neutral default.** The ranking is `pathCount desc, then area
     desc`, precisely so a full lockup beats a bare glyph. An `<img>` exposes no `<path>`
     count, and leaving it 0 put the real "כלמוביל Colmobil" lockup BELOW the inline circular
     "O" glyph — right company, lesser mark. Fetch the `.svg` (same-origin, already cached
     from rendering the `<img>`) and count `<path` for real.
- **Generalizes to:** every site whose logo is an SVG file rather than inline markup — and as
  a rule of thumb, **any importer/distributor/dealer-group site**, where a strip of the brands
  they carry is exactly what a "logo"-shaped search finds. Verify a captured logo by LOOKING
  at it, not by trusting `withLogo: 1`. **Home:** `/company-profile` §0 logo row.

---

## LRN-ABOUT-1 — "longest paragraph wins" picks the newest PRESS RELEASE on a company-history page
- **Date / site:** 2026-09-06 · colmobil.co.il (`cmtprk0bt000201rwti39frf6`)
- **Signal:** `/company-profile` reads the **right** page (`provenance.about` =
  `about page (…/about-us/)`) and still stores the **wrong** paragraph. The captured text
  was "כלמוביל מתרחבת לאירופה עם קבלת זיכיון לשיווק OMODA ו- JAECOO באוסטריה!…" — a dated
  news item about two car brands the company imports. It passes every filter, because it
  IS real company prose; it just is not a description, and it reads as though the profile
  belongs to OMODA rather than to Colmobil.
- **Cause:** `extractAboutText()` sorted all qualifying paragraphs by length and took the
  longest. "Longest" is a proxy for "most substantial", and it inverts on an about page
  written as a NARRATIVE. This one is a 120-year timeline: 34 qualifying paragraphs, the
  description is **#0** at 455 chars, and the longest is **#32** at 606 — the most recent
  entry. The rule effectively selected "the newest press release on the page", and it gets
  worse over time, because every new milestone the company adds is another candidate.
- **Fix:** rank by length **within the lede only** — `paragraphs.slice(0, 3)`. A description
  is the lede; everything below it is history, news or detail. Keeping "longest" inside that
  window still beats a bare "first paragraph" rule, which would break on a page that opens
  with a short hero tagline above the real intro (both cases are now asserted in
  `company-extract.test.ts`).
- **Two traps worth repeating:**
  1. **A fixture too small to exercise a window silently proves nothing.** The first version
     of the test had 3 paragraphs and a window of 3, so every candidate was inside it and the
     test failed for the wrong reason. Confirm a new test fails with the fix DISABLED, not
     merely that it fails before you write the fix.
  2. **`companyAbout` is write-once.** By the time a human notices the text is wrong, fixing
     it needs `--force`, which re-captures every other field too. Read the stored about copy
     once per site while onboarding is still fresh — this one was flagged as "time-bound" in
     the first pass and shipped anyway, which is the whole mistake.
- **Generalizes to:** any about page shaped as a timeline, a milestone list, or a news feed —
  common for long-established companies, importers and groups. **Home:** `/company-profile`
  §0 about row / `extractAboutText`.

---

## LRN-LOC-10 — the gazetteer answering is not the gazetteer being right: diff it against the ad's OWN location statement before trusting it

- **Date / site:** 2026-09-15 · enviro-services.co.il / החברה לשירותי איכות הסביבה
  (`cmu2pfk1v000101nvmm4z2yxo`) — 8-job in-page accordion (WP CPT `dorsim`), no location
  element, every ad is free prose.
- **Signal — LRN-LOC-9 says "check whether the gazetteer resolves it first", and it did
  resolve, confidently, and two of the eight were WRONG.** Running
  `extractLocationFromGazetteer(title + description)` over the real ad text returned a
  canonical non-null value for 6/8. The failure is not a miss, it is a confident hit
  sourced from the wrong sentence:
  - job 6648 prints **`מיקום המשרה: תל אביב.`** — its own explicit label. The ad also
    carries an employer boilerplate paragraph ("מתקן הטיפול המרכזי של החברה ממוקם
    בפארק האקו-תעשייתי נאות חובב"), and the gazetteer returned **`נאות חובב`** — it
    contradicted the one sentence in the ad that actually states the workplace.
  - job 6634 names no workplace at all; the only place in the text is a **commute**
    ("קיים מערך הסעות מבאר שבע"). The gazetteer returned `null` here, but the same
    sentence shape one ad over (6652, "הגעה- מערך הסעות מסודר ונוח מבאר שבע") is exactly
    how a shuttle ORIGIN becomes a stored workplace.
- **Why the naive reading of LRN-LOC-9 walks into it:** its test is "did the gazetteer
  return something?" That question is only sound on a board whose ads contain nothing but
  the ad. A single-employer board repeats the company's own address in every posting, so
  the gazetteer always has a plausible city to find — it just is not this job's city.
- **Fix — extract only from an explicit location STATEMENT, and rank the sources.** The
  injected span is not a blanket constant (LRN-LOC-9's failure mode) and not a prose scan
  (banned, CLAUDE.md): it is anchored, per job, in this order —
  1. an explicit label: `/מיקום\s*(?:ה?משרה)?\s*[:：]\s*(…)/` → match places inside that
     segment only. Wins outright, so boilerplate elsewhere in the ad cannot override it.
  2. else an anchored workplace phrase — `(מפעלנו|מפעלה|מפעל החברה|משרדי החברה|ממוקם|…)`
     within 30 chars before the place name. Collect **all** matches in document order, so
     "נוכחות שוטפת במשרדי החברה בתל אביב ובמפעל החברה בנאות חובב" stays multi-city
     (LRN-LOC-5) instead of losing one.
  3. else an explicit nationwide phrase (`בכל רחבי הארץ`) → `פריסה ארצית`, a verbatim
     city.csv row.
  4. else the literal string `Unknown` — **injected, not left empty**, because an empty
     location is precisely what re-arms the gazetteer (`normalizer.ts` only runs it when
     `location` is blank).
  Place names come from a 2-entry allowlist of the employer's real sites; anything else
  falls to `Unknown`. Result: 8 jobs, 3 distinct values, `verify-location-csv` clean,
  1 honest `Unknown`, 1 multi-city.
- **The check that makes this auditable — run BOTH and diff them.** Print the injected
  value beside `extractLocationFromGazetteer()` on the same text, per job, before the PUT.
  The two disagreeing on 2 of 8 rows is the whole finding in one table, and it is the only
  way to see a wrong-but-confident location: `verify-config`, `addsite-qa` and
  `verify-jobids` never read location values, and `verify-location-csv` only proves the
  value is a real city — `נאות חובב` would have passed it while being the wrong city.
- **Generalizes to:** every single-employer board (accordion, Elementor loop, CPT archive)
  where each ad repeats the company's address, and any ad that prints commute/shuttle
  information. **Amends LRN-LOC-9:** its ordering rule stands, but "the gazetteer resolves
  it" must be read as "the gazetteer agrees with the ad's own location statement".
  **Home:** Step 4 location / `recipes/setupscript-patterns.md`.

---

## LRN-API-6 — two shapes in the skill's own curl snippets are wrong: `GET /api/sites/:id` is 405, and `PUT /config` rejects a payload missing `pageFlow`/`formCapture`

- **Date / site:** 2026-09-15 · enviro-services.co.il (`cmu2pfk1v000101nvmm4z2yxo`), first
  observed on a clean onboarding with no local drift.
- **Signal 1 — the analyzer wait-loop can never observe anything.** `addsite2.md` §4 polls
  `curl "$BASE/api/sites/$SITE_ID" | jq -r '.data.status'` for up to 2 minutes. That route
  (`src/app/api/sites/[id]/route.ts`) exports **PATCH and DELETE only** — a GET returns
  **405** with an empty body, so `.data.status` is `undefined` on every iteration and the
  loop always runs its full 24 ticks without ever seeing ANALYZING leave. The skill's own
  note ("the `/:id` GET can return empty for fresh sites") reads as a race; it is not one,
  it is a method that does not exist.
  **Use the list route with an exact URL filter instead:**
  `GET /api/sites?siteUrl=<encoded>&pageSize=10` → `.data[0].status`. One call showed
  `status=REVIEW, confidence=0.4` immediately.
- **Signal 2 — the documented config payload 400s.** §9.1 shows a `PUT /api/sites/:id/config`
  body of `itemSelector` + `fieldMappings` (+ optional keys). `updateSiteConfigSchema`
  (`src/lib/validators.ts:134`) makes **`pageFlow` (array) and `formCapture` (nullable
  object) REQUIRED**. Omitting them returns
  `VALIDATION_ERROR: Invalid input: expected array, received undefined, Invalid input:
  expected object, received undefined` — which names neither key, so the natural next move
  is to start guessing at `fieldMappings`. A listing-only site sends `pageFlow: []` and
  `formCapture: null` (the latter is also the correct value for an email-apply site).
- **Cost:** the double-PUT race guard means this 400s **twice**, 8 s apart, and the error
  text points at nothing; then `verify-config` fails for the real reason (no config was
  ever written) and reads like the analyzer race (`LRN-RACE-2`) it is not.
- **Generalizes to:** every onboarding — both traps are in the path each site walks, and
  neither depends on the site. **Home:** `addsite2.md` §4 (wait-for-analyzer) and §9.1
  (payload shape); fixing the snippets there removes both.
- **DONE 2026-09-16 in `250da75`.** §4 now names the 405 outright and polls the list route
  with an exact-URL filter instead (`addsite2.md:392-405`); §9.1 marks `pageFlow` and
  `formCapture` REQUIRED with the `updateSiteConfigSchema` landmine spelled out
  (`addsite2.md:696-716`). Verified at HEAD `e33bc85`, 2026-09-24 — nothing outstanding in
  this entry.

---

## LRN-SETUP-14 — WordPress list indentation ships as EMPTY BULLETS: the page hides the marker, the worker does not

- **Date / site:** 2026-09-16 · enviro-services.co.il (`cmu2pfk1v000101nvmm4z2yxo`), job 66 —
  the owner reported "empty bullets under תנאי סף and under עדיפות תינתן ל".
- **Signal:** the stored `requirements` held bare `•` lines — two directly under each sub-head —
  while the rendered page shows none. Every gate is blind to it: fill is 1.0, the text has real
  newlines, and `innerText` of the same node shows nothing wrong, because the browser draws no
  marker for these items. It is only visible in the stored field.
- **Cause:** the WordPress editor indents a list by wrapping it, level by level, in
  `<li style="list-style-type: none;">` items that contain only the next list:
  `<ol><li style="list-style-type:none"><ol><li style="list-style-type:none"><ul><li>real item…`.
  `domFieldExtract.ts` prefixes `• ` to **every** `<li>` (the marker logic from `ecb8101`), with no
  test for `list-style-type` or for the item having any text of its own — so each wrapper becomes
  a bullet with nothing after it.
- **Fix (per site, in `setupScript`):** before extraction, unwrap every `<li>` that holds a nested
  `ul`/`ol` and has **no text of its own** (its non-list child nodes are whitespace only): move its
  children up in place and remove it. The real items keep their native `<li>` and are bulleted
  normally. Measure it with the same definition — count `<li>` with no own text inside the mapped
  node — not with `innerText`, which cannot see the bug.
- **Proof it is load-bearing:** the same dry-run with the unwrap disabled reported `4` empty
  `<li>` on job 66 and `0` elsewhere; with it, `0` everywhere and identical text on all four jobs.
  After re-scrape, no stored line on the site is a bare bullet.
- **Better home, not yet done:** this is a worker defect, not a site quirk — any WordPress board
  with an indented list hits it. The general fix is in `domFieldExtract.ts`: skip the marker for an
  `<li>` whose own text is empty. Until then, every site needs the setupScript unwrap. Before
  choosing, count how many live sites store a bare `•` line.
- **Generalizes to:** any WordPress / Gutenberg / Classic-editor job body containing a nested or
  indented list. **Home:** Step 4 description/requirements / `worker/lib/domFieldExtract.ts`.

---

## LRN-SETUP-15 — a single-container job body needs three more cleanups than LRN-SETUP-10's split

- **Date / site:** 2026-09-15/16 · enviro-services.co.il (`cmu2pfk1v000101nvmm4z2yxo`), 8 then 4
  jobs in a WP CPT accordion; each rule below was raised by the owner.
- **1. A REPEATED "description" heading can be the requirements block.** Job 1114 labeled both of
  its blocks `תיאור התפקיד:`; the second was plainly requirements (`השכלה אקדמית- יתרון משמעותי`,
  `ניסיון אדמיניסטרטיבי- חובה`) but the ad never printed `דרישות`, so LRN-SETUP-10's machine filed
  it in description and requirements came back NULL. **Fix:** count `^תיאור` label nodes per job; the
  first keeps the description bucket, a second switches to requirements and its label is dropped.
  The board removed job 1114 overnight, so the rule is held by a fixture test with a control
  (rule stripped → requirements empty, block in description), not by the live page.
- **2. Sub-heads inside requirements must not switch back.** Job 66 prints `תנאי סף:` and
  `עדיפות תינתן ל:` inside its requirements. LRN-SETUP-10's refinement holds here: switch back only
  on a description-class label (`תיאור|מיקום|שעות|תנאי המשרה|הערות|להגשת|יש להגיש|נשמח לקבל`), and
  test requirements-class labels **first** so `תנאי סף` is not caught by the description-class `תנאי`.
- **3. The legal block is long, so a short-label rule never sees it.** `*המשרה מנוסחת בלשון נקבה…`
  is ~200 chars / 3 lines; a `< 60 chars, single line` heading test lets it fall into whatever
  bucket is active — requirements, on job 1113. **Fix:** match the legal openers
  (`המשרה מיועדת|המשרה מנוסחת|החברה פועלת|סודיות מובטחת|המודעה מנוסחת`) regardless of length and
  switch to description.
- **Also — keep an intro line from triggering a switch.** Job 1111 opens with
  `לחברה … דרוש/ה: חשמלאי/ת מוסמך/ת`; a `דרוש` trigger (it is in LRN-SETUP-10's list) would file
  the whole ad as requirements from line one. Only short, single-line label nodes may switch.
- **Also — drop a bare job-number line.** `מס' משרה-1118` on a line of its own is metadata; the
  number already ships as `externalJobId`. Drop a node matching
  `^\*?\s*מס['׳`]?\s*משרה\s*[-–—:]?\s*\d+\s*$` (after squashing `\u00A0`); a sentence that merely
  contains the number stays.
- **Verify with a preservation assert that knows the intended drops:** every original line must land
  in exactly one bucket, and the only lines allowed to disappear are requirements labels, a repeated
  `תיאור` label and the bare job-number line. Anything else missing is content loss.
- **Generalizes to:** any single-container Hebrew job body — WP CPT accordions, Elementor tabs,
  in-house boards. **Home:** Step 4 description/requirements / `recipes/setupscript-patterns.md` §8.
  Reference: `sites/_configs/enviro-services--4z2yxo.setup.js`.

---

## LRN-WRK-19 — the nightly sweep protects small boards from neither a sharp drop nor a failing setupScript

- **Date / site:** 2026-09-16 · enviro-services.co.il (`cmu2pfk1v000101nvmm4z2yxo`) — the board
  went from 8 jobs to 4 overnight (5 unpublished, 1 new), confirmed against
  `wp-json/wp/v2/dorsim`, and the author was visibly mid-edit: one probe saw the new job with no
  department and no apply element; two later loads had both.
- **1. The drop guard does not cover a board under 10 jobs.** `isSuspiciousDrop`
  (`worker/lib/scheduledRun.ts`) fires only when `previousCount >= 10` **and**
  `newCount < previousCount * 0.5` (`SWEEP_DROP_MIN_PREVIOUS` / `SWEEP_DROP_KEEP_RATIO`). The
  baseline is the site's current `Job` row count (`scrape.ts`, `prisma.job.count`), and the guard
  runs on scheduled runs only — a manual scrape never checks it. So on a small board, a scrape that
  lands during a partial render, or while the author is mid-edit, commits the smaller set:
  scrape is delete-and-recreate, and the missing rows are gone. A genuine 8 → 4 turnover and a
  half-rendered page are indistinguishable to it.
- **2. A throwing `setupScript` is logged and ignored, and the run still succeeds.**
  `runSetupScript` (`scrape.ts`) catches every error and only `console.warn`s. Extraction then runs
  on the un-enriched DOM: every field the script injects comes back empty, and the worker quietly
  fills the gaps — `externalJobId` becomes a synthesised `h-<hash>` (every row RE-KEYED; only a
  `synthesised_external_job_id` warning on the run), `location` falls to the gazetteer (LRN-LOC-10:
  confidently wrong on this board), and a moved-node description/requirements split collapses back
  into one field. None of this changes site status on a scheduled run.
- **What this means when writing a setupScript for a nightly-scanned site:** there is no second
  chance and no alarm. Guard every `querySelector` result before use, wrap any `fetch` in its own
  `try`, and never let one item's failure throw out of the loop — the script must degrade per item,
  not per page. A dry-run against the live page cannot prove this; it only proves today's markup.
- **Also:** a site scraped manually is skipped by the sweep for `SWEEP_FRESH_WINDOW_HOURS` (20h)
  after its last success, so onboarding late in the day means its first scheduled scan is the
  night after next. And sweep history (`/api/dashboard/sweeps`) records every run as `manual` /
  `manual-single`, even timer-started ones — tell a nightly run apart by `selectedCount`, not
  `trigger`.
- **Generalizes to:** every ACTIVE site with fewer than 10 jobs, and every site whose ids, locations
  or field split come from a `setupScript`. **Home:** Step 11 (scrape) / `worker/lib/scheduledRun.ts`
  / `worker/jobs/scrape.ts` `runSetupScript`.

---

## LRN-SETUP-16 — a page that prints every job as prose in ONE cell, and the owner's job body rules

- **Date / site:** 2026-09-16 · heara.co.il (`cmu3x5es9000j01nvxaxhar00`), legacy LiveSite table
  page; 12 jobs from 9 headings. Each rule below was raised or confirmed by the owner.
- **Signal:** triage YELLOW with a top cluster of ~457 — the menu, not the jobs. The jobs are
  free text in a single `td`: an underlined `title - משרה NNN` heading, `תיאור-`/`דרישות-`/`שכר -`
  lines, dash rules between jobs, and one closing section (training pay, travel, terms, how to
  apply) printed once under all of them. No job pages, no repeating element.
- **1. Dash rules are not the only boundary.** Jobs 200 and 100 have only the underlined heading
  between them; splitting on dashes alone shipped them as one job. Mark a sentinel before every
  `<u>` carrying a job number as well as at every dash line.
- **2. A group posting is split into its tracks.** `משרה 100` lists `משרה 101 - מדריך טיסנאות` …
  `משרה 107`; each track is a job with the group's shared text, and 100 itself is not published.
  The page reused 107 for a separate standalone posting — the standalone one owns the number.
  `בעלי ניסיון מקצועי בתחום:` introduced the track list, so each track fills it with its own field
  (strip `מדריך` — final kaf `ך`; a `מדריכ` pattern never matches the singular).
- **3. `לא זמין בעת זו` on a heading = closed.** Skipped by rule, so it returns on its own when the
  employer removes the marker.
- **4. Owner body rules, now fleet-wide** (`addsite2.md` *Job body rules*): requirements only in
  `requirements`; `תיאור-`/`דרישות-` labels dropped; a `שכר…` tail on a requirements line stays in
  the description; the shared closing section is appended to every job; the page's email
  instruction ("בציון מספר משרה, פירוט זיקה מקצועית והדרכה") goes to `applicationInfo` with the job
  number, and the how-to-apply lines and their link row leave the description.
- **5. `applicationInfo` is single-line.** `normalizeField` collapses its whitespace, so the
  format is `mailto:<email> - <instruction>`; `addsite-qa` still reports `EMAIL`.
- **6. A `\u`-escaped U+00A0 written into the script arrived as the raw character.** The file-writing
  tool decodes `\uXXXX` escapes. The regex still matched, but an invisible character in a regex is
  the CLAUDE.md trap; build it with `String.fromCharCode(160)`.
- **Failure mode on the nightly (LRN-WRK-19):** the whole script is one `try`, and the job root is
  appended only at the end, so any throw yields 0 items → `empty_results` → the scheduled run keeps
  the stored listings, rather than re-keying ids to hashes.
- **Generalizes to:** old municipal, association and small-company sites that type their openings
  into one CMS text block. **Home:** `recipes/setupscript-patterns.md` §13;
  `sites/_configs/heara--xhar00.setup.js`.

---

## LRN-API-7 — `setupScript` is capped at 8,000 characters, and `verify-config` passes when the PUT was refused

- **Date / site:** 2026-09-16 · heara.co.il (`cmu3x5es9000j01nvxaxhar00`).
- **Signal:** a script revision grew to 8,262 characters. Both PUTs of the double-PUT returned
  `VALIDATION_ERROR: Too big: expected string to have <=8000 characters`; `verify-config` then
  exited 0 (it checks `itemSelector`, field names and form fields — never the script); the next
  scrape ran the PREVIOUS script and QA, `verify-jobids` and `verify-location-csv` all passed. The
  only thing that showed the change had not shipped was comparing the stored
  `fieldMappings._meta.setupScript` with the local file.
- **Fix:** after every PUT, read the site back from the list route and compare the stored script
  byte-for-byte; abort the run when it differs. Shrink by cutting comments and duplicated helpers
  (8,262 → 5,903 with identical output, proven by diffing the dry-run jobs field by field).
- **Also:** a manual scrape of a REVIEW site that passes the activation gate promotes it to ACTIVE
  itself, so a following `PATCH {"status":"ACTIVE"}` returns 400 (no same-status transition). Read
  the status before patching; a 400 there is not a failure.
- **Generalizes to:** every site with a `setupScript`, and any config edit that grows one.
  **Home:** `addsite2.md` §9.1 / §9.3.

---

## LRN-LOGO-2 — the logo is drawn into a header banner: the capture is right to refuse it, a human crops it

- **Date / site:** 2026-09-16 · heara.co.il (`cmu3x5es9000j01nvxaxhar00`).
- **Signal:** `/company-profile` returned PARTIAL with `logo header-img: rejected` — the only
  candidate was a Facebook "like" icon — while the owner could see the logo top-right. Every
  `<img>`, CSS background and inline SVG above the fold was checked: the logo exists only inside
  `new-top-960-124.jpg`, one banner with four photos beside it. Storing the banner would publish
  photos of children as the company mark.
- **Fix:** crop from the original image pixels (canvas `drawImage` of the image URL, PNG export),
  look at the crop, then `POST /api/sites/:id/company-logo` with the raw bytes and
  `x-logo-source-url` = the banner. **The upload does not recompute `companyProfileStatus`**; set
  `COMPLETE` with `PUT …/company-profile?force=1` and only that key. A later forced re-capture
  recomputes PARTIAL (`classifyProfileStatus` sees no logo of its own) — re-set it.
- **Also — the company name.** Onboarding took `companyName` from the page title
  (`הארה תכניות העשרה בעמ`); the logo reads `הארה תוכניות העשרה בע"מ`. The logo or printed legal
  name is the company's own spelling; a `<title>` is typed by whoever built the site.
- **Also — the address.** The same capture found no address because it read "צור קשר" (phones
  only) instead of "מפת הגעה" (`/107867/map`, "ממוקמים ברחוב החשמל 5 בקדימה"): one contact page is
  read, and the contact link always outscored a directions link the vocabulary did not know. Fixed
  in code (`pickDirectionsUrl`, tried first, contact page still the fallback; commit `533dfd7`).
- **Generalizes to:** pre-2015 site builders (LiveSite, Wix classic, table layouts) that ship the
  header as one image. **Home:** `company-profile.md` §4.3 / §4.5; `addsite2.md` §4.

---

## LRN-HQ-1 — a city with no street behind it beat the company's real street address

- **Date / site:** 2026-09-16 · news.ipvsecurity.com/דרושים (`cmu41l9qd000v01nviy5knkts`),
  IPV Security. Raised by the owner: "why did you write Tel Aviv if the address is in Raanana?"
- **Signal:** `/company-profile` returned `WRITTEN COMPLETE … address city=תל אביב-יפו`. Every
  gate passed. The real address, `זרחין 10 ת.ד. 4330 רעננה`, is printed on
  `news.ipvsecurity.com/contacts/` — the jobs subdomain — and the phone on both sites is `09-7430130`
  (a Sharon area code).
- **How it went wrong — two weak sources, each accepted:**
  1. **City:** ipvsecurity.com's JSON-LD `PostalAddress` is `{"addressLocality":"Tel Aviv","addressCountry":"IL"}`
     — no `streetAddress`. The city cascade tries `JSON-LD addressLocality` second, right after an
     operator value, so a bare locality wins with nothing behind it. The page's visible text never
     states an address; "Tel Aviv" appears only as a client ("Serving Tel Aviv Municipality").
  2. **Address:** the rules found no address, so the LLM fallback (`wanted: hq_address`) returned
     `תל אביב` — a city, not an address — and it was stored as `companyHqAddress`.
  3. **The street address was never read:** the homepage is derived from the site URL
     (`news.` stripped → `ipvsecurity.com`), so the contacts page on the jobs subdomain is outside
     the capture.
- **Fix (this site):** `PUT /company-profile?force=1` with only `companyHqAddress`, then
  `PUT /company-hq-city` with `evidence.kind: "operator"`.
- **Rule:** after a capture, compare the city with every street address the company prints —
  including pages on the jobs site's own host — and with the phone area code. A JSON-LD locality
  with no street, or an "address" that is only a city name, is weak evidence; a printed street
  address beats it. On a conflict, ask the owner rather than ship the capture.
- **Generalizes to:** companies whose marketing site was rebuilt (JSON-LD filled in by an SEO plugin
  or template) while an older site — a blog, news or careers subdomain — still carries the real
  contact page. **Home:** `company-profile.md` §3.1.

---

## LRN-HQ-2 — a hand-corrected address is not protected from a forced re-capture; only the city is

- **Date / site:** 2026-09-16 · news.ipvsecurity.com (`cmu41l9qd000v01nviy5knkts`), after LRN-HQ-1.
- **Signal (from code, not an incident):** `captureSite` resolves an operator-authored city first
  (`scripts/company-profile.ts`, `authoredCity` from `companyHqCitySource`), so a `--force`
  re-capture keeps `רעננה`. `companyHqAddress` has no authorship column: `--force` re-derives it
  (here, the LLM's `תל אביב` again) and `saveCompanyProfile` writes it because the key is present.
- **Result:** the corrected pair would split — address `תל אביב`, city `רעננה` — and nothing flags it.
- **Rule:** before any `--force` re-capture, list the sites whose address was corrected by hand
  (look for `companyHqCitySource` = `operator`, and check the admin note), and re-apply the address
  afterwards. The code fix would be an address source column mirroring `companyHqCitySource`;
  not done.
- **Generalizes to:** every hand-corrected company field except the city. **Home:**
  `company-profile.md` §4.4.

---

## LRN-HQ-3 — an address printed inside a sentence is stored with the rest of the sentence

- **Date / site:** 2026-09-17 · kidum.com/career (`cmu5m7fm5000801p9xiwb3q8e`), קידום.
- **Signal:** `/company-profile` returned `WRITTEN COMPLETE … address city=חולון`, and the stored
  `companyHqAddress` was
  `רח' המשביר 1 פרימיום סנטר, חולון), הכוללת את מותגי פסיכומטרי, השלמת בגרו` — a stray `)`, a clause
  that is not part of the address, and a word cut mid-way. The only printed address is inside a
  parenthesis in the middle of a sentence on `/about/`:
  `קידום ידע והשכלה בע"מ (משרדי ההנהלה ממוקמים ברח' המשביר 1 פרימיום סנטר, חולון), הכוללת את מותגי …`
- **Why:** `ADDRESS_LINE` (`scripts/lib/company-extract.ts`) is a street noun + name + house number
  followed by `[^\n]{0,60}`, and `extractAddressLine` then cuts only a `CONTACT_TAIL`
  (phone/fax/email) and trailing punctuation. The tail stops at a newline or at 60 characters. A
  footer address sits on its own line; an address inside prose does not, so the tail ran past `)` into
  the sentence and stopped at exactly 60 characters. Reproduced by running `extractAddressLine` on the
  page text: same 72-character value.
- **Why nothing caught it:** the city gate passed because `חולון` is inside the fragment — it proves a
  city is named, not where the address ends — and the profile was `COMPLETE`. Only reading the stored
  value (`company-profile.md` §3.1) showed it.
- **Fix (this site):** `PUT /company-profile?force=1` with only
  `{"companyHqAddress":"רח' המשביר 1 פרימיום סנטר, חולון"}` — the verbatim address from the sentence;
  the profile diff showed no other column changed. Recorded in the site's `adminNote`, because a
  `--force` re-capture would restore the fragment (LRN-HQ-2). The city here was captured, not
  operator-authored, so `companyHqCitySource` is null and the admin note is the only record of the
  correction.
- **Rule:** after a capture, read `companyHqAddress` for a stray bracket, words that belong to the
  surrounding sentence, or a truncated last word. Correct it to the address as printed; don't leave
  it for a re-capture.
- **Not done:** no change to `extractAddressLine`. A code fix (e.g. end the tail at a `)` with no
  matching `(`) and a scan of existing stored addresses for the same shape are deferred.
- **Generalizes to:** any company whose only address is in about-page prose rather than a footer or
  contact line. **Home:** `company-profile.md` §3.1.

---

## LRN-AGE-1 — a page with no job dates publishes years-old jobs as fresh, and no gate notices

- **Date / site:** 2026-09-16 · news.ipvsecurity.com/דרושים (`cmu41l9qd000v01nviy5knkts`).
- **Signal:** two English jobs (CISO, Head of Ethical Hackers Team) in a WordPress accordion, no
  dates anywhere. The blog's RSS feed (`/feed/`) has `lastBuildDate` 2020-04-01; the latest post is
  from 2019–2020; `wp-json` is closed (401); the company's current site, ipvsecurity.com, has no
  careers page. The page still carries an unrendered `[easy-social-share]` shortcode — a plugin
  removed long ago.
- **Why nothing catches it:** `ageBucket` is computed from `publishDate`. With no date it is null,
  and a null bucket shows no age badge — the same as a job posted today. Triage, QA,
  `verify-jobids` and `verify-location-csv` all passed, and QA returned ACTIVE.
- **What to do:** when a site gives no job dates, spend one request on a staleness signal — WordPress
  `/feed/` `lastBuildDate`, a sitemap `lastmod`, the copyright year, dead shortcodes — and tell the
  owner before activating. It is the owner's call, not a SKIP rule: here the owner chose ACTIVE,
  with an admin note asking someone to confirm the roles are still open.
- **Generalizes to:** "דרושים" pages on company blogs, news subdomains and old WordPress sites.
  **Home:** `addsite2.md` §10.

---

## LRN-HQ-4 — a company name that is also a place becomes the HQ city

- **Date / site:** 2026-09-17 · career.adamtotal.co.il `harel` (`cmu5o7j7b000i01p96jcemdht`),
  הראל ביטוח ופיננסים, homepage supplied as `https://www.harel-group.co.il/`.
- **Signal:** `/company-profile` returned `WRITTEN PARTIAL … address city=הראל`, with
  `companyHqAddress` = `הראל 60+ בע"מ` (the name of a subsidiary, no street) and
  `companyHqCity` = `הראל`. `הראל` is a real `city.csv` entry (line 876, the kibbutz), so the city
  gate passed.
- **Why it matters:** the gate proves only that a city exists (company-profile §5). When the
  employer's name is also a place name, any line that carries the name can pass as an address.
  The same word also fooled the worker's `region_over_city` warning on this site's jobs
  ("אזור צפון -> הראל").
- **Source (traced):** `--dry-run --force --no-llm --out` prints
  `provenance: {address: "about page", city: "address line (gated)"}`, so it is deterministic and
  the LLM plays no part. `/about/harel-group` lists the group's subsidiaries, one per line, each
  followed by "למידע נוסף": `…בע"מ` / `הראל 60+ בע"מ` / `גמלא – הראל נדל"ן למגורים בע"מ`.
  `extractCompactAddressLines` (`scripts/lib/company-extract.ts`) accepts a line of 8–90 characters
  that contains a digit and is either comma-separated or at most 4 words long. `הראל 60+ בע"מ`
  qualifies (the digit is from "60+"), and `הראל` then passes the city gate. On the same page it
  also yields shareholder lines (`משפ' המבורגר: כ-42.4%`, `ציבור: כ-57.6%`), which the gate rejects.
  JSON-LD `Organization` has a name and no address.
- **What the company does publish:** the service charter (`/about/harel-group/service-charter`)
  gives "לכתובת אבא הלל 3 ת.ד. 1951 רמת גן 5211802" as a **mailing address**. The accessibility
  statement names a customer reception centre at "רחוב המרץ 11, פתח תקווה". Neither is stated as
  the head office, no ח.פ. appears on the pages read, and it is a group whose name is a place name
  (company-profile §5.3). **Owner decision: HQ address and city stay NULL.**
- **Fix (this site):** `PUT /company-profile?force=1` with `{"companyHqAddress":null,"companyHqCity":null}`.
  The city was **not** marked `operator:none`, because nobody has established that Harel publishes
  no HQ. The job ads say `בית הראל, רמת גן`, but that is a workplace, not an HQ statement
  (company-profile §7, rule 4). A `--force` re-capture would store the wrong value again, so the
  site's `adminNote` says not to run one.
- **Rule:** after a capture, if `companyHqCity` equals `companyName` or a word in it, or the address
  has no street and no house number, treat it as wrong until proven otherwise. A digit inside a
  company or product name ("60+") is enough for the compact-line rule.
- **Not done:** no extractor change (owner: out of scope for onboarding).
- **PARTLY FIXED 2026-09-03 in `817474c`** ("company-profile: city 14 -> 19 of 20, and repair
  three eaten regex escapes"), i.e. before this entry was written. The 8-90 char + digit gate
  is still `scripts/lib/company-extract.ts:821-822`, but four filters now follow at `:830-834`
  — a comma-less line over 4 words is rejected, as is one over 10 words, one with no letter,
  a `BRANCH_LINE` and a `CONTACT_TAIL`. So "accepts any 8-90 char line containing a digit" is
  no longer accurate. `הראל 60+ בע"מ` is short and comma-less, so this entry's own case is not
  covered by those filters; the rule above still stands. Verified at HEAD `e33bc85`, 2026-09-24.
- **Generalizes to:** employers named after places (הראל, כרמל, גלבוע, תבור, ארבל, עדן…).
  **Home:** `company-profile.md` §3.1; extractor follow-up in `scripts/lib/company-extract.ts`.

---

## LRN-API-8 — `/api/sites?search=` is silently ignored; a same-host duplicate check needs `urlSearch`

- **Date / site:** 2026-09-16 · news.ipvsecurity.com (duplicate check before create).
- **Signal:** `GET /api/sites?search=ipvsecurity&pageSize=10` returned `total 192` — every site,
  unfiltered, with no error. `urlSearch` is the parameter the route reads
  (`src/app/api/sites/route.ts`): `urlSearch=ipvsecurity` → `total 1`, `urlSearch=heara.co.il` →
  `total 1`. There is also `companyNameSearch`.
- **Why it matters:** §3 checks only variants of the exact URL (slash, http/https, www). A second
  jobs page for the same employer on another path or subdomain is invisible to it, and a guessed
  parameter looks like it worked because it returns rows.
- **Fix:** add a host-level check: `urlSearch=<registrable domain>`, plus `companyNameSearch` when
  the company is known. A hit is not automatically a duplicate (one host can serve several employers,
  and a company can have two boards) — look at it before creating.
- **Generalizes to:** every onboarding. **Home:** `addsite2.md` §3.

---

## LRN-WRK-20 — cloned listing cards that share an href collapse into one job at extraction

- **Date / site:** 2026-09-17 · iforc.co.il/jobs (`cmu5adrwg001501nvfmjtz6km`), staffing agency, 110 jobs.
- **Signal:** splitting three group postings into one job per track (owner rule 5) meant cloning the
  listing card per track in `setupScript`. The dry-run showed 110 items and 110 distinct ids, but a
  scrape would have saved 106: the three garage tracks, two diesel tracks and two warehouse tracks
  each shared one card.
- **Why:** `dedupeAndCapRawFields` (`worker/jobs/scrape.ts`) keys each item on
  `title_href || _detailUrl || externalJobId`. `title_href` is not the mapped `detailUrl`: for every
  mapped field the item extractor records the **closest `<a>` ancestor's href** as `<field>_href`, and
  when the item *is* the card anchor (`itemSelector: "a.post-card"`) every clone reports the same URL.
  A distinct `externalJobId` does not help — the URL wins the fingerprint.
- **Fix:** give each extra clone a distinct card href — `a.href + '#' + trackNo` — and keep the
  published link on a separate injected anchor mapped as `detailUrl` (`.__ai-url`, plain URL), so no
  stored link carries the fragment. Mirror the fingerprint in the dry-run
  (`distinct(title_href || id)`), not just `distinct(id)`: it printed `106 of 110` before the fix and
  `110 of 110` after.
- **Generalizes to:** any listing-only site where one card becomes several jobs — group postings,
  multi-branch cards, a card listing several roles. **Home:** `addsite2.md` *Job body rules* 5.

---

## LRN-SETUP-17 — a staffing agency prints its own office block in the ads: remove only lines proven to be the agency's

- **Date / site:** 2026-09-17 · iforc.co.il (איי פורס בע"מ).
- **Signal:** 15 of 110 job bodies ended with `"איי פורס בע"מ"` / `טל’: 03-9503184/5` /
  `פקס: 03-9503169` / `רכזת מטפלת: קארין`, or a bare office number. It is the recruiter's contact
  block, not job content — but two ads also printed mobiles (`052-7381515`, `057-7898260`) that could
  belong to the hiring company.
- **Fix:** attribute before removing. The site's own contact page listed only its *current* number
  (03-9699334); the ad numbers were confirmed as the agency's via public business listings
  (NetPage, B144). Then, in `setupScript`, drop a line only when it contains nothing but agency identity:
  the name, `טל/פקס/אור/פרטים נוספים בטל’` followed only by the agency's numbers, or the recruiter
  line. If the job prints **any** number not proven to be the agency's, leave that job's contact lines
  untouched — a half-removed block strips the context a hiring company's number needs. Remove after
  the requirements split (these lines also end a `דרישות` section), and diff: 38 lines left 15
  descriptions, nothing else moved.
- **Keep:** job meta that sits in the same block (`סוג משרה:`, `מגורי מועמדים:`, `מיקום המשרה:`).
- **Generalizes to:** staffing/placement boards (tigbur, Avivim, I Force). **Home:**
  `addsite2.md` *Job body rules* 6.

---

## LRN-SETUP-18 — requirements without a `דרישות` heading: classify the line, and know what must stay

- **Date / site:** 2026-09-17 · iforc.co.il. Owner correction: "ניסיון-חובה / ידע בקריאת
  שרטוטים-חובה" is a requirement even with no heading. Requirements went from 30 to 75 of 106 jobs.
- **Rule that held across all ~760 body lines** (read in full before writing it): a line is a
  requirement when it contains `חובה` or `יתרון`, or **starts** with a requirement word — ניסיון/נסיון,
  ידע, רישיון/רשיון, תעודה/תעודת, בעל/ת, יכולת, נכונות, זמינות, שליטה, הכרה/הכרת, מגורים,
  דובר/ת, עדיפות, נדרש/ת, יוצא/י, רצוי, גישה, `עם ידע/ניסיון`, `ראש גדול`. A bullet run (`* ▪ – •`)
  where at least half the bullets qualify moves as a block (catches trait bullets like
  "טיפוס ייצוגי, מכירתי…").
- **What must stay in the description** — each was a real misclassification first:
  - the role/intro line, even with a requirement inside: anything containing `דרוש`, and
    `X – חובה <3+ more words>` ("מנהלת חשבונות סוג 3 – חובה ידע בחשבשבת…");
  - a line stating working hours (`\d:\d\d`): "נכונות למשרה מלאה: 7:00-16:00" is the schedule;
  - pay and terms — but match pay narrowly: `שכר` inside the **role name** "חשבת שכר" hid that job's
    requirement bullets, and `תנאים` anywhere hid "בעלת תנאים סוציאליים טובים" under a real
    `דרישות:` heading. Strip `חשב\S*\s+שכר` first; treat `תנאים` as pay only at line start or beside `+`;
  - lines longer than ~150 chars.
- **Group postings first:** in a posting with numbered tracks the requirement lines belong to one
  track; split per track (rule 5) before classifying, or they merge into one misleading list.
- **Verify:** the multiset of description+requirements lines must be identical before and after —
  only the field may change — and read every moved line, not the count.
- **Generalizes to:** agency and small-employer boards that write ads as free lines. **Home:**
  `recipes/setupscript-patterns.md` §9.

---

## LRN-LOC-11 — "אזור" the town vs "the area of": a narrow context rule, and why the gazetteer can't be used

- **Date / site:** 2026-09-17 · iforc.co.il, job "חשבת שכר" — empty location field; the only place
  is prose: "לחברה מובילה בתחומה בארץ **הממוקמת באזור**, דרושה…".
- **The worker's contextual gazetteer is not the answer here.** With the location left empty it
  returned **`רווחה`** from "טיפול **ברווחה**" (welfare) in the duties — the same word LRN-LOC-8
  lists for site scripts, still unguarded in `extractLocationFromGazetteer`'s bare-`ב` pattern — and
  it never reads "באזור" as the town (`BARE_PREFIX_DENYLIST`, by design). So inject a value; never
  leave the field empty to "let the gazetteer decide" (LRN-LOC-10 step 4).
  **FIXED 2026-09-23 in `d2e9213`** ("worker: a published city survives a scrape that stops
  printing it; the gazetteer stops guessing") and its follow-up `16c974e` ("gazetteer: a two-word
  place name needs no anchor, and two qualifier words stop sneaking back"). The bare-word scan was
  replaced by an ANCHORED one — a single-word place is read only where the ad says it is the
  location (`worker/lib/normalizer.ts:574-692`, `extractAnchoredPlaces` at `:768-792`), while a
  name of two or more words is read unanchored (`RE_BARE_MULTIWORD`, `:715-745`). Measured at HEAD
  `e33bc85`: "טיפול ברווחה", "10-11 משמרות בחודש", "הממוקמת באזור," and "שרשרת אספקה" all now
  return `[]`, while "מיקום המשרה: חיפה" and "המחסן שלנו בבאר שבע" still resolve. Both
  `BARE_PREFIX_DENYLIST` and `BARE_PREFIX_MIN_LEN` are gone; the surviving denylist is
  `SCAN_DENYLIST = {שדרות, אזור}` at `worker/lib/locationNormalize.ts:109`. Note
  `locationNormalize.ts:102` still calls it "the mirror of normalizer.ts's BARE_PREFIX_DENYLIST",
  which now points at a constant that no longer exists. The inject-a-value rule above still
  stands on its own evidence.
- **Evidence for the rule:** this employer writes `הממוקמת ב<place>` ten times; the other nine are
  followed by a real place. "Area" usage always names the area after `אזור` ("באזור המרכז",
  "באזור רמלה והסביבה").
- **Rule (script-local, empty field only):** `ממוק(ם|מ\S*)\s+באזור\s*([,.](?!\s*(ליד|סמוך|בקרבת))|$)`
  → `אזור`. Any word after `אזור`, or a comma leading into "near X", is the area.
- **Two traps the unit cases caught before deploy:** `ממוקמ\S*` does not match masculine **`ממוקם`**
  — final mem `ם` is a different letter (CLAUDE.md); and "ממוקם באזור, ליד ראשון לציון" is the
  area, not the town. Write the negative cases first and break-test them.
- **Related, same site:** a card area `צומת כנות` is the junction next to the industrial zone —
  mapped to `אזור תעשיה כנות` (single yod, verbatim city.csv) by exact whole-field alias, never to
  `כנות` (the youth village), which is what the worker's own scanner returns for it.
- **Generalizes to:** any Hebrew place name that is also a common noun (אזור, שדרות, משמרות, רווחה).
  **Home:** `recipes/setupscript-patterns.md` §6; worker follow-up for the gazetteer.

---

## LRN-API-9 — `adminNote` is capped at 2,000 characters; a longer PATCH is a bare 400

- **Date / site:** 2026-09-17 · iforc.co.il.
- **Signal:** appending one more paragraph to a 1,791-character note returned `400` and left the note
  unchanged; the response names nothing useful. `updateSiteAdminNoteSchema` has
  `adminNote: z.string().max(2_000)` (`src/lib/validators.ts`).
- **Fix:** check `note.length <= 2000` before the PATCH and re-read the note after it. When a site's
  history outgrows the cap, rewrite the whole note compactly (keep every fact, drop narration) rather
  than truncating the oldest part. Since `setupScript` comments are the first thing cut under its own
  8,000-char cap (LRN-API-7), the admin note is where the *why* of a heavy script has to live — budget
  for it.
- **Generalizes to:** every site with a long remediation history. **Home:** `addsite2.md` §0.2.

---

## LRN-FORM-9 — OneTrust's cookie banner fakes `modalApplyButton`, forcing a false REVIEW

- **Date / site:** 2026-09-22 · careers.mobileye.com.
- **Signal:** `addsite-qa` returned `formStatus: NEEDS_MANUAL` → `REVIEW` ("apply form exists on page
  but isn't captured") on a page that has **zero `<form>` elements**, listing and detail alike. Tier-A
  was complete and `applyRate` was `1.00`, which is what makes it look like a real gap rather than a
  probe artefact.
- **Cause:** the probe's `modalApplyButton` flags any `a`/`button` matching `/apply|הגש|.../i` that is
  a `BUTTON` or has an empty/`#` href. OneTrust's consent UI ships
  `button#filter-apply-handler` ("Apply") inside `section#ot-fltr-modal` — the cookie-preferences
  *filter* dialog. It is permanently hidden (`0x0`, `offsetParent === null`), but the probe never
  checks visibility, and `modalApplyButton` is tested **before** `anyUrlApply || probe.externalApply`,
  so it masks a perfectly good per-item URL apply path.
- **Fix / arbitration:** confirm `probe.formCount === 0` and that the only APPLY matches with a real
  `href` are external, then classify as `URL` and record the evidence in `adminNote`. Identify the
  offending element rather than assuming: dump the matched `a`/`button` list with tag, class, href and
  `getBoundingClientRect()` — `button#filter-apply-handler` inside `#ot-fltr-modal` is the tell.
  Do **not** "fix" this by capturing the off-site ATS form (see below).
- **Do not capture a Lever apply form statically:** its custom questions are **per posting**
  (`cards[<uuid>][field0]`), so one capture is wrong for every other job on the board; `action` is
  `null` (JS submit); and it is hCaptcha-gated. The per-job apply URL in `applicationInfo` is the
  honest apply path.
- **Generalizes to:** every site running OneTrust consent (very common on Israeli enterprise careers
  pages) — and to any consent/filter UI with an "Apply" button. Suspect it whenever `NEEDS_MANUAL`
  coexists with `formCount: 0`. **Home:** `addsite2.md` §12 (REVIEW-is-remediable list).

---

## LRN-CO-1 — the employer is whoever the posting says it is; ownership is not employment

- **Date / site:** 2026-09-22 · careers.mobileye.com (corrected the same day, after shipping it wrong).
- **Signal:** 187 of 194 cards applied to `jobs.eu.lever.co/mobileye`; 7 applied to
  `comeet.com/jobs/mentee_robotics` under a department named "Humanoids - Mentee". Those 7 were first
  **excluded** (different ATS ⇒ assumed different employer), then **included** after research found
  Mobileye had acquired Mentee Robotics and the cards carried Mobileye's own About-us boilerplate.
  Both calls were made without reading a posting end to end. Both were wrong in method; the second
  was also wrong in outcome and briefly published 7 jobs under the wrong employer.
- **What the posting actually said**, in a dedicated element — `p.menteeDisclaimerText`, present on
  exactly those 7 cards and on none of the other 187:
  > "About this role: This position is with Mentee Robotics, which is owned by Mobileye but operates
  > as a separate company. Mentee Robotics manages its own recruitment process, and when you click
  > Apply you will be redirected to its recruitment system to submit your application."
- **The rule, in priority order.** An explicit employer-of-record statement in the posting **outranks
  everything else**: ownership language ("now part of X", "a X company"), parent boilerplate in an
  About-us block, the department name, and which domain hosts the board or the apply form. A parent
  can own a subsidiary, host its jobs, and write its About copy while the subsidiary remains the
  employer — that is the normal shape of an acquisition, not a contradiction.
- **An ATS host is evidence in NEITHER direction.** It identifies the recruiting tool. Do not derive
  identity from it (the standing vendor rule), and do not infer a *different* employer from a
  *different* one either — but do treat an odd host as a prompt to go read that posting in full.
- **Inspection method — this is where both errors came from, not from the reasoning:**
  1. **Read one full posting of the anomalous group end to end, untruncated.** A `.slice(0, N)` dump
     is how the disclaimer was missed; it sits at the very end of the body, just before "Apply now".
  2. **Enumerate blocks by element, not by heading.** A census of `p.textTitle` / `div.listItem > p`
     structurally cannot see a block that has no heading — `p.menteeDisclaimerText` has none.
  3. **Reconcile the counts.** The census printed ~200 unheaded blocks across 194 cards; an excess
     over one-per-card is unexplained content. That arithmetic was in the output and went unread.
  4. **Look for disconfirming evidence, not confirming.** Grepping for "mobileye" / "now part of"
     finds what you already believe. Search the anomalous cards for what makes them *different* —
     diff their block structure against a normal card.
- **When the answer is "separate employer":** onboard that employer as its own site from its own
  board, and keep the relationship in existing fields — the subsidiary's `companyAbout` (its own copy
  usually states the ownership) and a cross-referencing `adminNote` on both records, per §2.1. There
  is no parent/owner field on `Site`, and one must not be invented.
- **Generalizes to:** any careers board mixing ATS hosts — post-acquisition groups, holding companies,
  staffing arms, multi-brand employers. **Home:** `addsite2.md` §2.1 / CLAUDE.md vendor rule.

## LRN-SPA-13 — a Comeet board can leave `positionDescription` EMPTY and stuff the whole body into `positionRequirements`
- Date: 2026-09-22
- Site: comeet.com/jobs/mentee_robotics/6A.002 (Mentee Robotics)
- **Signal:** the netafim-shaped selector pair is a silent field-swap on this board.
  `[data-qa="positionDescription"]` exists but its text is **empty string**, while
  `[data-qa="positionRequirements"]` holds **every** section — Description,
  Responsibilities, Requirements, Advantages — as one blob. Mapping them the way
  `comeet--4q2aga` does would have shipped `description` empty and the entire job body,
  intro prose included, inside `requirements`. Both fields would still report fill 1.00
  once a fallback filled one of them, and `addsite-qa` reads length, not meaning, so
  nothing downstream flags it. The two boards are the same vendor and the same markup
  version; only the customer's field layout differs.
- **Fix:** do not map the two `position*` wrappers. Walk the per-section pairs instead —
  `[data-qa="requirementFieldTitle"]` (an h3) and its sibling
  `[data-qa="requirementFieldContent"]` — and route each block **by its own label**:
  requirements-class labels (`requirement|qualification|skill|advantage|nice to have|
  דרישות|כישורים|יתרון`) to `.__ai-requirements`, everything else to `.__ai-description`.
  Drop a label that only restates the field name (`Description`, `Requirements`); keep one
  that distinguishes content inside the merged field (`Responsibilities`, and especially
  `Advantages` — dropping it publishes a preferred item as a hard requirement).
- **The recipe now does this too — corrected 2026-09-22 in `8cb45a5`.** When this entry was
  written, `addsite2-recipes/spa-frameworks.md#comeet` merged *all* blocks into `description`,
  which violated the owner's job-body rule 1 (requirements live only in `requirements`, moved
  not copied). That snippet now routes by label itself — `spa-frameworks.md:138` ("**Do NOT
  merge every block into `description`**") and the `__ai-requirements` / `__ai-description`
  split at `:178-190` — so following the recipe verbatim is now safe. Verified at HEAD
  `e33bc85`, 2026-09-24.
- **Generalizes to:** every Comeet board — check which `data-qa` wrapper is actually
  populated before reusing another Comeet site's mappings — and to any ATS that exposes
  both coarse wrappers and per-section title/content pairs. The per-section pairs are the
  reliable source; the wrappers are customer-configurable.

---

## LRN-LOC-14 — the gazetteer's second stage reads the TITLE; and how to take a city from the ad body without a generic scan

- **Date / site:** 2026-09-22 · careers.nirlat.com (rebuild).
- **Signal:** `normalizer.ts`'s second-stage fallback fires when `location` is empty and joins
  **`[title, description, requirements]`** before running `extractLocationFromGazetteer`. Left empty it
  would have stored `נתניה` for JB-828 purely from its **title** ("לבורנט/ית מעבדה אוניברקול אתר נתניה").
  LRN-LOC-10/11 frame this fallback as a prose scanner; the title sits in the same string, which is what
  makes it bite a site whose titles name a branch.
- **Always inject a value, for every item.** A non-empty value is what skips the fallback — the literal
  `Unknown` sentinel when nothing is stated. Verify through `rawData`: the normalizer stamps
  `_enrichedFromDescription_location` whenever the fallback fires, so "no job carries that key" is direct
  proof, far cheaper than reading values back and guessing their provenance.
- **Taking the city from the ad body, safely — three parts, all load-bearing:**
  1. **A closed vocabulary, not the gazetteer.** This employer prints its own site list on the page
     ("אתרי ייצור והפצה : ניר עוז, באר שבע, אופקים, בני ברק, נתניה ונשר") — six names, each an exact
     `city.csv` entry. Two are ordinary nouns (`נשר` eagle, `אופקים` horizons), which is exactly why a
     general scan cannot be used here.
  2. **A cue, not a bare mention.** Only `מקום-` or `אתר...ב` / `בקיבוץ` followed **within 45 chars** by a
     listed city counts. A city named anywhere else in the prose is ignored.
  3. **A Hebrew-suffix guard.** `\b` does not fire after a Hebrew letter, so test the character after the
     match: without it `בנשרף` yields `נשר` and `נתניהו` yields `נתניה`. Break-test this one — the obvious
     negative ("העובד נשרף") never reaches the guard, because it contains no cue, so it passes with the
     guard removed and proves nothing. The case that bites is **cue + glued city**: "לאתר החברה בנשרף המפעל".
- **Precedence that came out of it:** explicit body statement -> region-id map -> `Unknown`; the title is
  never read. A multi-site ad joins with `/` and `normalizeLocations` splits it (JB-812 -> באר שבע + ניר עוז).
- **Region vocabularies map region-to-region only:** 1=אזור צפון 2=אזור דרום 3=אזור השרון 4=אזור מרכז
  5=אזור שפלה 7(באר שבע וצפון הנגב)=אזור דרום 8=אזור ירושלים, all verbatim `city.csv`. Never resolve a
  region id to a city it contains — region 7 is not `באר שבע`.
- **A manual `JobLocationOverride` outranks all of it** and persists across scrapes (keyed by
  `externalJobId ?? detailUrl`, written by `PATCH /api/jobs/:id`). A stored value that extraction cannot
  reproduce is therefore not necessarily a bug — check the override before "fixing" the config. JB-828 is
  exactly that case: extraction yields `Unknown`, the stored `נתניה` is an operator's override.
- **Two run warnings disappear once cities are stored:** `unknown_location_rate` and `region_over_city`
  ("stored a region while the ad names a city"). While they are present and deliberate, say so in the
  `adminNote` or the next person will undo the rule.
- **Generalizes to:** any employer that publishes a fixed list of its own sites (the closed vocabulary comes
  free), and any site whose titles carry a branch name.
  **Home:** `addsite2.md` §12 location gate; `recipes/setupscript-patterns.md` §6.

---

## LRN-WP-4 — a listing that renders 0 jobs to a visitor until a filter is submitted, while every row is already in the HTML

- **Date / site:** 2026-09-22 · careers.nirlat.com.
- **Signal:** the page looks empty. `triage` still said YELLOW (top cluster ~28) and the raw HTML
  holds all 8 `.career-row` rows fully populated, but a rendered probe showed every one at
  `display: none` and `#jobs` innerText containing only the filter. The theme script
  (`hello-elementor-child/js/careers.js`) ends with a literal `// hide all jobs at startup`
  → `jQuery('.career-row').hide()`, and its submit handler returns early when no filter is
  chosen — so a human sees nothing until they pick a region, and any count taken from the
  rendered page is 0.
- **Why it is not a blocker:** `domFieldExtract` clones the node and reads `textContent`, which
  is indifferent to `display:none`, and item collection has no visibility filter (only
  `clickLoadMoreUntilStable` checks `offsetParent`). Hidden rows extract at full fill.
- **Fix:** take ground truth from the server HTML, not the rendered page, and have `setupScript`
  append a `.career-row{display:block !important}` rule — an author `!important` rule beats the
  inline `display:none` that jQuery `.hide()` writes, so it works whether the script runs before
  or after the theme's `document.ready`. Keeps QA screenshots and any later human check honest.
- **Watch for the non-job row:** these hand-rolled boards often carry an evergreen "didn't find a
  suitable job?" CV-drop entry among the real ones (here `JB-717`, dated 2025). It has a job id
  and a date like any other row. Remove it in `setupScript`; do not publish it.
- **Generalizes to:** any hand-rolled WordPress/Elementor jobs board with a client-side filter.
  **Home:** `addsite2.md` §2.2.

---

## LRN-LOC-13 — a branch label is not a city: strip the prefix, expand the abbreviation, map to a closed set

- **Date / site:** 2026-09-22 · halilit.com (rebuild).
- **Signal:** the listing tags each posting with a branch label in a red (`#ff0000`) span —
  `סניף יפו`, `סניף ראשל"צ`, `מרלוג קדימה-צורן`. The previous build stored that string **verbatim**
  as `location`, so **6 of 7 jobs shipped a value absent from `city.csv`**. Extraction was
  "working" — fill was 1.00 and every other gate passed; only `verify-location-csv` sees this.
- **Three things make a branch label unusable as-is**, and all three appeared on one page:
  1. **A facility prefix** — `סניף` (branch), `מרלוג` (distribution centre). Never part of the name.
  2. **An abbreviation** — `ראשל"צ` → `ראשון לציון`. `city.csv` never carries the short form.
  3. **Punctuation and naming that differ from the CSV** — `קדימה-צורן` vs the CSV's `קדימה צורן`;
     `יפו` and `ת"א-יפו` are the **same branch** written two ways, and the CSV has neither alone,
     only `תל אביב-יפו`.
- **Fix:** map with a closed set of the employer's own branches, matched on a *distinguishing
  substring* rather than the whole string, so a quote or hyphen variant cannot miss —
  `ירושלים`→`ירושלים`, `ראשל|ראשון`→`ראשון לציון`, `קדימה|צורן`→`קדימה צורן`, `יפו`→`תל אביב-יפו`.
  An unlisted branch returns the `Unknown` sentinel; never guess a new one, and never fall back to
  the raw label. Chain-wide postings carry no branch and get `Unknown` too — which is also what
  keeps `normalizer.ts` from filling the field off the prose (LRN-LOC-14). See also LRN-LOC-12,
  which reaches the same "a branch label is not a town" rule from renuar.co.il's store directory.
- **Check the branch against the ad's own words before trusting the map:** here the `סניף ראשל"צ`
  posting says `סניף ראשון לציון` in its body and the `ת"א-יפו` posting says `סניף יפו` — free
  confirmation that the two spellings are one branch.
- **Generalizes to:** every retail/chain employer that tags postings by branch — the dominant
  pattern on Israeli store, clinic and logistics boards. **Home:** `addsite2.md` §12 location gate.

---

## LRN-WAF-7 — the interstitial's own element id can name the wrong gate

- **Date / site:** 2026-09-22 · halilit.com.
- **Signal:** the worker's default headless UA got a ~1.5KB Hebrew interstitial ("עבור לדף המבוקש")
  whose `documentElement` id is **`page_no_referer`**. The name says referer, so that is what gets
  tested — and it cost a full round of it: the page still served the interstitial on reload, with an
  explicit `Referer` header, and after a **real in-site navigation from the homepage** with
  `document.referrer` genuinely set. It is a **user-agent** gate: a desktop Chrome UA clears it
  outright (title `דרושים | חלילית`, 8 items, the stored `itemSelector` still matching).
- **Rule:** an interstitial's markup is the site author's guess at why you were stopped, not
  evidence. Vary **one input at a time** — UA first, since it is one config key and free to test —
  before believing a name. Confirm by the size/title flip, not by whether the request "worked".
- **Do not generalise the direction.** The same one-key fix points the opposite way on
  `tikshoov.co.il` (LRN-WAF-5), where the default headless UA passes and a spoofed desktop UA is
  403'd. Both sites are one `browserOverrides.userAgent` away from 0 jobs, in opposite directions,
  and neither reports an error — the run just returns nothing.
- **Generalizes to:** any site whose block page ships a descriptive id/class or body copy naming a
  cause. **Home:** `addsite2.md` §5 reachability; `recipes/waf-bypasses.md` §1.

---

## LRN-WRK-22 — a jobs board on another host cannot be bolted onto a Site, and `pageFlow[0].url` will not take you there

- **Date / site:** 2026-09-23 · careers.jnj.com (Workday-backed, ended SKIPPED for an unrelated
  reason — the apply flow requires account creation).
- **What was attempted:** `siteUrl` is `www.careers.jnj.com`, the jobs live on
  `jj.wd5.myworkdayjobs.com`. The Workday CXS API (`POST /wday/cxs/<tenant>/<site>/jobs`) is a
  clean source — 22 Israeli jobs, native `jobReqId`, ISO `startDate`, apply URL, full description,
  and the Israel location facets can be discovered from the response so a new site is picked up
  automatically. The plan was a `setupScript` calling it, with `pageFlow[0].url` pointing the
  worker at the board.
- **Three walls, in the order they are hit:**
  1. **`pageFlow[0].url` is inert.** Since `listingUrls` shipped (`LRN-WRK-21`) the extractor
     navigates to `listingUrlOverride ?? listingStep.url`, and the override is the resolved
     listing target — `[siteUrl]` when `_meta.listingUrls` is unset. So the run went to
     `careers.jnj.com`, ran the setupScript there, and the relative `/wday/cxs/...` fetch
     returned an empty body. **No error, no warning**: `COMPLETED`, 0 jobs, and a log line that
     reads like a bad selector. The tell is the diagnostics block — `"url"` is the site URL, not
     the pageFlow URL.
  2. **`_meta.listingUrls` is host-locked** (`siteService.ts`): `listingUrls: <host> is not the
     site's host`, because "a page on another host has had no robots/policy check of its own".
     That is the guard working, not an obstacle to route around.
  3. **The API cannot be read cross-origin.** Workday CXS sends no `Access-Control-Allow-Origin`;
     from `careers.jnj.com` both `cors` and `no-cors` fetches fail outright (CSP blocks the
     request leaving, and an opaque response would be unreadable anyway — the `LRN-WAF-3` ceiling).
- **Rule:** an ATS board on a different host is a **separate Site** (`addsite2.md` §2.1), never a
  `pageFlow`/`listingUrls` pointer from the wrapper record. Decide that before building, because
  `siteUrl` cannot be PATCHed — switching means a new record, hence a new id, hence a re-captured
  company profile and logo (`/logos/<siteId>.png`) and a policy review of its own.
- **Check it costs nothing to run first:** does the wrapper host serve the same jobs itself?
  careers.jnj.com does — `/en/jobs/?country=Israel`, same 22 postings, the req id in each detail
  URL (`/jobs/r-100261/...`), location and category on the card. Same origin, so no guard is in
  play. Look for that before proposing a restructure.
- **Generalizes to:** every Workday/Greenhouse/Lever board fronted by a marketing careers domain.
  **Home:** `addsite2.md` §2.1; `recipes/spa-frameworks.md` (Workday).

---

## LRN-SETUP-19 — doubling a backslash to protect it is what destroys it, and the run still looks green

- **Date / site:** 2026-09-23 · careers.jnj.com, while splitting a Workday description into
  description/requirements.
- **Signal:** the split silently stopped matching. Requirements went to **0/22 while every other
  field stayed at 1.00** and `verify-config` passed — the stored script was byte-identical to the
  one sent, because the corruption happened *before* the PUT.
- **Mechanism, and why the usual workaround fails.** CLAUDE.md records that every path that
  writes a file decodes escapes. The sharp edge is what that does to a *doubled* backslash:
  `new RegExp("^(Qualifications|Requirements)\b")` is the correct way to put a word boundary in
  a JS **string**, but the write path collapses the pair to one backslash, and JS then reads the
  survivor as the backspace escape. The regex ends up holding a raw 0x08 and matches nothing.
  A single `\s` in a regex *literal* passes through untouched, which is what makes the doubled
  form look like the safe one. It happened twice in one session — once via `node -e` string
  replacement (already forbidden), once via a quoted `cat <<'EOF'` heredoc.
- **Fix — remove the escape rather than defend it.** A word boundary was never needed:
  `s.toLowerCase().indexOf("qualification") === 0` is the same test with no backslash anywhere,
  and it rejects "Qualified …" as required. Prefer a plain string test, a character class, or
  `String.fromCharCode(n)` over any escape that has to survive a write.
- **Verify by bytes, not by eye.** `\b` and a raw backspace are indistinguishable in a terminal
  and in most diffs; `JSON.stringify` renders both as `\b`. Grep the written file for the control
  character itself (`s.split(String.fromCharCode(8)).length - 1`) and print every regex literal
  raw before trusting a script. Do it for `\s` and `\d` too — the same collapse drops those.
- **Generalizes to:** any `setupScript`, hook or config written from this environment.
  **Home:** `CLAUDE.md` (escape decoding); `recipes/setupscript-patterns.md`.
## LRN-LOC-12 — a retail chain's branch label is not a town, and matching a city.csv row does not make it one: use the chain's own store directory

- **Date / site:** 2026-09-22 · renuar.co.il/pages/stores-and-points-of-sale
  (`cmucn360g000h01rxmvvjy3cn`), 28 store-management postings on one accordion page.
- **Signal:** every title names a branch, not a town — `צוות ניהול לסניף <branch>`. Most
  branches happen to be town names; three are malls, and two of those resolved wrong on
  the first pass. `סניף ביאליק` reads as קרית ביאליק but is the Bialik *street* branch in
  רמת גן. Worse, `סניף גלילות` was stored as `גלילות` purely **because `גלילות` is a real
  `city.csv` row** — the branch (ביג פאשן גלילות, מחלף גלילות) is in **רמת השרון**.
- **The trap that matters:** a branch label that *is* a canonical entry looks verified and
  is not. `verify-location-csv` passes it, `addsite-qa` never reads location values, and
  the gazetteer only fills an EMPTY location — so a plausible-looking near-miss ships with
  every gate green. Treating "it's in city.csv" as confirmation is the whole bug.
- **Fix — the chain publishes the answer.** A retail chain almost always has a store
  locator, and it is machine-readable: renuar's `/pages/store-locator` is a **Stockist**
  widget (`data-stockist-widget-tag="map_83p8nnj3"`), and
  `stockist.co/api/v1/<tag>/locations/all` returns all 88 branches as JSON with an explicit
  `city` per row. One request settled every ambiguous branch and confirmed the rest:
  קניון איילון → רמת גן, ביג גלילות → רמת השרון, and it showed the chain runs **both** a
  רמת גן Bialik branch and a separate קרית ביאליק one. Look for the locator page and its
  data source (Stockist, Storemapper, a `stores.json`, a Google-My-Maps KML) **before**
  reasoning about branch names at all.
- **Priority, per posting:**
  1. the chain's **own store directory** (explicit city per branch);
  2. the town named in the **ad's own body** (`בסניף ביאליק ברמת גן`, `רשת OUTLET בהרצליה`);
  3. the **page's own section heading** when a branch is still unresolved — these pages
     group postings under regions (`מרכז`, `השרון`, `דרום ואילת`) that alias onto the
     canonical `אזור *` entries. A region the site itself asserts is honest
     under-specification, and strictly better than a town nobody stated;
  4. `Unknown`.
  **Never** step 2-and-a-half: "the branch label is in `city.csv`, so use it."
  Build the result as an explicit title→city table, not a runtime scan — prose scanning for
  Hebrew city names is banned for the `\b`/final-letter reasons in `LRN-LOC-2`, and a table
  degrades an unseen title to (3) then (4) instead of to a wrong town.
- **Watch for the title/body contradiction.** `3813 - צוות ניהול לסניף רחובות` has a body
  reading `בסניף רמלה` — a stale copy of the *other* 3813 posting (`סניף רמלה`), same req
  number and identical boilerplate. Rule 2 alone would take רמלה and be wrong; the store
  directory (a real רחובות branch) broke the tie for the title. When body and title
  disagree, the **per-posting title** wins, the directory confirms it, and the contradiction
  goes in the `adminNote`; the employer's text is still published as-is.
- **Generalizes to:** any chain listing one posting per branch — fashion/food/pharmacy
  retail, bank branches, clinics, gyms. Assume the branch label is a *store* name until a
  directory or the ad itself says otherwise.

---

## LRN-CO-2 — one employer whose jobs are split across several listing pages is ONE site, not one site per page

- **Date / site:** 2026-09-22 · renuar.co.il (`cmucn360g000h01rxmvvjy3cn`).
- **Signal:** the careers hub `/pages/<drushim>` holds no jobs at all — it links three
  department listings: stores (28 jobs), head office (8), logistics (1). Onboarded from
  one of those leaves the other two invisible; onboarding each of them creates three
  sites.
- **Why three sites is the wrong answer:** there is no Company model. Company identity is
  denormalised onto `Site` — `companyName`, `companyAbout`, `companyHqCity`, and the logo
  at `/logos/<siteId>.png` — and `Job` reaches its employer only through `siteId`. The
  public jobs site reads that row directly. Three sites therefore publish the same
  employer three times, each with its own separately-captured profile and its own logo
  file, and nothing downstream merges them. `companyName` is a nullable, un-indexed,
  non-unique string: it is not a key and never has been. (Checked the day this shipped:
  of 144 ACTIVE sites, zero shared a `companyName` — the fleet had never done this.)
- **Fix:** `_meta.listingUrls` — one site, N listing pages, every job on the one row.
  `siteUrl` becomes the hub (what the dashboard shows, what `company-profile` derives the
  homepage from) and is no longer scraped; the list is the complete target set. Contract
  and failure modes: `LRN-WRK-21`. Home: `addsite2.md` §2.3.
- **Identify the pages by CONTENT, not by link text.** renuar's three links happened to
  share one CTA (`לרשימת המשרות`), and a reworded CTA would have silently returned two
  pages instead of three — a whole department dropped with nothing to notice it. Fetch
  each same-host candidate and keep the ones carrying repeating job markup.
- **Dedup had to learn it too:** the exact `?siteUrl=` filter now matches a site's own URL
  **or** any entry in its `_meta.listingUrls`, so onboarding a company's second department
  page resolves to the parent. The caller must compare the returned row's `siteUrl` with
  what it asked for: a mismatch means "covered by that site", and onboarding onto that row
  would PUT a single-URL config over the parent and stop publishing its other pages.
- **Generalises to:** any employer whose careers site splits jobs by department, brand or
  region — retail chains, hospital groups, municipalities. Distinguish it from `LRN-SPA-4`
  (a wrapper page embedding ONE board — onboard the board instead) and from `pagination`
  (pages 2..N of one listing).

---

## LRN-WRK-21 — a listing page that goes dark must refuse to publish, not shrink the site

- **Date / site:** 2026-09-22 · shipped with `LRN-CO-2` (renuar.co.il).
- **The hazard:** persistence is delete-all-for-siteId then insert
  (`worker/jobs/scrape.ts`, scheduled transaction and the manual path alike), so the
  merged set from every listing page IS the site's published state. With 28/8/1 across
  three pages, the head-office page returning 0 leaves 29 of 37 — and nothing notices:
  `isSuspiciousDrop` wants under half (18), `job_count_drop` wants a 30% fall (25.9). The
  scrape reports success, eight published jobs are deleted, and the only trace is a
  smaller number.
- **Contract (`worker/lib/listingTargets.ts`, all of it pure and unit-tested):**
  - the list REPLACES `siteUrl`; unset means `[siteUrl]`, i.e. every existing site is
    byte-identical;
  - every page is merged BEFORE the single dedup and the single persist — never persist
    per page, or one failing page wipes the others;
  - **all** pages failed → throw, exactly as a single-page site always has (the FAILED
    path, breaker evidence intact);
  - **some** failed → `COMPLETED` + `listing_url_failed`, nothing deleted, nothing written;
  - a page that loaded but yielded 0 (or under half) where it had rows → same refusal,
    `listing_url_empty`. Per-page thresholds are `minPrevious: 5`, not the site-level 10:
    an 8-job department must trip it;
  - rows tagged with a page no longer configured → `listing_urls_removed` on a scheduled
    run; a manual run proceeds with a warning, which is how an operator retires a page;
  - all three are soft failures (`sweepSelection.ts`): never the breaker, never a success,
    named in the attention queue.
- **Where the baseline comes from:** each raw record carries `_listingUrl` into
  `Job.rawData`, counted back with one grouped query. No column, no migration. Rows written
  before the feature have no tag and group under `""` — never mistaken for a removed page.
- **Two smaller traps closed on the way:** `runSetupScript` restored the 30 s default
  timeout only on success, so a failing script on page 1 left 90 s defaults for every later
  page; and the RAW dedup's last-resort `title|location` tier now includes the page,
  because two departments can legitimately both advertise "נציג/ת שירות". Raw tier only:
  the normalized dedup still keys on `id || url || title|location`, so a site mapping
  neither an id nor a URL can still fold such a pair — as it always could. Not a
  regression; the `per_url_counts` figure is likewise "kept after the raw dedup", not
  "written".
- **Generalises to:** any future change that makes one run write on behalf of several
  sources. The rule is that a partial view of the truth must never become the whole
  published state.

---

## LRN-AGE-2 — for a careers PAGE the feed's `lastBuildDate` is the wrong staleness signal; its own sitemap `lastmod` is the right one

- **Date / site:** 2026-09-23 · safelog.co.il/דרושים, two roles with no dates anywhere.
- **Signal:** LRN-AGE-1 lists `/feed/` `lastBuildDate` first among the cheap staleness probes. On a
  WordPress site the main feed carries **posts**, and a careers page is almost always a **Page**, which
  never appears in it. Here the two disagreed by nearly a year: the feed last built **2025-08-07**,
  while the careers page's own `page-sitemap.xml` entry reads **`lastmod` 2024-10-27** — ~23 months
  before the rebuild. The feed number is about the blog; only the second is about the ad you are
  publishing.
- **Do this:** fetch `/sitemap_index.xml` → `page-sitemap.xml` and read the `lastmod` of the careers
  URL itself. Yoast and the WP core sitemap both expose it, it is one request, and it is the date the
  owner is actually being asked to judge. Keep the feed as a fallback for sites with no sitemap, and
  say which signal a number came from when you report it — "the site" and "this page" are different
  claims.
- **Still not a SKIP rule** (LRN-AGE-1): record the figure in the `adminNote` and let the owner decide.
  safelog: all gates green, owner chose ACTIVE on 2026-09-23 with the 2024-10-27 `lastmod` recorded and
  the roles flagged for confirmation.
- **Generalizes to:** every dateless WordPress careers page, which is most of them.
  **Home:** `addsite2.md` §10.

---

## LRN-LOC-15 — `city.csv` is not a complete gazetteer: a missing city is sometimes a gap in the list, not a bad value in the ad

- **Date / sites:** 2026-09-22 halilit.com, 2026-09-23 safelog.co.il — two independent gaps in two days.
- **Signal:** the ad names a real, unambiguous Israeli city and `verify-location-csv` still has nowhere
  to put it. Two distinct shapes:
  - **Absent, with a same-name neighbour that is a DIFFERENT locality.** J&J and halilit both sit in
    **Yokneam Illit**; `city.csv` has only `יקנעם (מושבה)`, the adjacent moshava under a different
    council. Storing it would be wrong, so those jobs store nothing.
  - **Absent alone, present only inside a COMBINED row.** safelog's full-time role says `באזור לוד`;
    there is no `לוד` and no `רמלה` — only `רמלה לוד`. The combined row does cover the place, but it
    also names a town the ad never mentions.
- **These are different decisions and only the owner can make the second one.** Storing nothing is
  always safe. Storing the combined row is defensible but publishes a name the employer did not write,
  so surface the specific **job + city** and let the owner choose — do not pick the nearest-looking row
  silently, and never invent a spelling to make the gate pass. safelog's owner chose `רמלה לוד`
  (2026-09-23); the Yokneam jobs were left empty.
- **Editing `city.csv` is a third option and a product-data change**: the public site's city filter reads
  it, so a new row affects every site, not the one in front of you. Never unprompted.
- **Check before you conclude a value is un-storable:** grep the CSV for the bare name *and* for rows
  containing it (`grep -n <name>`), since the entry may be a pair (`רמלה לוד`), a region (`אזור דרום`)
  or carry a qualifier (`יקנעם (מושבה)`).
- **Generalizes to:** any ad naming a city in the Ramla/Lod, Yokneam or similar pairs, and to every
  future `verify-location-csv` exit 2 — ask "is this the ad's fault or the list's?" before fixing.
  **Home:** `addsite2.md` §12 location gate.

---

## LRN-SPA-14 — "no jobs in the HTML" does not mean there is an API: prove it with an EMPTY request log before hunting one

- **Date / site:** 2026-09-23 · xnes.co.il/jobs (Nuxt/Vue, הפניקס בית השקעות). The site had been
  parked with the note "jobs load on-demand via an API keyed by company+category that is not exposed
  without multi-step interaction. Needs a dedicated API-reverse-engineering onboarding." That premise
  was wrong, and the whole cost of this site was spent discovering that.
- **What is actually true:** all 20 open positions ship inside the page's own `window.__NUXT__`
  payload. The category `<select>` filters them **client-side**; choosing a category and clicking
  search renders the result cards while the network log stays **completely empty**.
- **The one-minute test that settles it, and should come first:** drive the real control, then read
  the request log. Cards rendered + zero requests = the data was already in the page; go read the
  payload. Cards rendered + a request = that request is the API. Either way you are done. Do this
  *before* reading bundles or guessing endpoints.
- **Two things that waste the hour if you skip it:**
  - `__NUXT__.state.<store>` being empty (`career.positions: []`) looks like proof the data has not
    arrived. It only means the *Vuex store* is empty — the payload can still carry the jobs as
    component props elsewhere in the tree. **Walk the whole `__NUXT__` object** for objects carrying a
    known job key (here `jobNumber`), rather than trusting one store path.
  - `__NUXT__.config` publishes real-looking bases (`axios.browserBaseURL: "/api/v1"`,
    `middlewareAPI`, `servicesAPI`). Guessing paths under them returns the SPA's **404 page with a 404
    status and a 240KB HTML body** — which reads as "wrong path, keep guessing" forever.
- **Reading the payload is also the better config:** no fetch, no CORS, no pagination, nothing to
  re-discover when the vendor changes an endpoint. `setupScript` walks `__NUXT__`, dedupes by the job
  number and injects one row per job.
- **Generalizes to:** every Nuxt/Next/Vue/React careers page whose HTML has no job markup.
  **Home:** `addsite2.md` §6.2; `recipes/spa-frameworks.md`.

---

## LRN-COV-6 — a sitemap is not the list of OPEN jobs, and building from it publishes years of closed roles

- **Date / site:** 2026-09-23 · xnes.co.il — `sitemap.xml` lists **137** `/jobs/<slug>/` pages;
  **20** are actually open.
- **Signal:** the sitemap is the obvious way out when a listing has no links, and every one of those
  137 pages still returns 200 with a full server-rendered posting, `jobNumber` and all. Nothing about
  fetching one tells you the role is closed. Their `lastmod` values run from 2025-01 to 2026-09 —
  the giveaway, and only visible if you look at the distribution rather than the newest few.
- **Rule:** a sitemap answers "what pages exist", never "what is open". Take the open set from what
  the site's own careers UI shows — here the page payload the search filters — and use the sitemap
  only to corroborate (matching the 20 open slugs against it gave a useful freshness range,
  2026-03-30..2026-09-15, for a board that prints no dates).
- **Cross-check before trusting either:** the count the employer's own search returns is ground
  truth; a sitemap-derived count that is several times larger is closed roles, not better coverage.
  Shipping 137 here would have published ~117 dead postings that every gate would have passed, since
  each has a title, a body, an id and an apply form.
- **Generalizes to:** any site where the listing is JS-rendered and the sitemap looks like a shortcut.
  **Home:** `addsite2.md` §6.2 coverage gate; read alongside `LRN-COV-5`.
## LRN-HQ-5 — a Hebrew one-letter prefix splits a two-word city, and the shorter half is also a real city

- **Date / site:** 2026-09-23 · domicile.co.il (`cmue21era000e01r0zjchpkcu`), דומיסיל יבוא וייצוא.
- **Signal:** `/company-profile` returned `WRITTEN COMPLETE … address city=ברק`. `ברק` is a real
  `city.csv` entry (line 973, the moshav in the Yizre'el valley), so the city gate passed and the
  status came back COMPLETE. The employer is in Bnei Brak and Gezer; it has nothing to do with ברק.
- **Mechanism (reproduced, deterministic, no LLM):** the about page prints
  `אולם התצוגה המרכזי של דומיסיל שוכן ברחוב לח"י 24, במתחם העיצוב בבני ברק …`. The city name
  carries the ordinary Hebrew preposition ב-, so the segment reads `בבני ברק`, not `בני ברק`.
  `matchCityInAddress()` (`scripts/lib/city-csv.ts`) cannot match the two-word entry against the
  prefixed first word, scans on, and finds the **second** word `ברק` — itself a city.csv entry.
  Strip the prefix and the same call returns `בני ברק` correctly:

  ```
  matchCityInAddress('במתחם העיצוב בבני ברק')  -> "ברק"        # wrong, and gate-clean
  matchCityInAddress('במתחם העיצוב בני ברק')   -> "בני ברק"    # correct
  ```

  This is the `\b`-after-Hebrew problem from CLAUDE.md in a new place: the prefix is not a word
  boundary, so the longest-match preference never gets a chance to fire.
- **Blast radius (measured against the live list):** **100 of 1,367** `city.csv` entries are
  multi-word names whose tail is *itself* a `city.csv` entry, and every one of them resolves to
  the WRONG city when the address carries a one-letter prefix — `בני ברק`→`ברק`, `גן יבנה`→`יבנה`,
  `עין כרמל`→`כרמל`, `הר חברון`→`חברון`, `תל קציר`→`קציר`. `בני ברק` is the one that matters:
  it is a major employment centre, so it appears in real HQ addresses constantly.
- **Why the gates cannot see it:** the city gate proves a city EXISTS, never that it is THIS
  company's (company-profile §5, the same blind spot as `LRN-HQ-4`). `verify-location-csv` reads
  job locations, not `companyHqCity`, so nothing on the onboarding path looks at this value at all.
- **Second, independent error on the same site:** the address the capture picked was the flagship
  **showroom**. The about page says in plain words that the logistics centre *and the head offices*
  moved from Modiin `לאזור התעשייה החדש בכניסה לקיבוץ גזר`. A company can publish several
  addresses; the capture takes a compact one, not the one labelled as the head office.
- **Fix (this site):** `PUT /company-profile?force=1` with `companyHqAddress` only
  (`אזור התעשייה בכניסה לקיבוץ גזר`), so the industrial-zone detail lives in the address. The
  address has no provenance protection (`LRN-HQ-2`); the site's `adminNote` says so.
- **Root cause of the fallback, and the owner's decision:** `גזר` was **absent from `city.csv`**
  altogether — while its Gezer-council neighbours `קיבוץ חולדה`, `קיבוץ נען`, `כרמי יוסף`,
  `בית חשמונאי`, `יציץ` and `פדיה` were all listed, so it was an omission, not a policy. That one
  missing row produced BOTH symptoms: the three logistics jobs fell back to the region
  `אזור שפלה`, and the HQ city could not be stored at all, because `saveCompanyHqCity()` refuses
  a region by design (*"A job may be in a region; a company headquarters is at an address"*,
  `src/services/siteService.ts`). **Owner: add the city.** `גזר` was appended to
  `CSV files/city.csv` on 2026-09-23 and `worker/data/il-places.ts` REGENERATED
  (`npx tsx scripts/build-il-places.ts` — the file is auto-generated, never hand-edited);
  `src/lib/locations.test.ts` runs in CI and asserts the two lists are identical in both
  directions, so a one-sided edit fails the build (verified by breaking it deliberately:
  `FAIL: no city.csv entry outside IL_CANONICAL (offenders: גזר)`, exit 1). The employer's own
  wording stays in the description; only the place goes in `location`.
- **A new city.csv row does NOT take effect on the server until a deploy.** The three job
  locations updated to `גזר` on the very next scrape — the worker passes a value its gazetteer
  cannot resolve through VERBATIM rather than dropping it, so the scrape write path never
  consulted the new list. But `PUT /company-hq-city` validates against the `IL_CANONICAL`
  **bundled into the deployed build** (deliberately — `city.csv` is absent from the
  `output: "standalone"` image), so it answered
  `400 Not a known city: "גזר"` with the row already in the repo. Same for the dashboard's manual
  job-location edit (`resolveLocationInput` → `jobService`). The city therefore lands in two
  steps: the scraped values immediately, the operator-authored HQ city only after
  `./deploy.sh haide-prod`. Until then leave `operator:none` in place — it is what stops a
  `--force` re-capture writing `ברק` back over the null.
- **Rule:** after a capture, re-read the address the city came from. If the city is a *short* name
  and the address contains a longer `city.csv` entry ending in that same word, the prefix split it.
  And check whether the address is labelled as the head office at all.
- **Not done (owner's call):** no extractor change — stripping a leading ב/ל/מ/ה/ו/כ/ש before the
  scan, or preferring the longest `city.csv` match in a segment, would fix all 100, and neither is
  an onboarding change. No fleet sweep of stored `companyHqCity` values.
- **Generalises to:** every Israeli address written in running prose rather than as a postal line —
  which is most about pages. **Home:** `company-profile.md` §3.1 / §5.

---

## LRN-CO-3 — the URL you asked for is not always the URL you got: compare the final URL before believing a lane

- **Date / site:** 2026-09-23 · se.com (Schneider Electric Israel), rebuilt and retired.
- **Signal:** the stored listing URL `/il/he/about-us/local/open-positions` still answers 200, so nothing
  looks wrong — but it **redirects** to `/il/he/about-us/careers/overview/`, a marketing-plus-FAQ page with
  zero postings. `triage` reported **YELLOW, topCluster 32**, and those 32 are the `qds-web-megamenu-*`
  navigation. Taken at face value, §3 builds a config against a mega-menu, the completeness gates fail it
  for having no description and no apply path, and a site that should simply be retired instead lands in
  SKIPPED/REVIEW carrying a config that pretends to work. This is the §2.3 hub trap arriving by a different
  route: not "the hub has no jobs" but "the page you configured no longer exists".
- **Cheap check, worth making routine:** after rendering, compare `location.href` with the URL you
  requested. `reach` and `triage` both describe the page they *land on*, and neither says a redirect
  happened. A changed path on a site that was onboarded months ago means the employer reorganised its
  careers section — re-discover before building, do not tune selectors.
- **Corroborate with the page's own words, not the cluster count:** here, 0 job cards, `דרושים` present
  **0** times, and leftover unfilled CMS placeholders (`ZZ_Paragraph Title`, `ZZ_Paragraph Content`) showing
  the page is only half-maintained. Those are the signals that a listing is gone; `topCluster` is not.
- **Then run the §2.1 embedded-ATS gate before SKIPPING** so the retirement is not a false negative. It was
  empty here: the only iframes were analytics (`s.company-target.com`, `csxd.contentsquare.net`).
- **Generalizes to:** every `--force` rebuild of a site that last scraped months ago. A redirect is the
  most likely reason an old careers URL "still works" but yields nothing.
  **Home:** `addsite2.md` §2 triage / §5 reachability.

---

## LRN-WAF-8 — Akamai "Access Denied / errors.edgesuite.net" blocks the whole host, and a desktop UA does not help

- **Date / site:** 2026-09-23 · careers.se.com (Schneider's global Phenom-style portal).
- **Fingerprint:** a ~200–400 byte body reading `Access Denied — You don't have permission to access "<url>"
  on this server.` with `Reference #18.<hex>.<epoch>.<hex>` and an `https://errors.edgesuite.net/...` link.
  `edgesuite.net` is Akamai; the reference number is what their support asks for.
- **What distinguishes it from the UA gates:** it is **host-wide and client-wide**. Every path was 403 —
  `/`, `/jobs`, `/professionals`, and the country-filtered search URLs — from bare `curl` **and** from
  headless Chrome carrying a current desktop UA, identically. So it is neither `LRN-WAF-1` (default UA
  rejected, desktop UA clears) nor `LRN-WAF-5` (default UA passes, spoofed desktop UA 403s): swapping the
  UA changes nothing in either direction, and there is no point spending a remediation attempt on
  `browserOverrides`. Note the denial echoes the URL as `http://` even for an https request, and truncates
  at the `?`, so query-string variants are not being evaluated separately — the host is simply closed.
- **What to do:** do not burn the budget. Record the reference id and the paths tried, and treat the host
  as unbuildable until someone tests from a residential IP or the employer is asked. Where the blocked host
  is a *different* host from `siteUrl` — as here — this compounds with `LRN-WRK-22`: it could only ever be
  its own Site, and that Site is not buildable today either, so retiring the local record is the honest
  outcome rather than parking it.
- **Generalizes to:** any global-enterprise careers portal fronted by Akamai.
  **Home:** `recipes/waf-bypasses.md`; read with `LRN-WAF-1` and `LRN-WAF-5`.

## LRN-WAF-9 — the OTHER Akamai mode: a transport reset, fixed by CLIENT HINTS (not a UA), which reach/triage never send

- **Date / sites:** 2026-09-23 · www.dhl.com/discover/he-il/Career-at-DHL/Career-at-DHL2
  (`cmue8d3wb000r01r0tsmwqiig`, **ACTIVE**, 9 jobs) · prior art: osem-nestle.co.il
  (`cmpo335in002p01mvesps38uj`, SKIPPED for `needs account to apply`, NOT for Akamai).
- **Read with `LRN-WAF-8`, and do not let it end the investigation.** That entry is Akamai too,
  and its "a desktop UA does not help" is right **for its own mode**: a host-wide **403** with a
  200-400 byte `Access Denied` body and an `errors.edgesuite.net` reference id. This is the other
  mode, and the verdicts are opposite. Tell them apart by what comes back:
  - a short 403 **body** -> `LRN-WAF-8`, host closed, do not spend the budget;
  - **no HTTP status at all** — `net::ERR_HTTP2_PROTOCOL_ERROR` in Chromium, `Recv failure:
    Connection was reset` in curl, after the TLS handshake -> **this one, and it is fixable.**
  Client hints were never tried on careers.se.com. A 403-with-body points at an IP/geo deny rule
  rather than a fingerprint, so it is probably still unbuildable — but that is one cheap probe,
  not an assumption.
- **Signal:** `triage` returns `lane: RED, bytes: 0`, which reads like a dead host. The host is
  fine — `curl https://www.dhl.com/` returns a 302 from `AkamaiGHost`. There is no challenge HTML
  at all, so nothing in `challenge-detect.ts` can ever match it; that file has no Akamai marker
  either, and for this mode a text marker could not help.
- **The fix: send the client hints.** `browserOverrides.userAgent` ALONE is reset. The UA plus the
  full desktop-Chrome header set passes — copy it **verbatim** from `sites/osem/config.json`:
  `sec-ch-ua`, `sec-ch-ua-mobile`, `sec-ch-ua-platform`, `upgrade-insecure-requests`, the full
  browser `accept`, and `accept-language`. Neither half works alone; it is the combination.
  Worker-confirmed from the box (egress 194.88.110.149), three arms: default -> reset, UA-only ->
  reset, UA+hints -> **200, 9/9 jobs, 3/3 runs**, byte-identical each time.
- **Why the fleet cannot find this by itself.** `reach`/`triage` retry exactly once, with
  `REAL_UA` + `HE_HEADERS`, and `HE_HEADERS` is `{accept-language}` alone
  (`scripts/addsite-batch.ts:1162-1164`). No client hints, so the retry is reset too and the site
  is written off RED. The technique had sat in the repo for ~4 months in ONE hand-built local file,
  never promoted to a recipe, a doc or any `sites/_configs/` entry — `sec-ch-ua` appears in none of
  them. Prior art beats a fresh SKIP: **grep `sites/` before concluding.**
- **Headful is a DIAGNOSTIC, never a verdict.** `headless: false` returns 200 from the same IP.
  Worth one probe for what it RULES OUT — not an IP block, not a region block, not a dev-IP false
  positive (`LRN-WAF-5`). It is never evidence the worker can get in (`LRN-WAF-4`).
- **THE TRAP — re-analysing such a site DESTROYS it.** `worker/jobs/analyze.ts:66` calls
  `createPage(browser)` with **no** overrides (so does `policyReview.ts:75`); only SCRAPE passes
  them (`scrape.ts:3361`). So the analyzer can NEVER load the host. Worse, `PATCH status:ANALYZING`
  deliberately clears `configLocked` (`siteService.ts:233`), and the analyzer nav-failure path then
  sets FAILED (`analyze.ts:126`) **and deletes every job** (`analyze.ts:122`) — the careers.iec.co.il
  loss recorded at `siteService.ts:283-284`. A successful analysis always ends REVIEW
  (`analyze.ts:376`), so **FAILED proves navigation threw**. Expect the reactivation analysis to
  fail; that is normal here. `PUT /config` restores `configLocked: true` (`siteService.ts:433`) and
  that lock is the only protection — say so in the adminNote. Nothing automatic clears it: the
  nightly sweep is SCRAPE-only over ACTIVE|REVIEW (`sweepSelection.ts:83`) and never analyses.
- **`company-profile` is NOT affected — it is the worked example of the fix.** It reads
  `_meta.browserOverrides` back off the site config and hands them to the same `createPage`
  (`scripts/company-profile.ts:1091-1096`), so once the hints are in the config it just works: DHL
  captured COMPLETE, real `il-he` about copy and the genuine wordmark (1872x260, valid PNG magic
  bytes). Do **not** confuse this with `LRN-WAF-5`, where the block is by dev IP and no header can
  fix it. Two call sites are all that is missing.
- **Build notes (DHL):** one page, 9 jobs in an AEM accordion `div.cmp-accordion__item`, no per-job
  URLs -> `pageFlow: []`, no `detailUrl`, `externalJobId = h-<djb2(title|department)>` (recipe S3,
  as domicile). Email apply -> `formCapture: null`, `formStatus: EMAIL`. Departments from the `h3`
  group headings above each accordion block.
- **Multi-city rows: emit a COMMA, not a slash.** `normalizer.ts:985-990` rewrites a slash plus its
  surrounding spaces into one space BEFORE `normalizeLocations()` splits on comma/pipe/slash/
  semicolon (`locationNormalize.ts:319`), so a slash can fuse two cities into one off-vocabulary
  string. A comma survives both stages: `איירפורט סיטי, יד בנימין` resolves to two verbatim
  `city.csv` values. Today the fused form still resolves via `scanPlaces`, which the proposed
  opt-in strict mode would remove — so this is a latent break, not a cosmetic choice.
- **Generalizes to:** any Akamai-fronted host (`Server: AkamaiGHost`) that resets rather than
  answering. **Home:** Step 3 reachability / `recipes/waf-bypasses.md`; read with `LRN-WAF-8`.

## LRN-API-10 — `GET /api/sites/:id/config` has no `siteUrl`, so a payload rebuilt from it ships `capturedOnUrl: undefined` and the scrape writes NOTHING

- **Date / site:** 2026-09-24 · naamat.org.il (`cmqiakw6s000u01t1kc3s0g1d`), rebuilding a live config.
- **Signal:** the PUT returns 200, `verify-config` passes, the scrape is accepted, runs for ~50s and
  ends **`COMPLETED`** — with **`jobCount: 0`**. No error, no warning, no failureCategory.
- **Root cause:** that route returns **`{ fieldMappings, pageFlow }` and nothing else** — in
  particular **no `siteUrl`**. Rebuilding the payload from its response (the natural thing to do,
  because you want to carry `formCapture` / `pagination` / `itemSelector` over verbatim) makes
  `live.siteUrl` `undefined`, so every listing-scope field goes out with `capturedOnUrl: undefined`.
  The worker routes fields to the listing or the detail page BY `capturedOnUrl` (`LRN-WRK-9`); with
  none set, nothing is listing-scope, the listing yields no rows, and the run writes zero jobs.
- **Why nothing looks wrong:** `verify-config` checks `itemSelector`, field NAMES and the form-field
  count — it never looks at `capturedOnUrl`. And the undersize guard correctly refuses the empty
  write, so the site KEEPS its previous jobs and the dashboard still shows the old count. Every
  surface says healthy. The only tell is `jobCount: 0` on a run whose status is `COMPLETED`.
- **Fix:** take the listing URL from `pageFlow[0].url` (or from the site row via the list route),
  and assert every mapped field has a non-empty `capturedOnUrl` before sending the PUT. That turns
  a silent zero-row scrape into an immediate throw, and it is one line.
- **Generalizes to:** any config rebuilt from the config endpoint rather than from the site row,
  and to every other field the endpoint omits — check what it actually returns before reading a
  key off it. **Home:** §9.1 PUT payload / `verify-config`.

---

## LRN-SETUP-20 — the worker runs the setupScript BEFORE WordPress swaps emoji for `<img>`, so a leading emoji exists in production and not locally

- **Date / site:** 2026-09-24 · naamat.org.il, job `naamat-7525`.
- **Signal:** one job shipped an EMPTY `requirements` while the same script, run locally against the
  same URL, produced the line. Nothing threw. Fill rate 0.92 instead of 1.00, on one row.
- **Mechanism:** WordPress loads `wp-emoji-release.min.js`, which rewrites emoji **text** into
  `<img>` elements after load. `textContent` of an `<img>` is empty, so once that swap has run the
  emoji is simply GONE from extracted text. Measured on one detail page: sampled immediately the
  block holds **1 `<img>`** and reads `💜 עדיפות…`; four seconds later it holds **6** and reads
  ` עדיפות…`. The worker runs the setupScript as soon as the body is non-empty, so it sees the
  FIRST state; a local dry-run, which waits, almost always sees the second.
- **Consequence:** a `^`-anchored pattern — such as the requirement test in `LRN-SETUP-18` — matches
  locally and fails in production on exactly the lines that begin with an emoji. It is
  **unreproducible locally by construction**, which is what makes it expensive: the obvious next
  move is to re-run the dry-run, and the dry-run keeps saying the code is right.
- **Tell:** the STORED value contains the emoji and your local extraction does not. Compare what the
  database holds against what the dry-run prints, not just the fill rate. Here the stored string was
  `"💜 עדיפות לבעלות ניסיון."` while every local render showed it clean.
- **Fix:** classify against a copy with leading non-letters stripped, and keep the ORIGINAL text in
  the stored line — strip for the test, never for the value.
- **Generalizes to:** any page whose own JS rewrites the DOM after load — emoji, lazy images,
  typography/footnote plugins. The rule: never anchor a pattern to the first character of a line
  when the page may replace that character. **Home:** `recipes/setupscript-patterns.md` §6.3, read
  with `LRN-SETUP-18`.
