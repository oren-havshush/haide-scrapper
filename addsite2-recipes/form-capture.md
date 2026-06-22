# Recipe: Apply Form Capture (Step 5b)

> Load this recipe when:
> - `addsite-qa` returns `formStatus: NEEDS_MANUAL` (apply form on page, not captured)
> - You need to capture the apply form structure for `formCapture` in the config
> - Running the standalone `run step 5b <url>` shortcut

---

## Step5a. Detect email apply BEFORE running this recipe

Run after Step 5 dry-run, **before** attempting form capture. Prevents false
SKIP when the real apply path is a site-wide careers email (no HTML form).

```js
// Playwright probe — run on the listing page
const emailApply = await page.evaluate(() => {
  const mailtos = [...document.querySelectorAll('a[href^="mailto:"]')]
    .map(a => a.getAttribute('href').replace(/^mailto:/i, '').split('?')[0]);
  const body = document.body.innerText || '';
  const prose = /\b[\w.+-]+@[\w.-]+\.\w+\b/.exec(body)?.[0] || null;
  const applyCue = /קורות\s*חיים|מועמדות|לשלוח|הגש|apply|cv|resume|מס[\s'']?משרה/i.test(body);
  return { mailtos, prose, applyCue,
    likelyEmailApply: (mailtos.length > 0 || !!prose) && applyCue };
});
```

**If `likelyEmailApply === true`:**
- **First check**: does each job ALSO have its own file-upload form on the page?
  Look for `<form action=".../file-upload">` or Dropzone elements inside each job
  card. A visible email in the header/footer does NOT mean email-apply — it may
  be a general HR contact. If per-job upload forms exist, follow the
  **Dropzone / listing-page upload** path below instead.
- If no per-job form exists: Skip Step 5b. Set `formCapture: null`.
  Inject `mailto:` per-item or site-wide email via `setupScript` into `.__ai-apply`.
  `formStatus = EMAIL` passes Tier-A. Ship ACTIVE.

**Dropzone / listing-page file-upload (no detail pages)**
Some sites (e.g. `shagrir.co.il`) embed a Dropzone.js upload form for each job
directly on the listing page (no separate detail URL). Pattern:
```html
<form action="/file-upload" id="dropzone-{id}">
  <input type="hidden" name="job_cv_id" value="{id}">
</form>
```
The correct approach — no `formCapture` needed:
1. Extract the numeric job ID from the toggle anchor: `href="#collapseJobsItem{id}"`.
2. Inject a per-job anchor URL as `applicationInfo`:
   ```js
   item.appendChild(mk('__ai-apply-url', 'https://site.co.il/jobs#jobs-cv-' + jobId));
   ```
3. Set `formCapture: null` — the Dropzone upload is pure JS, no server-side form
   fields to capture; the anchor URL is sufficient for the apply link.
Reference: `shagrir.co.il` (`cmqjkta3n000r01p6p7i3nkhe`). Cite: `LRN-FORM-4`.

**Two apply paths — WhatsApp + site-level CV upload (no per-job URL)**
Some sites (e.g. `tigbur.co.il`) expose both:
- A **per-job WhatsApp link** in the API response (`job_wa_link`)
- A **site-level CV upload modal** triggered by checkboxes (multi-select, JS-driven,
  no per-job anchor URL)

When both exist and the CV upload has no addressable per-job URL, store both in
`applicationInfo` concatenated with `\n`:
```js
var applyVal = job.job_wa_link + '\\n' + 'https://site.co.il/jobs/';
item.appendChild(mk('__ai-apply-url', applyVal));
```
Set `formCapture: null` — the modal form is JS-only, nothing to capture server-side.
Reference: `tigbur.co.il` (`cmqjk3tp1000k01p64hssobp7`). Cite: `LRN-FORM-5`.

**Do NOT SKIP just because:**
- Step 5b found only a newsletter/subscribe form (no CV upload)
- There is no per-job `detailUrl`
- `formCapture: null` — expected for email-apply sites

References: benjerry.co.il (`cmqe6ce8q004401lcpn12brnw`), halilit.com.
Cite: `LRN-FORM-3`.

---

## LRN-FORM-6 — Capture the form BEFORE the first PUT; a `NEEDS_MANUAL` REVIEW is remediable
- **Signal:** a site has a real apply form on the detail page but the config was
  PUT + scraped with no `formCapture`, QA returned `formStatus: NEEDS_MANUAL` /
  `NONE`, and the site was logged REVIEW. Three 6.csv sites (clalitsmile, proportsia,
  and madanes for requirements) stalled in REVIEW this way despite having capturable
  forms — wasting a full scrape+QA round each.
- **Fix:** treat Step 5b as **mandatory before the first PUT** whenever there is no
  captured form / email / per-item apply URL yet. If you only discover the gap at QA
  time, do NOT log REVIEW — go back to Step 5b, capture the form, re-PUT, re-scrape,
  re-QA (within the §B2a remediation budget). A `NEEDS_MANUAL` reason is a remediable
  signal, not a terminal verdict.
- **Multi-form pages:** when several forms exist (e.g. a CV-upload form behind
  reCAPTCHA AND a plain `contact-about-job` form with no CAPTCHA), capture the
  CAPTCHA-free one. Reference: clalitsmile.co.il (Formidable Forms, 3 forms).
- **Generalizes to:** every site where the apply path isn't email and isn't a
  per-item URL. **Home:** Step 5b + Step 9 verdict routing.
- References: clalitsmile.co.il (`cmqo82p3v000x01qpmtxsxv25`),
  proportsia.co.il (`cmqo82pcr001101qplimsnicc`).

---

## 0. When to capture vs when to skip

