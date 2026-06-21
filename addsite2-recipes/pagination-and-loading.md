# Recipe: Pagination & Dynamic Loading

> Load this recipe when:
> - `coverage: extracted/total` shows extracted < total
> - "Load more" / "הצג עוד" button is present
> - Infinite scroll — page loads more items on scroll
> - Numbered pagination (page 1 of N)
> - `topCluster` count from triage is low despite the site having many jobs

---

## 0. Always establish coverage first

Before choosing a pagination strategy, confirm the true total:
1. Check the page for a total count string: `"87 משרות"`, `"Showing 1–20 of 87 jobs"`.
2. Count items currently in the DOM.
3. Emit: `coverage: <extracted>/<total>` in your onboarding log.

If `extracted === total` → no pagination needed, proceed.

**LANDMINE:** never silently ship page-1-only. If coverage is unclear, instrument it.

**Custom CMS sites are often API-backed too** — not just named SPA frameworks.
If DOM scraping returns a suspiciously low or round count (10, 20…) and
scroll/load-more does nothing, open the Network tab before concluding the site
has a DOM pagination problem. Many custom .NET/Umbraco/CMS sites expose a JSON
list endpoint (e.g. `/data/api/ContentData/FrontContentData?ListType=Jobs`)
that returns all jobs in one call. Filter XHR responses by `json` content-type
and look for an array of job-like objects. If found, call it from `setupScript`
via `fetch()` and rebuild the DOM from the response — this is cheaper and more
reliable than DOM-based pagination. Reference: my.migdal.co.il (43 jobs via
`/data/api/ContentData/FrontContentData?ListType=Jobs`, DOM only showed 10).

---

## 1. Numbered pagination (query param)

**Pattern:** `?page=2`, `?p=2`, `&offset=20`.

**Strategy A: multi-URL** — register each page as a separate `siteUrl` entry (limited, messy for many pages).

**Strategy B: `pageFlow` config** — if the server supports predictable URL-based pagination:
```json
{
  "pageFlow": {
    "type": "queryParam",
    "param": "page",
    "start": 1,
    "increment": 1,
    "maxPages": 20
  }
}
```

**Strategy C: `setupScript` + `fetch()`** — call the paginated endpoint directly:
```js
// setupScript — fetch all pages and inject items
const container = document.querySelector('#jobs-list');
let page = 2;
while (true) {
  const data = await fetch(`/api/jobs?page=${page}`).then(r => r.json()).catch(() => null);
  if (!data?.results?.length) break;
  for (const job of data.results) {
    const div = document.createElement('div');
    div.className = '__ai-job';
    div.innerHTML = `<a class="__ai-link" href="${job.url}">${job.title}</a>
      <span class="__ai-loc">${job.location || ''}</span>`;
    container.appendChild(div);
  }
  if (data.results.length < 20) break; // last page
  page++;
  if (page > 50) break; // safety cap
}
```
Then map `itemSelector: .__ai-job`.

---

## 2. "Load more" button

**Pattern:** clicking a button appends more items to the list (e.g. one1.co.il "טען עוד").

**Strategy A (PREFERRED): native `loadMoreSelector` config.** The worker has a
built-in load-more clicker — you do NOT need a setupScript loop. Add the button
selector under `fieldMappings._meta.loadMoreSelector`:
```json
{ "fieldMappings": { "_meta": { "loadMoreSelector": "button.load-more-btn" } } }
```
The worker (`clickLoadMoreUntilStable`) clicks it until the button disappears /
disables or the item count stops growing — defaults: maxClicks 100, settle 3 s,
stop after 2 no-growth rounds, cap 2000 items. It also re-runs your `setupScript`
after expansion so injected fields cover the appended items. This is the robust
path that avoids the async-await landmine below. Use a **CSS** selector
(`button.load-more-btn`), not a Playwright `:has-text()` pseudo — the worker does a
plain `page.$(selector)`.

**Strategy B: find the underlying API** — open Network tab, click "Load more", find the XHR call. Then use the `setupScript` fetch approach from §1 Strategy C.

**Strategy C: inject click loop** — only if `loadMoreSelector` can't target the
button (e.g. text-only match needed) and there's no API:
```js
// setupScript — bare top-level await (NO IIFE wrapper — see landmine)
let btn = document.querySelector('.load-more, [data-load-more]');
let prev = -1, noGrowth = 0;
while (btn && btn.offsetParent !== null) {
  btn.click();
  await new Promise(r => setTimeout(r, 1500)); // wait for items to render
  const total = document.querySelectorAll('.job-item').length;
  if (total === prev) { if (++noGrowth >= 2) break; } else { noGrowth = 0; }
  prev = total;
  btn = document.querySelector('.load-more, [data-load-more]');
  if (total > 500) break; // safety cap
}
```

> **LANDMINE — the worker only `await`s your script if it doesn't swallow the
> promise.** The worker runs `new AsyncFunction(src); await fn()`. Bare top-level
> `await` statements (as above) are awaited correctly. But a **bare async IIFE**
> `(async () => { …await… })();` is an un-returned expression — `fn()` resolves
> immediately and the worker proceeds **before your loop finishes**, so only the
> first page is scraped (one1: 30/104). If you must use an IIFE, **`return` it**:
> `return (async () => { …await… })();`. Simplest: don't wrap in an IIFE at all.

Validate with a dry-run: `coverage: N/total` should now be close to total.

---

## 3. Infinite scroll

**Pattern:** scrolling to the bottom of the page loads more items.

```js
// setupScript — scroll to bottom repeatedly
const TARGET = '.job-item'; // the item selector
let prev = -1;
for (let i = 0; i < 30; i++) { // max 30 scroll cycles
  window.scrollTo(0, document.body.scrollHeight);
  await new Promise(r => setTimeout(r, 1000));
  const count = document.querySelectorAll(TARGET).length;
  if (count === prev) break; // no new items — done
  prev = count;
  if (count > 500) break; // safety cap
}
```

If the page uses a virtual/windowed list (items are removed from DOM as you scroll past them) → switch to Strategy A from §1 (find and call the underlying API directly).

---

## 4. Workday pagination

Workday uses `&offset=N` (not a page number):
```json
{
  "pageFlow": {
    "type": "queryParam",
    "param": "offset",
    "start": 0,
    "increment": 20,
    "maxPages": 25
  }
}
```
Or via setupScript to append offset pages:
```js
const base = window.location.href.split('?')[0];
let offset = 20;
while (true) {
  const resp = await fetch(`${base}?offset=${offset}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
  const text = await resp.text();
  const tmp = document.createElement('div');
  tmp.innerHTML = text;
  const newItems = tmp.querySelectorAll("li[data-automation-id='jobItem']");
  if (!newItems.length) break;
  document.querySelector('.job-list ul')?.append(...newItems);
  offset += 20;
  if (offset > 500) break;
}
```

---

## 5. Safety caps

Always include a safety cap in pagination loops:
- Maximum pages: 50 (most sites have < 500 jobs; 20 items/page = 25 pages max for a 500-job site).
- Maximum items: 1000 (beyond this, consider whether a search/filter narrowing is appropriate).
- Timeout: if a page fetch takes > 10 s, stop and use what you have.

After applying pagination, re-run the dry-run and re-check coverage.
