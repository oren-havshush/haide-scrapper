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
3. **`await` is supported.** You do NOT need an IIFE. Top-level `await` works.
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

```js
// setupScript — hash of title + department + location
async function hashStr(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}
for (const item of document.querySelectorAll('.job-item')) {
  if (item.querySelector('.__ai-eid')) continue;
  const title = item.querySelector('.job-title')?.innerText?.trim() ?? '';
  const loc   = item.querySelector('.job-location')?.innerText?.trim() ?? '';
  const dept  = item.querySelector('.job-dept')?.innerText?.trim() ?? '';
  const id    = await hashStr(`${title}|${loc}|${dept}`);
  const span  = document.createElement('span');
  span.className = '__ai-eid';
  span.style.display = 'none';
  span.textContent = id;
  item.appendChild(span);
}
```

> **Hybrid approach (preferred):** if the `detailUrl` contains a job ID slug, extract it instead of hashing:
> `detailUrl.split('/').filter(Boolean).pop()` — more stable than a hash and readable.
> Cite: `LRN-ID-1`, `LRN-ID-2` in `docs/addsite-learnings.md`.

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

Cite: `LRN-LOC-1`, `LRN-LOC-2` in `docs/addsite-learnings.md`.