| Signal | Action |
|---|---|
| `formStatus: CAPTURED` (already in config or per-job `applicationInfo`) | No action needed. |
| `formStatus: EMAIL` | No capture needed — `applicationInfo` already has the email. |
| `formStatus: URL` | No capture needed — `applicationInfo` has the external apply URL. |
| `formStatus: NEEDS_MANUAL` | Run this recipe. |
| `formStatus: NONE` + apply form visible on detail page | Run this recipe. |
| `formStatus: NONE` + apply requires login | SKIP. Do not attempt capture. |
| `formStatus: NONE` + apply has Turnstile/CAPTCHA | SKIP. Log `LRN-APPLY-1`. |

---

## 1. Quick check — is the form on the listing or the detail page?

The apply form **almost always lives on the per-job detail page**, not the listing.
Cite: `LRN-APPLY-3` — the "form is on detail page" lesson.

1. Navigate to one sample `detailUrl` from the scrape results.
2. Look for: `<form>` elements, "Apply" / "הגש מועמדות" buttons, modals.

---

## 2. Capture the form structure (Playwright)

```typescript
// capture-form.ts — run with: npx tsx scripts/capture-form.ts <detailUrl> [--ua "..."]
import { chromium } from 'playwright';

const url = process.argv[2];
const ua = process.argv.find(a => a.startsWith('--ua='))?.slice(5) ??
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ...';

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ userAgent: ua, viewport: { width: 1280, height: 800 } });
const p = await ctx.newPage();
await p.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

// Click Apply button if form is behind a click
const APPLY_SELECTORS = ['button:has-text("Apply")', 'a:has-text("הגש")', 
  'button:has-text("הגשת מועמדות")', '.apply-button'];
for (const sel of APPLY_SELECTORS) {
  const btn = p.locator(sel).first();
  if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await btn.click();
    await p.waitForTimeout(1500);
    break;
  }
}

const form = await p.evaluate(() => {
  const forms = Array.from(document.querySelectorAll('form'));
  const best = forms.sort((a, b) => 
    b.querySelectorAll('input,select,textarea').length - 
    a.querySelectorAll('input,select,textarea').length)[0];
  if (!best) return null;
  const fields = Array.from(best.querySelectorAll('input,select,textarea'))
    .filter(el => !['hidden','submit','button','reset','image'].includes(
      (el as HTMLInputElement).type ?? ''))
    .map(el => ({
      name: (el as HTMLInputElement).name || el.id || el.className.split(' ')[0],
      type: (el as HTMLInputElement).type ?? el.tagName.toLowerCase(),
      required: (el as HTMLInputElement).required,
      label: document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim() ?? ''
    }));
  return {
    actionUrl: best.action,
    method: best.method || 'post',
    fields
  };
});

console.log(JSON.stringify(form, null, 2));
await b.close();
```

Save the output as `formCapture` in your config:
```json
{
  "formCapture": {
    "actionUrl": "https://...",
    "method": "post",
    "fields": [
      { "name": "firstName", "type": "text", "required": true, "label": "שם פרטי" },
      { "name": "lastName",  "type": "text", "required": true, "label": "שם משפחה" },
      { "name": "email",     "type": "email","required": true, "label": "אימייל" },
      { "name": "resume",    "type": "file", "required": true, "label": "קורות חיים" }
    ]
  }
}
```

---

## 3. Newsletter-form shadow (common pitfall)

**Problem:** the site has a newsletter subscription form AND an apply form. The capture script finds the newsletter form first (it has more fields in the DOM).

**Fix:** filter forms: the apply form will contain a `resume` or `file` input, OR its action URL will contain `/apply` or `/career`. Add this check:
```ts
const applyForms = forms.filter(f => 
  f.querySelector('input[type="file"]') ||
  /apply|career|job|הגש/i.test(f.action + f.innerHTML));
```
Cite: `LRN-APPLY-2`.

---

## 4. Per-job `applicationInfo` (structured form on detail page)

Some sites (e.g. `yes.co.il`) embed the full apply form on each job detail page as a unique form — NOT a shared site-level `formCapture`. In this case, do NOT set `formCapture` on the site config.

Instead, map `applicationInfo` in `fieldMappings` to the `<form>` element, and the worker will serialize the form structure per-job as `rawData.applicationInfo`.

Signal: `addsite-qa` reports `formStatus: CAPTURED` and `formFields > 0` — meaning jobs already carry the form in `applicationInfo`. No further action needed.

---

## 5. Manual fallback (3-question flow)

When the automated capture fails (form requires interaction you can't script, e.g. multi-step with AJAX validation):

1. Open the detail page in a real browser.
2. Click "Apply" — inspect the form.
3. Note: action URL, method, and the **name attributes** of each visible input.
4. Build the `formCapture` object manually from what you observe.
5. Validate: set `formCapture` in the config, trigger a scrape, and verify the form fields appear in `rawData._formData` on sampled jobs.

If even manual inspection doesn't yield a stable form structure (form is fully dynamic, fields vary per job) → set `formStatus: URL` and capture the apply button's href as `applicationInfo` instead.

---

## 6. Standalone `run step 5b <url>`

When invoked standalone (adding a form to an already-ACTIVE site):

1. Run the capture script against the detail URL (§2).
2. `GET /api/sites/<id>/config` to read the current config.
3. Add `formCapture` to the existing config payload.
4. `PUT /api/sites/<id>/config` with the merged payload.
5. Run `verify-config --site-id <id> --expect-form-fields <N>` (exit 0 = survived).
6. Trigger a re-scrape.
7. QA: verify `formStatus: CAPTURED` and `formFields ≥ N`.
