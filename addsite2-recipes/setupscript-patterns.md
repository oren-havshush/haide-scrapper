# Recipe: setupScript Patterns

> Load this recipe when a field value is **not extractable by a plain CSS selector**.
> Common signals:
> - Field value is embedded inside formatted text (`"Tel Aviv | Full-time | Engineering"`)
> - Field value requires data from a parent/sibling element (`department` as a heading above the list)
> - Field value requires a network call to a different endpoint (salary from an API)
> - Site uses dynamic content loading that a static selector can't capture
> - Elementor popup / modal with job details

---

## 0. setupScript rules (always apply)

Before writing any `setupScript`:

1. **Inject into the item root:** append `<span class="__ai-<field>">value</span>` to the item root element (the element matched by `itemSelector`), NOT to a child.
2. **Guard re-runs:** `if (item.querySelector('.__ai-<field>')) continue;` — the script may run multiple times.
3. **`await` is supported — but do NOT wrap async work in a bare IIFE.** The worker
   runs your script as `new AsyncFunction(src); await fn()`. Bare top-level `await`
   statements are awaited correctly. A **bare async IIFE** `(async()=>{…await…})();`
   is an un-returned expression statement — the worker resolves it immediately and
   continues **before your async work finishes** (symptom: load-more loop / fetch
   appears not to run, only the initial DOM is scraped — one1.co.il, 30/104). If you
   must use an IIFE, `return` it: `return (async()=>{…})();`. Simplest: just write
   bare top-level `await`, no IIFE.
4. **Runs on listing AND detail pages** — write defensively (check element existence before reading).
5. **Do NOT append to an element that another field selector already reads.** You will corrupt that field's output. (`LRN-SETUP-1`: msh.co.il department injection broke location.)

---

## 1. Department from parent heading

**Use case:** department is an `<h2>` or `<h3>` above a group of job items, not inside each item.

```js
// setupScript
for (const section of document.querySelectorAll('.department, [data-section]')) {
  const dept = section.querySelector('h2, h3, .dept-name')?.innerText?.trim();
  if (!dept) continue;
  for (const item of section.querySelectorAll('.opening, .job-item, [data-qa="position"]')) {
    if (item.querySelector('.__ai-dept')) continue;
    const span = document.createElement('span');
    span.className = '__ai-dept';
    span.style.display = 'none';
    span.textContent = dept;
    item.appendChild(span);
  }
}
```

Then in `fieldMappings`:
```json
{ "department": { "selector": ".__ai-dept" } }
```

---

## 2. Field value from formatted text

**Use case:** location, department, or date is packed into a single text string:
`"תל אביב | משרה מלאה | הנדסה"` — need only the first segment.

**Option A: setupScript to split and inject**
```js
for (const item of document.querySelectorAll('.job-item')) {
  if (item.querySelector('.__ai-loc')) continue;
  const meta = item.querySelector('.job-meta')?.innerText ?? '';
  const parts = meta.split('|').map(s => s.trim());
  const loc = parts[0] || '';
  const span = document.createElement('span');
  span.className = '__ai-loc';
  span.style.display = 'none';
  span.textContent = loc;
  item.appendChild(span);
}
```

**Option B: use `extractAttr` on a `data-*` attribute** (if the site stores values as data attributes — check the DOM first; this is zero-cost if available).

---

## 3. externalJobId — hash-based synthesis

**Use case:** no native job ID attribute; no stable URL slug; need a stable dedup key.

**Priority order (always try in this order):**
1. **Native id** — `data-job-id` / `data-id` attr, or a printed "מס' משרה" / req number.
   - **Req number printed inside the TITLE** (very common on Hebrew sites:
     `"משרה 231: רפרנט..."`, `"דרוש/ה מנהל/ת — 4471"`). Regex it out and prefix so
     it can't collide with a hashed id:
     ```js
     const title = item.querySelector('.__title-sel')?.textContent ?? '';
     const m = title.match(/משרה\s*(\d+)/) || title.match(/\b(\d{3,})\b/);
     span.textContent = m ? 'req-' + m[1] : 'h-' + haideHash(title);  // fall back to hash
     ```
2. **detailUrl slug** — `detailUrl.split('/').filter(Boolean).pop()` (readable + stable).
3. **Hash synthesis** — last resort, below.

