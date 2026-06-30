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

**Host patterns:** `comeet.com/jobs/<company>/<company-uid>` (and `comeet.co`), often
**embedded via an `<iframe>`** on a company careers page.
**Skeleton in `site-patterns.json`:** yes (refreshed 2026-06-25 — verified on betshemeshengines, 35 jobs)

> **The board markup does NOT use `data-qa='position*'` classes** — the old skeleton's
> `.position-name` / `.position-location` selectors matched nothing. Use the selectors
> below. Verify on a dry-run/scrape; positions are server-rendered in the initial HTML
> and Angular hydrates client-side (render reliably at `domcontentloaded`).

### Selectors (verified)
```
itemSelector: li:has(> a.positionItem)      ← wrap the <a> in its <li> so detailUrl resolves
title:        .positionLink
location:     .positionDetails li            ← first li; often the company name, not a city
detailUrl:    a.positionItem [attr: href]
```

`itemSelector` is the wrapping `<li>` (not the `<a>` itself): the worker's field
selectors query *descendants* of the item, so an `<a>` item can't yield its own `href`.
`li:has(> a.positionItem)` isolates exactly the position rows.

### Three fields need a `setupScript` (not plain CSS)

1. **`externalJobId` = the LAST path segment of the item `href`** (the Comeet position
   UID, e.g. `9C.354`, `F3.961`). **The separator varies per item** (`/--/`, `/---/`,
   `/-----/`, `/None/`, …) because it's the slugified title — so **do NOT regex a fixed
   `/--/`**; split on `/` and take the last non-empty segment. These UIDs are unique,
   stable, and ASCII (pass `verify-jobids`).
2. **`department` = the nearest preceding `.positionsGroupTitle` heading.** The board
   groups positions under `<h2 class="positionsGroupTitle">` (MRO, אגף ייצור, …) followed
   by a `ul.two-column-grid` of items. Walk `.positionsGroupTitle, a.positionItem` in
   **document order**, carrying the current heading, and inject it per item.
3. **`description` = merge the labeled detail-page blocks.** Each detail page splits the
   body into `[data-qa='requirementFieldContent']` blocks (Description + Requirements),
   each preceded by an `[data-qa='requirementFieldTitle']` h3. Map description via a
   **2-step `pageFlow`** (listing → detail) and a detail-scope `setupScript` that merges
   all blocks with `structuredText` (setupscript-patterns.md §7–8). Tag listing fields
   `capturedOnUrl: <listingUrl>` and `description` `capturedOnUrl: <a real detail URL>`.

```js
// setupScript — combines all three (listing-scope ids+dept, detail-scope description)
function structuredText(el){ if(!el) return ''; const c=el.cloneNode(true);
  c.querySelectorAll('style,script,link,meta').forEach(n=>n.remove());
  c.querySelectorAll('p,div,ul,ol,li,br,h1,h2,h3,h4,h5,h6,tr').forEach(e=>e.insertAdjacentText('afterend','\n'));
  return c.textContent.replace(/[ \t]+/g,' ').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim(); }
// LISTING: externalJobId from last path segment
for (const a of document.querySelectorAll('a.positionItem')) {
  const li=a.closest('li'); if(!li||li.querySelector('.__ai-jobid')) continue;
  const href=a.getAttribute('href')||''; const clean=href.split(/[?#]/)[0].replace(/\/+$/,'');
  const seg=clean.split('/').filter(Boolean).pop()||href;
  const s=document.createElement('span'); s.className='__ai-jobid'; s.style.display='none'; s.textContent=seg; li.appendChild(s);
}
// LISTING: department from the preceding group heading
{ const nodes=[...document.querySelectorAll('.positionsGroupTitle, a.positionItem')]; let dept='';
  for (const n of nodes){ if(n.classList.contains('positionsGroupTitle')){dept=n.textContent.trim();continue;}
    const li=n.closest('li'); if(!li||!dept||li.querySelector('.__ai-department')) continue;
    const s=document.createElement('span'); s.className='__ai-department'; s.style.display='none'; s.textContent=dept; li.appendChild(s); } }
// DETAIL: merge Description + Requirements
if (!document.querySelector('.__ai-description')) {
  const secs=document.querySelectorAll('[data-qa="requirementFieldContent"]'); const parts=[];
  for (const sec of secs){ const h=sec.parentElement&&sec.parentElement.querySelector('[data-qa="requirementFieldTitle"], h3');
    const label=h?h.textContent.trim():''; const body=structuredText(sec); if(!body) continue;
    parts.push((/description/i.test(label)||!label)?body:(label+':\n'+body)); }
  if (parts.length){ const d=document.createElement('div'); d.className='__ai-description'; d.style.display='none';
    d.textContent=parts.join('\n\n'); document.body.appendChild(d); } }
```

