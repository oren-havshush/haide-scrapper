# Recipe: WAF / Bot-detection Bypasses

> Load this recipe when:
> - `reach` output says `needsUaOverride: true`
> - `detail-reach` exits 2 (detail pages need UA) or 3 (blocked even with UA)
> - `browserOverrides.userAgent` is needed in the config
> - `bypassCSP` error appears in a `setupScript` run
>
> See also: `LRN-WAF-1`, `LRN-WAF-2` in `docs/addsite-learnings.md`.

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

**Fix:** add `bypassCSP: true` to the config:
```json
{
  "bypassCSP": true,
  "setupScript": "..."
}
```
This tells the worker to inject a `<meta http-equiv='Content-Security-Policy' content='...'>` override before running the script.

> Use only when needed — CSP override is a broad permission. Cite: `LRN-WAF-3`.

---

## 5. Reblaze / other Israeli WAFs

**Signal:** HTML contains `"Request unsuccessful"`, `"_Incapsula_Resource"`, or similar Reblaze markers.
Reblaze is widely used by Israeli financial and government sites.

**Fix:** same approach as Incapsula (§2). UA override first; if that fails, REVIEW.

---

## Quick-reference: browserOverrides shape

```json
{
  "browserOverrides": {
    "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "extraHeaders": {
      "accept-language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7"
    }
  },
  "bypassCSP": true
}
```

Only include fields you need. `userAgent` is the most common fix; `bypassCSP` is rare.