Use the synchronous `haideHash` (djb2) — **not** `crypto.subtle.digest`, which is
async and adds an `await` round-trip inside the injected script. Always prefix
the synthesized id with **`h-`** so it can never collide with a native numeric id
in a hybrid site, and so the `verify-jobids` gate can recognise it.

```js
// setupScript — h-<hash> of stable content (title + disambiguator)
function haideHash(s){var h=5381,i=s.length;while(i){h=(h*33)^s.charCodeAt(--i);}return (h>>>0).toString(36);}
for (const item of document.querySelectorAll('.job-item')) {
  if (item.querySelector('.__ai-eid')) continue;
  const title = item.querySelector('.job-title')?.innerText?.trim() ?? '';
  const loc   = item.querySelector('.job-location')?.innerText?.trim() ?? '';
  const dept  = item.querySelector('.job-dept')?.innerText?.trim() ?? '';
  // disambiguator (loc/dept/branch) only needed when titles can repeat;
  // if titles are globally unique, hash the title alone.
  const key   = `${title}|${loc}|${dept}`.toLowerCase().replace(/\s+/g, ' ').trim();
  const span  = document.createElement('span');
  span.className = '__ai-eid';
  span.style.display = 'none';
  span.textContent = 'h-' + haideHash(key);   // ASCII-safe, compact, reorder-proof
  item.appendChild(span);                      // append to item root, NOT the title el
}
```

**Hybrid (native-id-first, hash fallback):** when only *some* items carry a native
id, keep the real ones and only hash the rest. The `h-` prefix guarantees the two
shapes never collide:
```js
span.textContent = nativeId ? nativeId : ('h-' + haideHash(key));
```

**Why these rules (enforced by `verify-jobids`, exit 2):**
- **Never reuse the raw title as the id** — the id must differ from the title;
  raw Hebrew/RTL titles also fail the ASCII-safe check. (Caught on alubin.com,
  `LRN-ID-4`.)
- **Never index-based** (`item-0`, `0`, `1`) — re-keys on every reorder.
- **Never all-identical / empty** — collapses every row into one deduped job.
- Trade-off: the hash still changes if the site *edits the title text* — unavoidable
  with no native id, but strictly better than index/title.

> Cite: `LRN-ID-1`, `LRN-ID-2`, `LRN-ID-4` in `docs/addsite-learnings.md`.
> Verified hash recipe: halilit.com, hamat-group.co.il (addsite), alubin.com (addsite2).

---

## 4. Elementor popups

**Use case:** job details hidden inside an Elementor popup/modal triggered by clicking a job card.

Signal: `data-elementor-type` in the page HTML, and clicking a job card opens a modal.

**Strategy:** the worker does NOT click. Instead, enumerate popup templates directly from the DOM:
```js
// Elementor popups are pre-rendered but hidden — enumerate the templates
const popups = document.querySelectorAll('[data-elementor-type="popup"], .elementor-popup-modal');
for (const popup of popups) {
  // each popup corresponds to one job — match by title
  const title = popup.querySelector('.elementor-heading-title, h3')?.innerText?.trim();
  // inject hidden spans so the worker can read popup content without clicking
}
```

This is complex and site-specific. If the popup approach doesn't yield ≥3 items reliably, fall back to:
1. Is there a separate listing page with all jobs (without popups)?  If yes, use that URL instead.
2. Is there a JSON endpoint the page loads data from? Check Network tab → use `setupScript` with `fetch()` + `bypassCSP`.

---

## 5. Dynamic content / lazy-load

**Use case:** jobs load from an API/XHR call after page load.

Signal: DOM has 0 items immediately after `domcontentloaded`, but items appear after a delay.

```js
// setupScript — wait for items to appear
await new Promise(resolve => {
  const check = () => {
    if (document.querySelectorAll('.job-item').length > 0) return resolve(null);
    setTimeout(check, 300);
  };
  check();
});
```

If the data comes from a known API endpoint (visible in Network tab):
```js
// setupScript — fetch data directly and inject items
const data = await fetch('/api/jobs').then(r => r.json());
const container = document.querySelector('#jobs-container');
for (const job of data.results) {
  const div = document.createElement('div');
  div.className = 'job-item';
  div.innerHTML = `<span class="__ai-title">${job.title}</span>
    <span class="__ai-loc">${job.location}</span>
    <a class="__ai-link" href="${job.url}">${job.title}</a>`;
  container.appendChild(div);
}
```