`pageFlow`:
```json
[{ "url": "<board-url>", "action": "navigate", "waitFor": ".positionItem" },
 { "url": "<board-url>/--/*", "action": "a.positionItem", "waitFor": "[data-qa='requirementFieldContent']" }]
```

### Embedded via iframe — onboard the BOARD URL, not the wrapper page
Comeet is frequently embedded in a company careers page via
`<iframe src="https://www.comeet.com/jobs/<company>/<uid>">`. The wrapper page's raw HTML
has **no jobs** (cross-origin iframe — the worker can't read into it), so it gets
**falsely SKIPPED**. Find the iframe `src` (it's in the wrapper HTML / `document.querySelectorAll('iframe')`)
and onboard **that comeet board URL** as the `siteUrl`. Set `companyName` to the real
employer. (LRN-SPA-4: betshemeshengines, embedded on bsel.co.il.)

### formCapture — static template (cross-origin apply iframe)
The apply form opens in a cross-origin iframe (`comeet.co/jobs/<uid>/<pos>/apply`) that
can't be probed live, and is identical across all positions. Ship a **static
`formCapture` template** with a `formSelector` that matches **nothing** on the page (so
the worker uses the static fields, not a live re-extract). Use the **full field schema**
the API requires (`name, label, fieldType, required, tagName`) — `{name,type}` alone is
**rejected** by `updateSiteConfigSchema`:
```json
{ "formSelector": "form.__comeet-apply-static", "actionUrl": "https://www.comeet.co/jobs/<uid>/<pos>/apply", "method": "POST",
  "fields": [
    {"name":"firstName","label":"First Name","fieldType":"text","required":true,"tagName":"INPUT"},
    {"name":"lastName","label":"Last Name","fieldType":"text","required":true,"tagName":"INPUT"},
    {"name":"email","label":"Email","fieldType":"email","required":true,"tagName":"INPUT"},
    {"name":"phone","label":"Phone","fieldType":"tel","required":true,"tagName":"INPUT"},
    {"name":"resume","label":"Resume/CV","fieldType":"file","required":true,"tagName":"INPUT"}
  ] }
```
`detailUrl` alone already satisfies the worker's apply-path gate (the Comeet detail page
hosts the working apply button), but capturing the static form flips QA `formStatus` to
`CAPTURED` and gives the dashboard real apply fields. See `LRN-SPA-2`, `LRN-SPA-5`. Do
NOT attempt a live form probe.

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

## Wix (repeater jobs boards) {#wix}

Wix careers pages come in two shapes. For free-form `richTextElement` blocks, use
`setupscript-patterns.md` §10. For a **repeater** (each job = a set of sibling
components), use this pattern. Cite: `LRN-SPA-6`.

### Fingerprint
- `wixui-*` classes, `comp-*` ids, `data-testid` Wix attrs; jobs are rows in a repeater.
- Each job's fields share **one `__item-<suffix>`** across different `comp-` prefixes:
  title `comp-AAA__item-<s>`, description `comp-BBB__item-<s>`, **requirements
  `comp-CCC__item-<s>`**, apply button `comp-DDD__item-<s>`, row `comp-EEE__item-<s>`.

### Build
- Anchor on one comp's items, derive `<suffix>` (`id.replace('comp-BBB__item-','')`),
  then `getElementById('comp-<prefix>__item-'+suffix)` for every other field.
- **Don't trust the analyzer's field set** — it commonly maps only title+description
  and misses requirements (a separate comp). Dump all ids matching
  `[id*="__item-<suffix>"]` for one job to discover the prefixes.
- Stable `externalJobId`: the suffix is per-row stable → `'<prefix>-'+suffix`.
- Apply button is usually a lightbox popup → see `form-capture.md` §8 (`LRN-APPLY-8`).
- Wix never reaches `networkidle`; rely on `domcontentloaded` + the worker's grace.

## Niloos / Hunter ATS minisite {#niloos}

Israeli employers often link out to a Niloos vacancy at
`minisite.niloos.ai/vacancy/<id>` (alias `minisite.hunter-edge.me`). Cite: `LRN-SPA-7`.

### Fingerprint
- `_nuxt/entry.*.js`, `__nuxt` markers (Nuxt SPA); backend `jobsite-api.hunterhrms.com/api`
  (`/getVacancy`, `/jobs`, `/submit`); loads Google **reCAPTCHA**.
- Static HTML has **zero** `<form>`/`<input>` — the apply form renders client-side.

### Handling
- **Do not** capture the apply form — it's JS-rendered AND captcha-gated, so it can't
  be auto-submitted (same class as `LRN-APPLY-3`).
- Keep the per-job Niloos **apply link** as `applicationInfo` (formStatus URL), or use
  the employer's careers **email** if the brief is email-apply-only. The Niloos page
  itself is not the `siteUrl` — onboard the employer's own listing page.

## Civi.co.il jobs board {#civi}

Israeli ATS platform. Boards are hosted at `app.civi.co.il/promos/id=<TOKEN>&src=<SRC>` and are
commonly **embedded in a company careers page via a cross-origin `<iframe>`**. Cite: `LRN-SPA-8`.

### Fingerprint
- Wrapper page has `<iframe src="https://app.civi.co.il/promos/id=<TOKEN>&src=<SRC>">` — visible in
  static HTML; the iframe itself renders `.proflist .thumb` job cards.
- Each card: `div.thumb-content` with `onclick="openPromo(event,<JOB_ID>,<SRC_ID>,1)"`, a `.title`,
  and a `.descr` (short preview only — not the full description).
- Detail page: `https://app.civi.co.il/promo/id=<JOB_ID>&src=<SRC_ID>` — same origin as the board.
  Contains `#je-title`, `#je-public-id` (the human-facing job number), `#je-descr` (תיאור המשרה),
  `#je-details` (דרישות התפקיד), and a `form.Form` apply form.

### Onboarding rule
**Always onboard the board URL directly** (`app.civi.co.il/promos/id=<TOKEN>&src=<SRC>`) — not the
wrapper company page. The worker cannot read a cross-origin iframe from the wrapper page. SKIP the
wrapper-page site with an adminNote pointing to the board site.

> **Watch out for leftover WP Job Openings (AWSM) posts** on the wrapper page: WordPress sites that
> also had the AWSM plugin installed may have demo/placeholder jobs in the raw HTML. The worker will
> scrape those instead of the iframe content, producing jobs with Hebrew lorem-ipsum descriptions.
> Always check the description text and `je-public-id` field to confirm you're reading the real board.

### Selectors
```
itemSelector:   .proflist .thumb
title:          .__ai-title       ← injected from detail page in setupScript
description:    .__ai-description ← injected from #je-descr in detail page
requirements:   .__ai-requirements ← injected from #je-details in detail page
location:       .__ai-location    ← hardcoded HQ city injected in setupScript
externalJobId:  .__ai-jobid       ← first arg of openPromo() onclick
applicationInfo: .__ai-applicationInfo ← per-job JSON blob injected in setupScript
detailUrl:      a.__ai-detailurl [attr: href]
```

### setupScript (full — listing-only, no pageFlow needed)

The board and its detail pages are same-origin, so `await fetch()` works without CORS issues.
The script fetches each detail page, injects full description + requirements + per-job apply,
and is idempotent (guarded by `.__ai-jobid` presence check).

```js
const items = [...document.querySelectorAll('.proflist .thumb')];
const txt = (el) => el ? (el.innerText || el.textContent || '').trim() : '';
const mk = (cls, val) => { const s = document.createElement('span'); s.className = cls; s.textContent = val; return s; };
const applyFields = [
  {name:'Form_submitted',label:'',tagName:'INPUT',required:false,fieldType:'hidden'},
  {name:'name',label:'שם מלא',tagName:'INPUT',required:true,fieldType:'text'},
  {name:'phone',label:'טלפון',tagName:'INPUT',required:true,fieldType:'tel'},
  {name:'email',label:'דוא"ל',tagName:'INPUT',required:true,fieldType:'email'},
  {name:'cv',label:'קורות חיים',tagName:'INPUT',required:true,fieldType:'file'}
];
await Promise.all(items.map(async (item) => {
  if (item.querySelector('.__ai-jobid')) return;
  const tc = item.querySelector('.thumb-content');
  if (!tc) return;
  const m = (tc.getAttribute('onclick') || '').match(/openPromo\(event,(\d+),(\d+)/);
  if (!m) return;
  const jobId = m[1], srcId = m[2];
  const detailUrl = 'https://app.civi.co.il/promo/id=' + jobId + '&src=' + srcId;
  let title = txt(tc.querySelector('.title'));
  let descr = '', req = '';
  try {
    const r = await fetch(detailUrl);
    const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
    descr = txt(doc.querySelector('#je-descr'));
    req   = txt(doc.querySelector('#je-details'));
    const t = txt(doc.querySelector('#je-title'));
    if (t) title = t;
  } catch (e) {}
  item.appendChild(mk('__ai-jobid', jobId));
  item.appendChild(mk('__ai-title', title));
  item.appendChild(mk('__ai-location', 'HARDCODE_CITY_HERE'));  // ← replace with real HQ city
  if (descr) item.appendChild(mk('__ai-description', descr));
  if (req)   item.appendChild(mk('__ai-requirements', req));
  item.appendChild(mk('__ai-applicationInfo',
    JSON.stringify({actionUrl: detailUrl, method: 'POST', fields: applyFields})));
  const a = document.createElement('a');
  a.className = '__ai-detailurl';
  a.href = detailUrl;
  item.appendChild(a);
}));
```

Replace `HARDCODE_CITY_HERE` with the company's HQ city (e.g. `כפר סבא`). Civi boards carry no
per-job location field — the HQ is the correct default for single-office employers.

### formCapture
Capture the static form from any detail page as a site-level fallback. The per-job
`.__ai-applicationInfo` blob (injected above) carries the exact per-job URL, which takes
precedence in the dashboard. Use `formSelector: "form.Form"` with a sample `actionUrl`
(`/promo/id=<any_job_id>&src=<SRC>`):

```json
{
  "formSelector": "form.Form",
  "actionUrl": "https://app.civi.co.il/promo/id=<SAMPLE_JOB_ID>&src=<SRC_ID>",
  "method": "POST",
  "fields": [
    {"name":"Form_submitted","label":"","fieldType":"hidden","required":false,"tagName":"INPUT"},
    {"name":"name","label":"שם מלא","fieldType":"text","required":true,"tagName":"INPUT"},
    {"name":"phone","label":"טלפון","fieldType":"tel","required":true,"tagName":"INPUT"},
    {"name":"email","label":"דוא\"ל","fieldType":"email","required":true,"tagName":"INPUT"},
    {"name":"cv","label":"קורות חיים","fieldType":"file","required":true,"tagName":"INPUT"}
  ]
}
```

### pageFlow
`[]` — no pageFlow needed. All enrichment happens inside the setupScript via same-origin fetch.

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
