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
- **Multi-form pages — enumerate ALL, then rank (`LRN-FORM-7`):** a page can carry
  3+ forms, some behind **secondary buttons/modals**. List every `<form>`, check EACH
  for Turnstile/reCAPTCHA, and pick by: **(1) captcha-free CV-file-upload → (2)
  captcha-free contact/lead form → (3) captcha-gated = unusable.** Prefer the form that
  accepts a CV file over a contact-only form, and don't assume the most prominent
  apply button is the right one — it may be the reCAPTCHA-gated path. Reference:
  clalitsmile.co.il (Formidable Forms, 3 forms): the prominent "שליחת קו״ח" CV button
  is reCAPTCHA-gated; the captcha-free generic-position form
  (`#form_upload_cv_form_generic_position`, opened by a separate "שלח קו״ח" button)
  accepts a CV upload and is the right **primary** apply, with `#form_contact-us-about-job`
  as a fallback. To capture **both** in one `formCapture`, merge their fields into a
  single static `fields` list and set `formSelector` to match **nothing** on the
  listing page (forces the static-blob fallback — §7), then verify a sampled job's
  `_formData` lists the CV `file` field.
- **Generalizes to:** every site where the apply path isn't email and isn't a
  per-item URL. **Home:** Step 5b + Step 9 verdict routing.
- References: clalitsmile.co.il (`cmqo82p3v000x01qpmtxsxv25`),
  proportsia.co.il (`cmqo82pcr001101qplimsnicc`).

---

## LRN-FORM-7 — Multi-form page: enumerate ALL forms and rank; the prominent apply button may be the captcha-gated one
- **Date / site:** 2026-06-22 · clalitsmile.co.il (`cmqo82p3v000x01qpmtxsxv25`)
- **Signal:** the page has **three** Formidable forms, opened by different buttons:
  1. `#form_upload_cv_form` — the prominent "שליחת קו״ח" (`show_form_button`) CV upload,
     but **behind Google reCAPTCHA** (`g-recaptcha-response`) → unusable.
  2. `#form_contact-us-about-job` — a captcha-free per-job contact/lead form
     (name/phone/email/area/job-name), no CV upload.
  3. `#form_upload_cv_form_generic_position` — a captcha-free **CV file upload** (+ a
     "notes / desired position" text field), opened by a separate "שלח קו״ח" button.
  An earlier pass captured form #2 because it was the first captcha-free form found,
  missing the better #3 (real CV upload, also captcha-free).
- **Fix:** when a page has multiple forms, **enumerate every `<form>` (including those
  behind secondary buttons/modals), test EACH for Turnstile/reCAPTCHA, then rank:
  (1) captcha-free CV-file-upload → (2) captcha-free contact/lead form →
  (3) captcha-gated = unusable.** Do not assume the most prominent "apply" button is
  the right path. To ship **both** (CV-upload primary + contact fallback) through a
  single `formCapture`, merge their fields into one static `fields` list and set
  `formSelector` to match **nothing** on the listing page (forces the static-blob
  fallback — §7), then verify a sampled job's `_formData` lists the CV `file` field.
- **Quick enumeration probe (browser/CDP `Runtime.evaluate`):**
  ```js
  [...document.querySelectorAll('form')].map(f => ({
    id: f.id,
    hasRecaptcha: /recaptcha|g-recaptcha/i.test(f.innerHTML)
      || !!f.querySelector('[name="g-recaptcha-response"],.g-recaptcha,[data-sitekey]'),
    hasFile: !!f.querySelector('input[type="file"]'),
    fields: [...f.querySelectorAll('input,select,textarea')]
      .filter(e => !['hidden','submit','button','reset','image'].includes(e.type))
      .map(e => e.name + ':' + (e.type || e.tagName.toLowerCase()))
  }));
  ```
- **Generalizes to:** any multi-form apply page (Formidable/WP/Elementor), especially
  where a reCAPTCHA guards the obvious CV button but a secondary button does not.
  **Home:** Step 5b / form-capture.md §0 multi-form bullet.

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

### Capture choice fields WITH their options — radio groups too, not just `<select>` (`LRN-FORM-8`)

The §2 script captures `<select>` options for free, but **`type="radio"` groups are
easy to miss** — each radio is a separate `<input>` sharing one `name`, and the
visible question text lives in a sibling label/legend, not on the input. If you skip
them, the dashboard shows the apply form **missing the whole question** (e.g. a yes/no
"do you have relatives at the company?"). Two rules:

1. **Collapse a radio group into ONE field** keyed by its shared `name`, with each
   button as an option `{value,label}`. The field `label` is the **question text**
   (the group's legend/preceding label), not "כן"/"לא".
2. **Keep conditional follow-up fields** (a text box that only matters when the user
   picks "yes" — e.g. `relative_details` / "פרטי הקרוב/ה"). Capture it as a normal
   text field; the auto-apply layer decides when to fill it.

```js
// Group radios by name; everything else stays 1 field = 1 input.
const groups = {};
for (const el of form.querySelectorAll('input,select,textarea')) {
  const type = el.type || el.tagName.toLowerCase();
  if (['submit','button','image','reset','hidden'].includes(type)) continue;
  if (type === 'radio') {
    (groups[el.name] ??= { name: el.name, fieldType: 'radio', tagName: 'input',
      required: el.required, label: questionLabelFor(el), options: [] })
      .options.push({ value: el.value, label: labelFor(el) });  // labelFor → "כן"/"לא"
  } else { /* push a normal field; add options:[] for <select> */ }
}
```

Resulting field shape (radio group + its follow-up):
```jsonc
{ "name": "relatives", "fieldType": "radio", "tagName": "input", "required": false,
  "label": "האם יש לך קרובי משפחה העובדים או לומדים במכון ויצמן",
  "options": [ { "value": "yes", "label": "כן" }, { "value": "no", "label": "לא" } ] },
{ "name": "relative_details", "fieldType": "text", "tagName": "input",
  "required": false, "label": "פרטי הקרוב/ה (שם ותפקיד)" }
```
Reference: weizmann.ac.il (`cmqsblcsy000p01nunllx3ol0`) — the Drupal apply form's
relatives radio (+ its conditional details text) was absent until captured this way.

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
   - For **`<select>` and radio groups**, also record every option as
     `{value,label}` and use the **question text** as the field `label` — see the
     `LRN-FORM-8` radio-group rule in §2. Don't forget **conditional follow-up**
     inputs (a text box tied to a "yes" answer).
   - Fast way to dump real `name`s + options via browser/CDP `Runtime.evaluate`:
     ```js
     [...document.querySelector('form').querySelectorAll('input,select,textarea')]
       .map(el => ({ name: el.name, type: el.type || el.tagName.toLowerCase(),
         value: el.type === 'radio' ? el.value : undefined,
         options: el.tagName === 'SELECT'
           ? [...el.options].map(o => ({ value: o.value, label: o.text })) : undefined }));
     ```
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

---

## 7. `formSelector` must NOT match a decoy form on the listing page (live-extract trap)

> **The worker re-extracts the form at scrape time — your captured `fields` are only
> a fallback.** This trap silently ships the wrong form even though `verify-config`
> passes. Cite: `LRN-APPLY-7` (proportsia.co.il).

**How the worker builds `_formData`** (`worker/jobs/scrape.ts`):
- The dashboard's **per-job** "Application Form" table renders `rawData._formData`.
  (The separate "Application Form (Site-level)" panel reads `_meta.formCapture` and
  is always your static capture — do not confuse the two.)
- At scrape time the worker calls `extractFormDataOrFallback`: it runs
  `document.querySelector(formSelector)` on the **current page** and serializes that
  live form. It uses your captured static `fields` blob **only when the selector
  matches nothing**.
- On a **listing-only site (no `pageFlow`)** the current page is the **listing
  page** — the real apply form (on detail pages) is never in the DOM during the
  scrape. So if `formSelector` matches *any* form on the listing page (a WP/Elementor
  newsletter or contact form is the usual decoy), the worker serializes **that** form
  and your captured CV/file fields never reach `_formData`.

**Symptom:** static fields look perfect (`verify-config` shows N fields), but the
per-job table shows junk hidden inputs (e.g. `*_for_uco_crm_integration`,
`*_for_fixdigital_integration`) and an `actionUrl` pointing at the **listing** URL,
with the `file` / CV field missing.

**Fix — make the selector match nothing on the listing page, forcing the fallback:**
```jsonc
// before — matches the listing's newsletter form:
"formSelector": "form.elementor-form"
// after — listing newsletter form has no file input, so nothing matches →
// worker falls back to the captured static fields (incl. the CV upload):
"formSelector": "form.elementor-form:has(input[type=\"file\"])"
```
Then re-scrape (existing `_formData` is only repopulated on a fresh scrape) and
confirm a sampled job's `_formData` lists every captured field including the `file`
input. `:has()` runs in the worker's Chromium, so it is safe to use.

**Verification (always do this for listing-only sites with a static `formCapture`):**
```bash
# a sampled job's _formData must contain the file/CV field, not listing junk:
curl -s "$BASE/api/jobs?siteId=$SITE_ID&limit=1" -H "$AUTH" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const fd=JSON.parse(JSON.parse(d).data[0].rawData._formData);console.log(fd.actionUrl);console.log(fd.fields.map(f=>f.name+':'+f.fieldType).join('\n'));})"
```
If `actionUrl` is the listing URL or the `file` field is absent → the decoy form
won; tighten `formSelector` as above. **Home:** §5 step 5, Step 9 QA.