Then map selectors to `.__ai-*`. This is the most reliable approach for pure-API sites.
See also: `pagination-and-loading.md` for infinite scroll and "load more" patterns.

---

## 6. Location from gazetteer / IL address parsing

Hebrew location strings often contain extra content: `"מיקום: תל אביב-יפו, ישראל"`.

The worker has a built-in IL gazetteer normalizer — it extracts the city name from freeform Hebrew text if `location` is mapped. You do NOT need a setupScript just to clean Hebrew location strings.

**Only use setupScript for location if:**
- The city name is embedded inside a non-dedicated element (part of a larger string).
- The city name needs to be split from a `<br>`-separated multi-value string.
- The city is packed into the **title** after a dash (`"מפעיל מכונות – אלון תבור"`):
  ```js
  const m = title.match(/^(.*?)\s*[\u2013\u2014-]\s*(.+)$/);   // em/en/hyphen dash
  if (m) { cleanTitle = m[1].trim(); location = m[2].trim(); }
  ```

**Hardcode a constant location** when the employer is single-site and prints **no**
per-job location anywhere in the DOM (verify on the About / contact page that ALL
roles are at one office, e.g. yeadim → "פתח תקווה"):
```js
const span = document.createElement('span');
span.className = '__ai-location'; span.style.display = 'none';
span.textContent = 'פתח תקווה';        // confirmed single office
item.appendChild(span);
```

Cite: `LRN-LOC-1`, `LRN-LOC-2` in `docs/addsite-learnings.md`.

---

## 7. Description — preserve line breaks (`structuredText`)

**Signal:** the scraped description renders as **one run-on line** — the
`תיאור` / `דרישות` / `כישורים` / bullet items are all glued together with no
separation. (Recurring: pc.co.il, tama.co.il, naamat.org.il.)

**Root cause:** `textContent` / `innerText` on a block (`<p>`, `<ul><li>`, `<br>`)
collapses the visual line breaks. The classic mistake is "cleaning" the text with
`.replace(/\s+/g, ' ')` — that **destroys** every newline.

**Rule: NEVER use `.replace(/\s+/g,' ')` on a description.** Use this helper, which
inserts a real newline after each block boundary *before* reading the text:

```js
function structuredText(el){
  if (!el) return '';
  const c = el.cloneNode(true);
  // newline AFTER every block-level boundary, then read textContent
  c.querySelectorAll('p,div,ul,ol,li,br,h1,h2,h3,h4,h5,h6,tr')
    .forEach(e => e.insertAdjacentText('afterend', '\n'));
  return c.textContent
    .replace(/[ \t]+\n/g, '\n')   // trim trailing spaces per line
    .replace(/\n{3,}/g, '\n\n')   // collapse >2 blank lines to one gap
    .trim();
}
```

Use it when you build a `__ai-description` span:
```js
const span = document.createElement('span');
span.className = '__ai-description'; span.style.display = 'none';
span.textContent = structuredText(item.querySelector('.job-body, .Content'));
item.appendChild(span);
```

---

## 8. Description — merge multiple labeled sections

**Signal:** the detail page splits the body into several **labeled rows/blocks**
(`תיאור התפקיד`, `דרישות התפקיד`, `כישורים`, `תנאים`) but the analyzer maps only
**one** of them, so requirements/qualifications are missing. (naamat.org.il,
tama.co.il.)

**Fix:** concat every labeled section (preserving the label as a heading, except the
plain "תיאור" lead-in) into one `__ai-description`, using `structuredText` (§7) per
section so line breaks survive. On a **detail page** (one job per page) appending to
a stable container is fine; map `description → .__ai-description` with
`capturedOnUrl` = a sample detail URL.

```js
// DETAIL page — runs via the same setupScript (guard so it only fires once)
if (!document.querySelector('.__ai-description')) {
  const parts = [];
  // adapt the row selector to the site (e.g. '.jobs-row', '.content-section')
  for (const row of document.querySelectorAll('.jobs-row')) {
    const label = row.querySelector('.jobs-row-label, h3, strong')?.textContent?.trim() || '';
    const body  = structuredText(row.querySelector('.jobs-row-input, .value, .content'));
    if (!body) continue;
    // keep the lead description label-less; prefix the rest with their label
    parts.push(/תיאור/.test(label) || !label ? body : `${label}:\n${body}`);
  }
  if (parts.length) {
    const span = document.createElement('div');
    span.className = '__ai-description'; span.style.display = 'none';
    span.textContent = parts.join('\n\n');
    document.body.appendChild(span);
  }
}
```

