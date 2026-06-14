# Recipe: SPA / ATS Frameworks

> Load this recipe when `triage.vendor` or `fingerprint.vendor` identifies a known ATS.
> The `fingerprint` command already emits a `skeleton` — use it as your starting config
> and validate with a dry-run before PUT. This file provides the narrative detail: known
> selector variants, pitfalls, and formCapture notes for each vendor.

---

## Workday

**Host pattern:** `*.myworkdayjobs.com`
**Skeleton in `site-patterns.json`:** yes

### Selectors
```
itemSelector: li[data-automation-id='jobItem']
title:        a[data-automation-id='jobItem']
location:     dd[data-automation-id='subtitle']
detailUrl:    a[data-automation-id='jobItem'] [attr: href]  ← absolute URL
```

### Known pitfalls
- **UA override required:** Workday returns a client-rendered shell to headless browsers without a real UA. Always include `browserOverrides.userAgent`.
- **Department:** not in the listing item — lives in a filter facet sidebar. Use `setupScript` to read the currently-selected facet and inject it, OR accept missing department (Tier-B, not blocking).
- **detailUrl is absolute:** no need to resolve against siteUrl.
- **Pagination:** Workday listing pages use an "offset" query param (`&offset=20`). If site has >25 jobs, add a `pageFlow` or multi-page `setupScript`. See `pagination-and-loading.md`.
- **Apply form:** Workday uses its own hosted apply flow. `formStatus` will be `URL` (external apply link). Capture the detail-page apply URL as `applicationInfo`.

### formCapture
Workday's apply form is hosted on Workday's domain. Capture approach:
1. Navigate to a detail page.
2. Click "Apply" — it redirects to a `wd3.myworkdayjobs.com` apply URL.
3. Record that URL as `applicationInfo` (type: URL). Do NOT attempt to embed the Workday form.

---

## Greenhouse

**Host patterns:** `boards.greenhouse.io`, embedded via `grnhse_app` script
**Skeleton in `site-patterns.json`:** yes

### Selectors (hosted board)
```
itemSelector: .opening, tr.job-post
title:        a
department:   .department h2    ← parent heading, NOT inside the item (see pitfall)
location:     .location
detailUrl:    a [attr: href]    ← relative URL
```

### Selectors (embedded board — `#grnhse_app`)
```
itemSelector: #app_body .opening
title:        a.opening-job-title
location:     span.location
detailUrl:    a.opening-job-title [attr: href]
```

### Known pitfalls
- **Department is a parent heading:** the `.department h2` sits above a `<div class="openings">` that contains the job list. It is NOT inside each `.opening` item. Use `setupScript` to inject the parent department into each item:
  ```js
  // setupScript
  for (const section of document.querySelectorAll('.department')) {
    const dept = section.querySelector('h2')?.innerText?.trim();
    for (const item of section.querySelectorAll('.opening')) {
      if (item.querySelector('.__ai-dept')) continue;
      const span = document.createElement('span');
      span.className = '__ai-dept';
      span.style.display = 'none';
      span.textContent = dept || '';
      item.appendChild(span);
    }
  }
  ```
  Then map `department` selector to `.__ai-dept`.
- **detailUrl is relative:** worker resolves it against `siteUrl` automatically.
- **Apply form:** Greenhouse has a native multi-step apply form. Capture it with `form-capture.md`.

---

## Lever

**Host pattern:** `jobs.lever.co/<company>`
**Skeleton in `site-patterns.json`:** yes

### Selectors
```
itemSelector: .posting
title:        .posting-title h5, .posting-name
department:   .posting-categories .sort-by-team
location:     .posting-categories .sort-by-location
detailUrl:    a.posting-title, h5 > a [attr: href]
```

### Known pitfalls
- **Static HTML:** Lever job boards are server-rendered. Very reliable selectors; rarely needs a UA override.
- **detailUrl is relative:** auto-resolved by worker.
- **Team/department:** uses `sort-by-team` class — reliable.
- **Apply form:** Lever has a native apply form on the detail page. Capture with `form-capture.md`.

