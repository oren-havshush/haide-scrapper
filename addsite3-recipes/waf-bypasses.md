# Recipe: WAF / Bot-detection Bypasses

> Load this recipe when:
> - `reach` output says `needsUaOverride: true`
> - `detail-reach` exits 2 (detail pages need UA) or 3 (blocked even with UA)
> - `browserOverrides.userAgent` is needed in the config
> - `bypassCSP` error appears in a `setupScript` run
>
> See also: `LRN-WAF-1`, `LRN-WAF-2` in `docs/addsite-learnings.md`.


> **CEILING — `bypassCSP` cannot read a third party's response.** It removes the
> Content-Security-Policy check, so the request leaves — but CORS still governs
> *reading* the reply. A host that sends no `Access-Control-Allow-Origin` returns an
> opaque response (status 0, unreadable body) and no setupScript can ever get the data.
> Test before designing: fetch with `bypassCSP` false, then true, then `mode:"no-cors"`.
> `opaque/0` while `cors` fails = ceiling reached; switch to `pageFlow` navigation.
> Cite: `LRN-WAF-3` (pac.ac.il → campaign.adamtotal.co.il).

---

## 1. UA-keyed WAF (TCP reset / connection refused on listing)

**Signal:** `reach --url` returns `needsUaOverride: true`.
**Root cause:** the server checks the `User-Agent` header and drops or resets connections from headless/bot strings (`HeadlessChrome`, `python-requests`, etc.).

**Fix:** add `browserOverrides.userAgent` to the config:
```json
{
  "browserOverrides": {
    "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  }
}
```
The worker uses this UA for all fetches on this site.

> **Also set extra headers if needed:**
> ```json
> { "browserOverrides": { "userAgent": "...", "extraHeaders": { "accept-language": "he-IL,he;q=0.9" } } }
> ```

**Verify:** after PUT + scrape, check that jobs appear. If jobs still 0, escalate to Incapsula check (§2 below).

---

## 2. Incapsula / Imperva — detail-page block (HeadlessChrome detection)

**Signal:** `detail-reach --listing <L> --detail <D>` exits 2 or 3.
**Root cause:** Incapsula/Imperva serves an interstitial or blank page to browsers that expose `navigator.webdriver = true`. The listing page may pass because it's cached/CDN-served; detail pages are dynamic and get the challenge.

This is one of the most common failure classes in the IL market. Cite: `LRN-WAF-2`.

### Fix A: UA override (detail-reach exit 2)
Same as §1 above — add `browserOverrides.userAgent`. The worker navigates with a real UA and sets `navigator.webdriver = false` via `addInitScript`.

```json
{
  "browserOverrides": {
    "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  }
}
```

### Fix B: Cookie seeding (when UA alone is not enough)
Some Incapsula instances require a cookie set during a listing-page visit before detail pages are served.
The worker's Playwright context shares cookies within a session, so navigating the listing page first (which the worker does naturally) usually seeds the cookie.

If the detail page still blocks after UA override:
1. Manually navigate listing → detail in Playwright with stealth settings.
2. Check if it works — if yes, the worker's sequence (listing then detail) should replicate it.
3. If still blocked → `detail-reach exit 3` → escalate to REVIEW.

### Fix C: detail-reach exit 3 (blocked even with UA)
If both bare and UA-overridden probes fail:
- IL-IP restriction, regional Cloudflare block, or Captcha wall on detail pages.
- Verdict: **REVIEW** (not SKIP yet). A human may be able to confirm from a non-server IP, or find an alternative apply URL.
- Admin note: `"detail pages unreachable from server IP — manual verification needed"`

---

## 3. Cloudflare / "Just a moment" challenge

**Signal:** HTML contains `"just a moment"`, `"cf-mitigated"`, or `"enable javascript and cookies"`.
**Root cause:** Cloudflare Bot Management challenge page.

**Fix:**
1. Add `browserOverrides.userAgent` (same real-UA as §1). Many CF configs only check UA + JS execution.
2. If that fails, add stealth: the worker already calls `addInitScript(() => Object.defineProperty(navigator, 'webdriver', {get: () => false}))`. Confirm this is in the worker config.
3. If still blocked after 2 attempts → **SKIP** (structural, not transient). The server is aggressively bot-protected. Log: `"Cloudflare Bot Management — structural blocker"`.

---

## 4. `bypassCSP` — setupScript XHR blocked by CSP

**Signal:** `setupScript` attempts to `fetch()` or `XMLHttpRequest` a different subdomain/origin and gets a CSP violation error in the browser console.

**Example:** listing is on `www.bezeq.co.il`, setupScript fetches from `d-api.bezeq.co.il` — blocked by default CSP.

**Fix:** add `bypassCSP: true` **inside `browserOverrides`** — the only place the
schema (`src/lib/validators.ts`, `browserOverrides.bypassCSP`) and the worker
(`getBrowserOverrides` in `worker/jobs/scrape.ts`) read it. A top-level
`"bypassCSP": true` is accepted and silently does nothing (step 6, 2026-10-05):
```json
{
  "browserOverrides": { "bypassCSP": true },
  "setupScript": "..."
}
```
The worker passes it to Playwright's `newContext({ bypassCSP: true })`, which stops the
browsing context enforcing the page's CSP.