> The same `setupScript` runs on listing AND detail pages, so combine the
> listing-scope injection (ids, location) and this detail-scope merge in one script,
> each guarded by an existence check.

---

## 9. Description vs Requirements — splitting a mixed job body

**When to use this vs §8:** §8 (merge labeled sections) is for sites where the DOM
already segments the content into clearly-labeled rows. Use §9 when the job body
is **one unseparated block** that contains both description and requirements and you
want to populate a separate `requirements` field. If you don't need a separate
`requirements` field, use §8 (or just inject the full body as `description`).

**Signal:** single `.job-body` or `.jobPosition` block with description prose +
requirements bullets/list all mixed in, and the site has a `requirements` field.

### Guardrails (learned from calanit.co.il — applied + verified 2026-06-21)

**1. Narrow bullet-marker regex — never treat plain `•`/`●` as "requirements".**

Many sites use plain bullets (`\u2022`, `\u25CF`) for ALL sections — overview,
responsibilities, conditions, AND requirements. Only distinctive emoji markers
should auto-classify a block as requirements:
`✅ ⭐ ✔ ✓ ☑ ❖ ✦ ➤` (`\u2705 \u2B50 \u2714 \u2713 \u2611 \u2756 \u2726 \u27A4`).

```js
// GOOD: exclude plain bullets
const bulletRe = /[\u2705\u2B50\u2714\u2713\u2611\u2756\u2726\u27A4]/;
// BAD: includes • and ● — will over-classify any bulleted content as requirements
const bulletRe = /[\u2705\u2B50\u2714\u2713\u2611\u2022\u25CF\u2756\u2726\u27A4]/;
```

**2. Heading-keyword detection must require a SHORT element (< 120 chars).**

A Format-B requirements heading ("דרישות חובה:", "Requirements:") is short. A
500-char paragraph that incidentally contains "דרישות" in body text must NOT
trigger classification.

```js
// GOOD: length-guarded
const rawTxt = (node.textContent || '').trim();
const isHeading = /^H[1-6]$/.test(node.tagName)
  || (/:\s*$/.test(rawTxt) && rawTxt.length < 120);

// BAD: no length guard — matches "על בסיס דרישות שהוגדרו ע״י..." (300 chars)
const isHeading = /^H[1-6]$/.test(node.tagName)
  || /:\s*$/.test((node.textContent || '').trim());
```

**3. Final dedup guard — if `description === requirements`, clear requirements.**

When the entire job body is 100% emoji-bullet content, the fallback puts the
same text in both fields. Always guard before injecting:

```js
if (description && requirements && description === requirements) {
  requirements = '';
}
```

**4. Short-description fallback — trigger on length, not just emptiness.**

After removing requirement nodes from the description clone, some jobs retain
only a trivial footer line ("המשרה פונה לשני המינים" — 24 chars). Trigger the
fallback when `description.length < 40 && requirements.length > 100`:

```js
if ((!description || (description.length < 40 && requirements.length > 100)) && requirements) {
  // re-build description from full body minus metadata/buttons/CTAs
}
```

**Dry-run validation:** test on ≥ 3 representative jobs before PUT:
- `description.length > 40` for all
- No job has `description === requirements`
- `overlap = reqLines_that_appear_in_desc / total_reqLines < 0.3`

---

## 10. Wix richText sites — jobs in `[data-testid="richTextElement"]` blocks

**Signal:** page has `[data-testid="richTextElement"]`, `wixui-*` classes, or
`comp-*` element IDs. The Step 3b cluster scan finds nothing (no repeating job
structure), and it looks like an auto-skip candidate. **Do NOT skip on that
basis.** Try this recipe; only skip if the dry-run yields < 2 jobs.

**Detect:** check fetched HTML for `richTextElement` / `wixui-` / `comp-`.

**Structural unit:** a `<section>` that contains **exactly one**
`[data-testid="richTextElement"]` **and** at least one `a[href^="mailto:"]`.
This pairing naturally excludes header/nav/footer and מכרז/tender notices.

