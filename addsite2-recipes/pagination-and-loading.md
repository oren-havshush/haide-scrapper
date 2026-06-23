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

**WordPress `admin-ajax.php` — use the "all jobs" action, not the "hot/featured" one.**
WordPress job boards often fire multiple AJAX calls on page load:
- one for **all jobs** (e.g. `action=tb_get_jobs`) — returns the full list
- one for **featured/hot jobs** (e.g. `action=tb_get_hot_jobs`) — returns only 3–5 highlighted items

Always intercept ALL `admin-ajax.php` POST calls and compare counts. The featured
action will look identical in structure but return a tiny subset. Use the action
that returns the highest count. Cite: `LRN-COV-2` (tigbur.co.il — `tb_get_hot_jobs`
returned 5 jobs; `tb_get_jobs` returned 576).

**WordPress REST API — the PREFERRED path for ANY WordPress job board.**
Before fighting a "load more" button, an empty `ul.job_listings`, or per-job detail
navigation, check the built-in WP REST API. It returns **every** post (no pagination
button, no AJAX nonce) **with the full description, real ISO publish date, detail
link, and meta** — in a handful of bulk calls. This single source solves three
problems at once: load-more coverage, description-on-detail, and throughput.

1. **Find the post type.** WP Job Manager's default is `job_listing`, but the REST
   `rest_base` is often a different slug (e.g. `job-listings`). Discover it:
   ```
   GET /wp-json/wp/v2/types        → look for a job-ish type, read its "rest_base"
   GET /wp-json/wp/v2/<rest_base>?per_page=1   → confirm 200 + an X-WP-Total header
   ```
   Common slugs to try directly: `job-listings`, `job_listing`, `jobs`, `vacancies`,
   `positions`, `careers`.
2. **Pull all pages** (`per_page=100`, walk `page=1..N` until `X-WP-Total`/`<100`),
   requesting only what you need: `&_fields=id,link,date,title,content,meta,<taxonomy>`.
3. **Map fields** from each record: `id`→externalJobId (stable WP post id),
   `link`→detailUrl, `date`→publishDate (real ISO — better than relative
   "פורסם לפני N ימים" on the cards), `title.rendered`→title (HTML-entity-decode it),
   `content.rendered`→description (run through `structuredText` to keep line breaks;
   WP often **double-encodes** entities so decode twice — `&bull;`/`&nbsp;`), and
   `meta._job_location` / a `*_region` taxonomy → location, `meta._application` →
   the apply email/URL.
4. **Build the items in `setupScript`** (single-page mode, no `pageFlow`): clear
   `ul.job_listings`, create one `li.job_listing` per record with the real card
   classes (`h3.job_listing-title`, `a.job_listing-clickbox[href]`,
   `.job_listing-location`) plus hidden `.__ai-jobid` / `.__ai-date` /
   `.__ai-description` / `.__ai-apply` spans, and map those as **listing-scope**
   fields. ~4 REST calls, ~10 s, full coverage — vs. 240 detail navigations that
   time out. Reference: tcmcareer.com (240 jobs via `/wp-json/wp/v2/job-listings`;
   the listing card `ul` is empty until AJAX and only ~20 show behind "load more").
   Cite: `LRN-COV-4`.

> **THROUGHPUT LANDMINE — per-job detail navigation caps at ~40 jobs / run.**
> A `pageFlow` that visits each detail page in a real browser costs ~15–20 s/page,
> so the 15-minute worker timeout cuts off around **40 jobs** (the rest are silently
> dropped — the run still reports COMPLETED). If a site has 100+ jobs **and** its
> description lives only on detail pages, do NOT use per-job navigation. Fetch the
> descriptions in **bulk inside `setupScript`** (WP REST `content.rendered`, a JSON
> list endpoint, or `await fetch()` of each detail URL with a concurrency pool) and
> inject `.__ai-description` as a listing-scope field, keeping the scrape single-page.
> Cite: `LRN-COV-4` (tcmcareer: 40/240 via pageFlow → 240/240 via REST in setupScript).

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
