# elbitsystemscareer.com — אלביט מערכות

| | |
| --- | --- |
| Listing URL | https://elbitsystemscareer.com/jobs/ |
| siteId | `cmpnu619a002701mv7fkjk1e7` |
| Status | **ACTIVE** — 674 jobs |
| Platform | Next.js SPA; jobs come from a JSON API, not the DOM |
| Apply | `formCapture` (9 fields) → `niloo-server.herokuapp.com/actions-elbit` |

## How it works

The page renders nothing scrapable. The `setupScript` POSTs
`{cmd:"get-jobs"}` to `https://niloo-server.herokuapp.com/actions-elbit` (sync XHR) and
builds hidden `.haide-job-card` divs with `[data-haide-*]` spans that the field mappings read.
So **every fix here is a data transform, not a selector change.**

There is also a static feed at `https://elbitsystemscareer.com/cron/jobs.json` which the
site tries *before* the API (see chunk `116.*.js`). We use the API directly; the feed is a
possible fallback if the heroku endpoint ever dies.

## Gotchas

### 1. Description arrives as encoded HTML with zero newlines

The API's `description` contains **no** real `\n` (0/674) — every line break is a
double-encoded `&lt;div&gt;` / `&lt;br&gt;`. The original setupScript ran
`.replace(/\s+/g, ' ')` over it, which flattened all structure: **730/732 jobs were one
run-on blob**. That is the exact anti-pattern in `recipes/setupscript-patterns.md` §7.

Fix: entity-decode → convert `</div>`/`<br>` to `\n` → strip tags → collapse only spaces,
never newlines. Blob count is now **0**.

### 2. `requirements` is inside the description, not in the API field

The API has a `requirements` field but it's populated on only ~1 job after cleaning
(60 look non-empty raw, but they're markup-only). **95%** of descriptions instead carry an
inline heading (`דרישות`, `דרישות התפקיד`, `תנאי סף`…), so requirements are recovered by
splitting the body at that heading.

Guardrails (per §9): the heading regex is narrow, only matches a **line shorter than 60
chars**, and the split is rejected unless *both* halves are ≥40 chars — otherwise the whole
body stays in `description`. `במסגרת התפקיד` is deliberately **not** a split point: that's
responsibilities (description), not requirements.

Result: requirements on **607/674 (90.1%)**, `description === requirements` on 0.

### 3. Locations are codes, and the site's own map is incomplete

`Cities` / `Area` are numeric codes resolved through a map hardcoded in elbit's JS bundle
(`116.*.js`). Two problems:

- **Our copy was stale** — missing `770 = מודיעין` and `1227 = יקנעם`, which alone accounted
  for 87 jobs falling back to a coarse region or nothing.
- **8 ids are missing from elbit's own map too** (`259, 447, 751, 799, 868, 931, 952, 1228`).
  The site itself renders no location for these. Their names were read from each job's
  description prose (`"לאתר החברה בנוף הגליל"` etc.) and are marked `*` in the script —
  **inferred, not authoritative.** If elbit ever reuses an id for a different site, these
  go silently wrong.

All values are spelled per `CSV files/city.csv` (`LRN-LOC-4`): `תל אביב-יפו` not `תל אביב`,
`נצרת עילית` not `נצרת עלית`, `יוקנעם` not `יקנעם`, and regions as `אזור צפון` / `אזור דרום` /
`אזור מרכז` / `אזור השרון` / `אזור שפלה` / `אזור ירושלים`.

`locationAddress` (38 jobs) is free text and always a region — it is normalised through
`ADDR_ALIAS` (`גוש דן → אזור מרכז`, `חיפה והקריות → חיפה`), otherwise it bypasses the map entirely.

Codes `0` (בחר — a dropdown placeholder), `7` (רילוקיישן), `131` (משרה היברידית) and
`DataMigration` are **not places** and fall through to the region instead of being emitted
as locations.

Still outside `city.csv` (real places the CSV lacks): `לוד`, `רמלה`, `תל חי`, `שיזפון`, `חצור`.
`חצור` is ambiguous in the CSV (`חצור הגלילית` vs `חצור אשדוד`) so the bare name is kept.

Result: real location on **667/674 (99.0%)**, 7 left as `Unknown`.

### 4. The privacy checkbox is never sent to the server

The apply form is MUI/React — **no `name` attributes at all**, ids are generated (`_r_9_`).
The `מדיניות פרטיות` checkbox gates the submit button (it renders `Mui-disabled` until
ticked), but reading the submit handler in `app/job/page-*.js` the FormData carries only:

```
jobId, fullName, phoneNumber, email, resumeFile, jobCode, [src]
```

So `privacyPolicy` is captured as a **required checkbox the applicant must tick client-side**,
flagged in its label as not sent to the API. `src` (referral source, optional) was also
missing from the old capture and is now included.

`formSelector` is `.haide-apply-form`, which matches nothing — that forces the worker to use
the static `fields` blob (`recipes/form-capture.md` §7).

## History

- **2026-06-10** — onboarded.
- **2026-08-03** — fixed description/requirements separation (blob 99.7% → 0%, requirements
  5.6% → 90.1%), location coverage (83.2% → 99.0% real) with canonical `city.csv` spelling,
  and added the privacy-consent + `src` fields to the apply capture.