```js
const items = Array.from(document.querySelectorAll('section')).filter(s =>
  s.querySelectorAll('[data-testid="richTextElement"]').length === 1 &&
  s.querySelector('a[href^="mailto:"]')
);
items.forEach(section => {
  const rt = section.querySelector('[data-testid="richTextElement"]');
  const lines = (rt.innerText || '').split('\n').map(l => l.trim()).filter(l => l.length > 2);
  const title = lines[0] || '';
  const description = (rt.innerText || '').trim();
  const email = (section.querySelector('a[href^="mailto:"]').getAttribute('href') || '')
    .replace(/^mailto:/i, '').split('?')[0];
  // stable id: hash of title (no native id on Wix richText blocks)
  const id = 'wix-' + [...title].reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0);

  const el = document.createElement('div');
  el.setAttribute('data-haide-job', '1');
  const mk = (cls, val) => { if (!val) return; const d = document.createElement('div');
    d.className = cls; d.style.display = 'none'; d.textContent = val; el.appendChild(d); };
  mk('__ai-title', title);
  mk('__ai-jobid', id);
  mk('__ai-description', description);
  mk('__ai-apply', email);
  // inject el into a root container
});
```

**Config shape:** single-page (`pageFlow: []`, `formCapture: null`),
`waitUntil: "domcontentloaded"` + `waitAfterLoad: 5000` (Wix `networkidle`
never settles). `applicationInfo` field → `.__ai-apply`.

**Location:** usually not structured — leave empty; the worker's IL gazetteer
fills some. Only hardcode a constant location when the whole site is confirmed
single-city.

**Reference:** tarbut-herzliya.co.il (`cmqe6q0i3004a01lcx1zvh6d2`) — 5 jobs,
per-job apply email, `הרצליה` hardcoded (single-city municipal employer); the
מכרז פומבי tender block correctly excluded (no `mailto:`).

---

## 11. Detail-page fetch from the listing — `description`/`requirements` only on detail pages

**Signal (`LRN-SETUP-2`):** the listing page has title/location/id but the
`description` (and/or `requirements`) live **only on each job's detail page**, and
you do NOT want to rely on the worker's per-detail-page visit (e.g. the worker only
extracts from the listing, or you want both fields in one pass). Symptom at QA:
`description=0` / `requirements=0` despite the detail pages clearly having the text.

**Fix — attempt this in Step 5b, BEFORE the first PUT** (do not wait for QA to flag
`description=0`). Write a listing-scope `setupScript` that `await fetch()`es each
item's detail URL, parses the returned HTML, and injects `.__ai-description` /
`.__ai-requirements` into that item.

```js
// LISTING page — fetch each detail page and inject its body into the item.
// Use bare top-level await (NOT a bare async IIFE — see §0 rule 3).
const items = Array.from(document.querySelectorAll('YOUR_ITEM_SELECTOR'));
for (const item of items) {
  if (item.querySelector('.__ai-description')) continue;
  const href = item.querySelector('a')?.href;
  if (!href) continue;
  try {
    const html = await fetch(href).then(r => r.text());
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // adapt these selectors / heading matches to the site:
    const descEl = doc.querySelector('SECTION_FOR_DESCRIPTION');
    const reqEl  = doc.querySelector('SECTION_FOR_REQUIREMENTS');
    const mk = (cls, el) => {
      const txt = el && (el.innerText || el.textContent || '').trim();
      if (!txt) return;
      const span = document.createElement('div');
      span.className = cls; span.style.display = 'none'; span.textContent = txt;
      item.appendChild(span);
    };
    mk('__ai-description', descEl);
    mk('__ai-requirements', reqEl);
  } catch (e) { /* skip this item on fetch error */ }
}
```

**Notes:**
- This issues N extra requests (one per job) at scrape time — fine for small/medium
  listings; for hundreds of jobs prefer a JSON list endpoint (pagination recipe §0)
  or let the worker visit detail pages via a `detailUrl` mapping instead.
- If the detail page splits the body into labeled sections, reuse the §8 merge logic
  on the fetched `doc`.
- If `fetch()` to the detail page hits a CSP error, add `bypassCSP: true` to the config.

**Reference:** madanes.com (`cmqo82ph6001301qpa01wzqn7`) — 7 jobs; description +
requirements fetched from each detail page's `במסגרת התפקיד` / `דרישות` `<h2>`
sections and injected into the listing items. Cite: `LRN-SETUP-2`.
