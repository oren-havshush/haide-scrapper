# Engineer notes — Application form capture & future auto-apply

These notes were produced during the onboarding of `https://www.ness-tech.co.il/careers/` and a comparison with `https://www.aig.co.il/jobs/#vacancies-section`. Share with the scraper-engine engineer when prioritising the auto-apply feature.

---

## TL;DR

- The worker **already auto-captures application forms** on detail pages — **no `formCapture` site-config field is required**. Verified on AIG (jobs include a full form schema in `applicationInfo` and `rawData._formData`).
- NESS doesn't get this auto-capture because we onboarded it as a **single-page** site (`pageFlow: []`), so the worker never visits `/careers/job/<id>` where the form lives.
- To enable form capture on NESS we'd need to convert the site to multi-page. There's one open question (below) about whether `setupScript` still runs on the listing of a multi-page site — NESS depends on it.

---

## Evidence — how AIG's form gets captured today

AIG site config (`/api/sites?siteUrl=...`):

```json
{
  "itemSelector": "[class*=\"jobs-links_job-link\"]",
  "pageFlow": [
    { "url": "https://www.aig.co.il/jobs/", "action": "navigate" },
    { "url": "https://www.aig.co.il/jobs/*", "action": "navigate" }
  ],
  "formCapture": null,
  "fieldMappings": {
    "title":         { "selector": "[class*=\"MuiTypography-body3\"]" },
    "description":   { "selector": "[class*=\"job-page_page-content\"]" },
    "detailUrl":     { "selector": "a", "extractAttr": "href" },
    "externalJobId": { "selector": "a", "extractAttr": "href" }
  }
}
```

Notice **`formCapture` is `null`** — yet the resulting Job rows contain:

```jsonc
"applicationInfo": "{
  \"actionUrl\": \"https://www.aig.co.il/jobs/<job-slug>/\",
  \"method\": \"GET\",
  \"fields\": [
    {\"name\":\"fullName\", \"label\":\"full Name\",     \"fieldType\":\"text\", \"required\":false, \"tagName\":\"input\"},
    {\"name\":\"phone\",    \"label\":\"phone\",         \"fieldType\":\"tel\",  \"required\":false, \"tagName\":\"input\"},
    {\"name\":\"email\",    \"label\":\"email\",         \"fieldType\":\"text\", \"required\":false, \"tagName\":\"input\"},
    {\"name\":\"location\", \"label\":\"location\",      \"fieldType\":\"text\", \"required\":false, \"tagName\":\"input\"},
    {\"name\":\"cvFile\",   \"label\":\"בחירת קובץ\",   \"fieldType\":\"file\", \"required\":false, \"tagName\":\"input\"}
  ]
}",
"rawData": { "_formData": "<same JSON>" }
```

So the worker is **scanning each detail page for the first/primary form and serialising its field schema automatically** into `applicationInfo` (string-encoded JSON) and `rawData._formData`. No site-config knob controls this — it just happens whenever the worker visits a detail page.

---

## Why NESS doesn't have it

NESS (`https://www.ness-tech.co.il/careers/`, siteId `cmp5k0she000v01lsrrw43uor`) was onboarded as **single-page** because the site's own internal API (`/careers/api/Careers/GetAllItems`) returns all 193 jobs with full data (title, location, posDescription, lastUpdated, rakaz email + name, profName, subProfName, isHot, orderId) in one call. We hit that API via a synchronous XHR inside `setupScript` and inject hidden `<span class="haide-*">` enrichers into each `.card-job-container`, so every field gets extracted from the listing page in a single HTTP round-trip.

Trade-off: the worker never visits `https://www.ness-tech.co.il/careers/job/<orderId>`, which is the only page that hosts the actual application form:

```html
<form id="contactFrom" method="post"
      action="https://www.ness-tech.co.il/careers/apiapi/upload">
  <input type="hidden" name="subject"     id="subject">
  <input type="hidden" name="body"        id="Hidden1">
  <input type="text"   name="fullname"    id="mainFirstName" placeholder="שם מלא">
  <input type="email"  name="email"       id="mainFormEmail" placeholder="מייל">
  <input type="file"   name="file-upload" id="mainFormFile"  accept=".pdf, .doc, .docx">
  <button type="submit" class="popUpbtn">שליחה</button>
</form>
```

Today every NESS job carries `applicationInfo = "https://www.ness-tech.co.il/careers/job/<orderId>"` (a plain string from our manual mapping), which is enough for deep-linking but isn't a form schema the auto-apply feature could consume.

---

## Path to enabling auto-apply on NESS

The natural fix is to switch NESS to multi-page:

```jsonc
"pageFlow": [
  { "url": "https://www.ness-tech.co.il/careers/",            "action": "navigate" },
  { "url": "https://www.ness-tech.co.il/careers/job/*",       "action": "navigate" }
]
```

Then drop the manual `applicationInfo` mapping so the worker can overwrite it with the auto-captured form JSON.

### Open question for the engineer

The current skill doc says:

> On multi-page sites the worker does not run `setupScript` on detail pages.

What it doesn't clarify is whether `setupScript` still runs on the **listing page** of a multi-page site. NESS's entire per-job data extraction lives in `setupScript` (it hits `GetAllItems` and injects enrichers). If `setupScript` is suppressed on listings when `pageFlow` is non-empty, switching NESS to multi-page would break the per-job extraction we already have.

Three possible answers, each leading to a different plan:

| `setupScript` on listing for multi-page sites? | Plan for NESS |
|---|---|
| **Yes — still runs** | Add `pageFlow` only; keep `setupScript` and field mappings; remove manual `applicationInfo` mapping. Form capture happens for free. |
| **No — suppressed** | We'd need to re-extract per-job data from each detail page directly (title/location/description/etc) via `fieldMappings` + the detail-page DOM, losing the GetAllItems shortcut and adding 193 page loads per scrape. |
| **Configurable** | Add a knob to force it; otherwise same as above. |

Until that's clarified, the safest move is to leave NESS as-is and revisit when the engineer confirms.

---

## What we'd ultimately want from the engineer for auto-apply

1. **Confirm/document `setupScript` lifecycle** — does it run on listing pages of multi-page sites? Is it ever run on detail pages? Is there a way to opt-in per page?
2. **Document the auto-form-capture rules** — which form on a detail page is picked when there are multiple? How are hidden inputs included/excluded? Are `select`/`textarea`/radio/checkbox supported and how are they serialised? How does it choose between a `<form>` action and a SPA submit handler (e.g. an Angular `(submit)` binding with no `action` attribute)?
3. **Confirm the `applicationInfo` contract** — is the JSON-string-in-a-string-column shape (`applicationInfo: "{...JSON...}"`) intentional and stable, or will it move to a typed column / separate `formSchema` field? The auto-apply consumer needs a stable contract.
4. **(Optional) `formCapture` site-config field** — currently exists in the API schema but is unused across all 33 sites. Either document a use case (e.g. when the worker's auto-detection picks the wrong form and we need to override it with an explicit selector) or remove the field to avoid confusion.

---

## Onboarding facts (for reference)

- NESS siteId: `cmp5k0she000v01lsrrw43uor`
- Listing API used inside `setupScript`: `GET https://www.ness-tech.co.il/careers/api/Careers/GetAllItems` (returns `{ allOrderDetailsList: [...], getTotalCount: 193 }`)
- Detail API (per-job, currently unused by us): `GET https://www.ness-tech.co.il/careers/api/Careers/GetOrderDetails/?orderId=<index>`
- Detail page URL pattern: `https://www.ness-tech.co.il/careers/job/<index>`
- Submit endpoint observed on the detail-page form: `POST https://www.ness-tech.co.il/careers/apiapi/upload` (the doubled `apiapi` is correct, not a typo)