---

## Comeet

**Host patterns:** `comeet.com/jobs/<company>`, embedded via `positionItem` class
**Skeleton in `site-patterns.json`:** yes

### Selectors
```
itemSelector: [data-qa='position'], .positionItem
title:        [data-qa='position-name'], .position-name
location:     .position-location, [data-qa='position-location']
department:   .position-department, [data-qa='position-department']
detailUrl:    a [attr: href]
```

### Known pitfalls
- **XHR-loaded:** positions load asynchronously. Add `waitForSelector: "[data-qa='position']"` or use networkidle wait.
- **formCapture:** Comeet uses its own apply modal. Because Comeet's form is identical across all positions for a company, capture it once and store as a **static `formCapture` template** (not per-job):
  ```json
  { "fields": [{"name":"firstName","type":"text"}, {"name":"lastName","type":"text"}, {"name":"email","type":"email"}, {"name":"resume","type":"file"}] }
  ```
  See `LRN-SPA-3` in `docs/addsite-learnings.md`. Do NOT attempt a live form probe.

---

## iCIMS

**Host pattern:** `*.icims.com`
**Skeleton in `site-patterns.json`:** yes (approximate — verify on dry-run)

### Selectors (approximate — vary by customer theme)
```
itemSelector: .iCIMS_JobsTable .iCIMS_Expandable_Container, .job-row
title:        .iCIMS_JobTitle a, .title a
location:     .iCIMS_InfoMsg_Job
detailUrl:    .iCIMS_JobTitle a [attr: href]
```

### Known pitfalls
- **Theme variability:** iCIMS customers can heavily customize the HTML. The skeleton is a starting point — ALWAYS verify with a dry-run.
- **Mobile URL:** Some instances block headless browsers and require `?mobile=false` appended to the URL.
- **externalJobId:** use the job ID in the `detailUrl` query string (`?in_job_id=12345`) rather than a hash.

---

## SmartRecruiters

**Host pattern:** `careers.smartrecruiters.com/<company>`
**Skeleton in `site-patterns.json`:** yes

### Selectors
```
itemSelector: .job-item, li[data-job-id]
title:        .job-title, h4.title
location:     .job-location, .location
department:   .job-category, .department
detailUrl:    a.job-item-link, a [attr: href]
```

### Known pitfalls
- **Embedded boards:** some companies embed the SmartRecruiters widget in their own site via iframe. If the listing is inside an iframe, the worker can't scrape it directly — use `siteUrl` pointing to the `careers.smartrecruiters.com` board URL instead.
- **externalJobId:** use `data-job-id` attribute if present — it's stable.

---

## Ashby

**Host pattern:** `jobs.ashbyhq.com/<company>`
**Skeleton in `site-patterns.json`:** yes

### Selectors
```
itemSelector: [data-testid='jobPosting'], .ashby-job-posting-brief
title:        .ashby-job-posting-brief-title, h3
department:   .ashby-job-posting-brief-department
location:     .ashby-job-posting-brief-location
detailUrl:    a [attr: href]
```

### Known pitfalls
- **React SPA:** use networkidle wait. Selectors are stable across Ashby customers (unlike iCIMS).
- **Apply form:** Ashby detail pages carry a native multi-step apply form. It's worth capturing — use `form-capture.md`. The form structure is consistent across Ashby customers.

---

## Adding a new ATS pattern

When you successfully onboard a site on an ATS not listed here:
1. Confirm the skeleton via `verify-config` (exit 0).
2. Save the working config to the cache:
   ```
   npx tsx scripts/addsite-batch.ts patterns-update \
     --vendor <vendor-name> \
     --skeleton-file .scratch/<site>/confirmed-config.json \
     --notes "<what was unusual>"
   ```
3. Append a section to this file with the working selectors and pitfalls.
4. Commit both `scripts/site-patterns.json` and this recipe file.
