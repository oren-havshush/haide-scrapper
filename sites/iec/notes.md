# careers.iec.co.il — חברת החשמל

| | |
| --- | --- |
| Listing URL | https://careers.iec.co.il/?referid=&freeText=&page=1 |
| siteId | `cmpnt68rb002301mv6h7d28yg` |
| Status | **ACTIVE** — 44 jobs |
| Platform | WordPress (`adam-jobs-plugin`), jobs rendered client-side |
| Apply | `formCapture` (26 fields) — see §3, the captured method is **not** the real one |

## How it works

The listing renders 43–44 `.job_link_and_share_wrap.job_item` rows, each carrying
`data-order_id`. **The full ad body is already on the page**, in a script tag:

```js
const orders = JSON.parse(`{"15107":{"order_id":…,"name":…,"content":…,"areas":…}}`)
```

Clicking a job title only calls `init_single_page(orders[order_id])`, which fills
`[data-fill="…"]` slots in a single `#single_job_popup` overlay. So there is **no
detail fetch and no click flow to drive** — the setupScript reads `orders` directly
and injects per-item spans. Every fix here is a data transform, not a selector change.

`orders[id]` keys: `order_id, is_hot, name, content, areas, profs, last_date, link,
parent_category, share, video, friend, special_order, agaf, machlaka`.

## Gotchas

### 1. The listing blurb is not the ad

`.career_short_description` holds a truncated teaser (~486 chars avg). The real body
is `orders[id].content` (~1,195 chars of text, up to 10k of HTML). Mapping
`description` to the listing element loses ~60% of the ad **and** all of its structure,
which is why this site read as 100% blob and had `requirements` empty on every job.

Map `description`/`requirements` to the injected `[data-x-description]` /
`[data-x-requirements]` instead.

### 2. Three sections, and the third was being dropped

Ad bodies carry up to three labeled blocks: `תיאור המשרה`, `דרישות חובה`, and
`דרישות יתרון`. The advantage block was lost entirely — it is not a separate API
field, it is a heading inside `content`.

There is no `advantage` column on `Job`, so the split writes:

- `description` ← the body above the requirements heading
- `requirements` ← the mandatory block, then a blank line, then `יתרון:` + the advantage items

Order matters when finding the headings: search for **`דרישות יתרון` before the
generic `דרישות`**, otherwise the advantage heading is swallowed by the mandatory
match and the two sections merge. A requirements heading found *after* the advantage
heading belongs to the advantage block and is ignored.

Coverage over 44 jobs: description 44, requirements 42, advantage 30.

### 3. The apply form is recorded as GET — it is really a POST, and not replayable

`#send_user_cv` has **no `method` and no `action` attribute**, so the DOM defaults
(`GET`, current page URL) are what capture records. They are not the real target.
`ready.js` intercepts submit:

```js
let form_data = new FormData($form[0]);
form_data.append("action", action);
form_data.append("recaptcha_token", token);
jQuery.ajax({ url: globalVars.ajaxurl, data: form_data, method: 'POST',
              contentType: false, processData: false, dataType: 'JSON' })
```

Real endpoint: `POST https://careers.iec.co.il/wp-admin/admin-ajax.php`,
`multipart/form-data`.

**Two required fields exist nowhere in the DOM** — `action` and `recaptcha_token` —
so the 26 captured fields are only the visible inputs. The site runs reCAPTCHA v3
(`globalVars.google_recaptcha = "1"`), and the token is minted per submission. The
form is worth capturing for its field structure but **cannot be submitted by
replaying a captured payload**.

### 4. This config was once destroyed by a re-analysis

On 2026-08-06 a re-analysis replaced the working config with one whose selectors all
pointed at `#single_job_popup` and which had **no `itemSelector`**. Auto-detection
then found 9 repeating items, collapsed them to the 1 popup container, and extracted
0 records — `empty_results` on every run, with every selector reporting "MATCHED".
The site's 53 jobs were deleted and it dropped to `REVIEW` with `configLocked`
released.

If this site ever reports zero jobs again, check `_meta.itemSelector` first.
`configLocked` re-arms on save; keep it locked.