> Use only when needed — CSP override is a broad permission. Cite: `LRN-WAF-3`.

---

## 5. Reblaze — an HTTP 247 stub that the gates used to call a PASS (`LRN-WAF-6`)

**Signal:** status **`247`** (not a 4xx), a **~600-byte** body carrying `window.rbzns`,
`winsocks(` or `/…ac_v2.lib.js`, and an empty `<body>`. `triage` may say GRAY
`topCluster 0`, which reads like "no listing structure" — it is a page never seen.
Reblaze fronts many Israeli financial and government sites.

**Read the byte counts, not just the verdict line** (`parityBytes` / `uaBytes` in
`detail-reach`): ~600 bytes is a stub, a real listing is tens of KB. The shared
challenge detector (`scripts/lib/challenge-detect.ts`) now catches status 247 and the
Reblaze bootstraps, but a padded interstitial with links can still pass — check bytes.

**Fix:** none found. A UA override does **not** work (career.rafael.co.il: 593 B with
the worker's UA, 581 B with a real Chrome UA, both stubs; the same from inside the
worker). Route to **REVIEW** with the byte counts in the adminNote. Do not spend the
build on it.

---

## 6. Akamai — two modes with opposite verdicts (`LRN-WAF-8`, `LRN-WAF-9`)

Tell them apart by what comes back:

| What comes back | Mode | Verdict |
|---|---|---|
| A short **403 body** (~200–400 bytes): `Access Denied — You don't have permission…`, a `Reference #18.<hex>…` id, an `errors.edgesuite.net` link | Host-wide deny (`LRN-WAF-8`, careers.se.com) | Every path, bare curl and a desktop UA alike: the UA changes nothing. Record the reference id and the paths tried; the host is unbuildable from the server. One cheap client-hints probe (below) is allowed, nothing more |
| **No HTTP status at all**: `net::ERR_HTTP2_PROTOCOL_ERROR` in Chromium, `Recv failure: Connection was reset` in curl, after the TLS handshake; `triage` says RED, `bytes: 0` | Fingerprint reset (`LRN-WAF-9`, dhl.com) | **Fixable: send the client hints.** A UA alone is still reset |

**The client-hints fix (`LRN-WAF-9`):** `browserOverrides.userAgent` **plus** the full
desktop-Chrome header set, copied **verbatim** from `sites/osem/config.json`:
`sec-ch-ua`, `sec-ch-ua-mobile`, `sec-ch-ua-platform`, `upgrade-insecure-requests`,
the full browser `accept`, and `accept-language`. Neither half works alone. DHL: default
→ reset, UA only → reset, UA + hints → 200, 9/9 jobs, 3/3 runs from the box.

- `reach` / `triage` retry once with a UA and `accept-language` only, so they write
  this mode off RED. Grep `sites/` for prior art before concluding.
- **Never re-analyse such a site.** The analyzer creates its page with no overrides, so
  it cannot load the host; its navigation failure sets FAILED and deletes the jobs. The
  `configLocked` set by `PUT /config` is the only protection — say so in the adminNote.
- A headful browser returning 200 is a diagnostic, never a verdict (`LRN-WAF-4`, `LRN-WAF-5`).

---

## 7. ShieldSquare (Radware) — an hCaptcha wall that reads as GRAY (`LRN-WAF-4`)

**Signal:** the first request 302s to `validate.perfdrive.com/…`, which serves
`<title>ShieldSquare Captcha</title>` with a blocking hCaptcha. The redirect target
answers 200, so a status-code probe calls the site reachable and `triage` says
GRAY / `reachable: true`. The site's own JSON API can sit behind the same wall.

**Diagnose:** `curl -sL -o NUL -w "%{url_effective}"` on the listing. A final host of
`validate.perfdrive.com`, or that title, is this block.

**Fix:** none within the worker's means — nothing may solve an hCaptcha, and a UA
override does not help. **SKIP**, like a blocking Turnstile (`LRN-APPLY-1`), after one
search for the employer's own board on another host (aggregators are not the employer).
- **One 200 is not access.** Repeat the request; the worker needs every night to get through.
- **"It works in my browser" is not evidence** the worker can get in: a browser that has
  passed the challenge is let through afterwards, and the worker never passes it.

---

## 8. Before you SKIP a blocked site, and how to read a block page

- **Re-probe from inside the worker container before SKIPPING or adding a UA override**
  (`LRN-WAF-5`). A block seen from the dev machine can be the dev IP, or the **spoofed** Chrome
  UA itself: Incapsula blocked both locally while the worker, with its own UA, got through.
  Run the probe in `haide-scrapper-worker-1` (stdin script, `docker exec -i`) and decide on
  that result.
- **An interstitial's own id or copy is a guess, not evidence** (`LRN-WAF-7`). Its markup is
  the site author's idea of why you were stopped. Vary one input at a time — the UA first —
  and confirm by the page size or title flipping. A UA fix can point either way (see
  `LRN-WAF-5`).

---

## Quick-reference: browserOverrides shape

```json
{
  "browserOverrides": {
    "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "extraHeaders": {
      "accept-language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7"
    },
    "bypassCSP": true
  }
}
```

Only include fields you need. `userAgent` is the most common fix; `bypassCSP` is rare.
