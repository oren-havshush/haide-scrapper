# Reply — Scraper Source Bridge

**To:** MisrotIL platform side (`haide-frontend` connector + `haide-api` ingest)
**From:** Crawler side (`newscraper`)
**Date:** 2026-08-27
**Re:** SCRAPER-SOURCE-BRIEF.md, 2026-08-26

Answered against your IDs. Every claim below is grounded in a cited file in the crawler repo.
Where we've contradicted something you inferred, §4 says so explicitly — you asked for that above
any single item, and there are five of them, two of which change your plan.

---

## 0. Read this first

Four things outrank the rest of this document.

**Your Q2 has a boring answer: there is no cron.** Nothing is broken. Scrapes are triggered
manually, one site at a time, via `POST /api/sites/:id/scrape`. The 2026-08-20 gap is simply the
last time somebody triggered one. A weekly cron is designed and written down
(`docs/engineer-notes-frozen-status-and-weekly-cron.md`) but not built. See `D1`.

**`Job` rows are deleted and re-inserted on every scrape — and that is not a reliable removal
signal.** `worker/jobs/scrape.ts:3411` runs `prisma.job.deleteMany({ where: { siteId } })` and
then re-inserts in chunks of 20. The delete is *outside* the insert transaction. Three things
therefore empty or truncate a site's inventory while the site itself hasn't changed at all:

- a worker restart mid-scrape — `worker/index.ts:26` deletes that site's jobs outright and sets
  the site to `FAILED`;
- a crash between chunks — the delete has run, only some inserts have;
- a 15-minute timeout — the run is marked `PARTIAL` and keeps only what was chunk-saved.

**Keep your 50% reconciliation guard.** `SRC-01` describes retiring it as a benefit. It is the
thing currently standing between you and mass-expiring a site's inventory because our worker
restarted. We'll give you `removedAt`, but do not drop the guard when we do.

**The failure you have no signal for at all is the opposite one.** When extraction yields zero
items (`scrape.ts:3269`, `failureCategory: "empty_results"`) or items but zero valid records
(`scrape.ts:3335`, `"structure_changed"`), the worker returns **before** the `deleteMany`. The
last good harvest is deliberately preserved. That's correct for availability, and it is exactly
why a dead config is invisible: the site reads `ACTIVE`, the run reads `COMPLETED`, no error is
set, and it serves months-old rows indefinitely. We have three sites on record in that state
(natali, biopharmax, msh — `LRN-WRK-15`).

You can detect this today, with data you already read and no work from us:

> For each site, compare the newest `ScrapeRun.createdAt` against `max(Job.createdAt)` for that
> site. Scraped recently, newest job months old ⇒ the config is dead.

That works precisely *because* of the delete-and-reinsert model: `Job.createdAt` is the time of
the last successful persist, so a large gap between the two can only mean the run returned early
and preserved old rows. This is the highest-value query you can write this week, and it is worth
more to you than most of Tier 1.

---

## 1. Q1–Q9

### Q1 — Is `Job.id` stable? Is `externalJobId` stable and unique? **[critical]**

**`Job.id` is not stable. Never key on it.** It's a `cuid()`, and every scrape deletes and
re-creates every row for that site, so it changes on every run for every job.

**`externalJobId` is your correct key, with caveats.** It has two provenances:

*Native* — extracted per the site's own config. As stable as that site's own id.

*Synthetic* — `worker/lib/synthesizeJobId.ts`. When extraction yields nothing, we synthesise
`"h-" + djb2(title|department|detailUrl)`. The `h-` prefix marks it. Three things you should know:

- It is **content-derived**, so it changes if the title, department, or detail URL changes. A site
  editing a job title will look to you like the old job vanished and a new one appeared. This is
  the main churn risk in your pipeline and it is real.
- It deliberately excludes `location`, because `LRN-ID-7` records exactly the churn incident you
  fear: a location-normalisation fix changed the hash input and rotated ids across a whole site.
- It is index-free — a reordered listing yields identical ids.

**Uniqueness is not enforced by the database.** `externalJobId` is `String?` with no unique
constraint (`prisma/schema.prisma`). It's enforced by two gates instead: the onboarding
`verify-jobids` check, and an activation gate requiring ≥90% fill that re-runs after *every*
scrape. Hash collisions are counted and warned on (`applyJobIdFallback` returns `collisions`), but
two colliding jobs still collapse into one row on save — that's `LRN-ID-8`, and it is silent job
loss on our side, not just yours.

Your 99.9% fill with zero collisions is consistent with what we'd expect. It is not guaranteed by
a constraint, and we'd rather you knew that than assumed it.

### Q2 — Intended cadence, and is the gap expected? **[critical]**

**There is no cron. Scrapes are manual.** The gap is expected in the sense that nothing is broken;
it is not intended in the sense that we want it this way. See `D1`.

**Where to look without asking:** `ScrapeRun`. One row per triggered scrape, with `siteId`,
`status`, `createdAt`, `completedAt`, `jobCount`, and — the field you should be reading and
currently aren't — `failureCategory`. Values include `empty_results`, `structure_changed`,
`timeout`, `apply_requires_login`, `other`. Those are the worker telling you a site has drifted.
Nothing on either side currently reads them after the fact.

### Q3 — Does `applicationInfo.fields[]` include hidden inputs? **[high]**

**You're right about the consequence and wrong about the mechanism, and it differs by which code
path produced the row.** There are two.

*Live extraction* (`worker/jobs/scrape.ts:2499`, runs on every scrape when a detail page is
visited): iterates `input, select, textarea` and skips only `submit`, `button`, `image`, `reset`.
**Hidden inputs are included.** But the serialised field object is
`{name, label, fieldType, required, tagName, options?}` — **there is no `value`**. So `_wpcf7`
appears as a name with no value attached, which fails a CF7 POST exactly as if it were absent.

*Static capture* (the onboarding-time blob, `addsite2-recipes/form-capture.md` lines 140, 208,
263): **explicitly filters `hidden` out.** Your §4 sample — four visible fields, CF7 `file-271` —
is this path.

So both paths block CF7 submission, for two different reasons. Fixing it means capturing `value`
in the live path and dropping the filter in the recipe. We're taking this — see `SRC-08`.

### Q4 — Does the crawler detect captchas or JS-only submission?

**Captcha: no.** The only occurrences in the codebase are a URL filter in
`worker/analysis/networkIntercept.ts:66` (ignoring captcha network requests during analysis) and a
reach-probe failure string. Nothing inspects a form for reCAPTCHA / hCaptcha / Turnstile.

**JS-only submission: no, and there's a trap.** `extractFormData` resolves `actionUrl` to
`window.location.href` when the form has no `action` attribute. So a JS-only form does not present
as missing an action — it presents as posting to itself. **Do not read `actionUrl` as evidence
that a plain POST will work.**

**One thing we do already detect: login-gated apply flows.** `worker/lib/applyGate.ts` catches
login/registration/SSO URLs, password fields, Workday-style account-creation ids, and login CTAs
with no real apply form present. Those sites are auto-skipped with
`failureCategory: "apply_requires_login"` before any scrape budget is spent. That is one whole
class of "out of scope for proxy-apply" already answered — and per your `SRC-09` framing, a
reliable negative is as useful as a positive.

### Q5 — Is schema.org JSON-LD present and kept?

**`Organization` JSON-LD: parsed, then discarded.** `scripts/company-profile.ts:392` collects
every `script[type="application/ld+json"]` block on the homepage, and `parseJsonLdOrganization`
mines it for description and `PostalAddress`. Runs **once, at onboarding**. The raw block is not
persisted.

**`JobPosting` JSON-LD: never looked for in the scrape path.** `scripts/enrich-csv.ts:221` detects
it, but that's a triage-time CSV helper, not the scraper. So your instinct is right — it is very
likely present on a large share of these sites and we are currently walking past it.

We're taking `SRC-03`.

### Q6 — Is compensation captured and dropped, or never captured?

**Never persisted — but it is not absent from the sites.** There is no `salary` column on `Job`
and no salary field in the normalizer. However, all three analysis engines actively hunt for it:
`worker/analysis/patternMatch.ts:716`, `crawlClassify.ts:602-635` (including `שכר` / `משכורת`), and
`networkIntercept.ts:416-442` (matching `salary|pay|wage|compensation|minSalary|maxSalary|…`).

So our own analyzer scores salary as a field candidate on these sites and then has nowhere to put
it. **This is a schema gap on our side, not a genuine absence on the sites.** That should change
how you plan for it. We expect `SRC-03` to fill most of it via `baseSalary` without our needing a
dedicated salary extractor at all.

### Q7 — What's in the tables you don't read?

| Table | What it is | Worth anything to you? |
|---|---|---|
| `AnalysisResult` | Per-site field-mapping discovery output — 4 methods, per-field confidence scores, chosen selectors. Onboarding-time only. | No. Internal. |
| `JobLocationOverride` | Manual location corrections keyed `(siteId, jobKey)` where `jobKey = externalJobId ?? detailUrl`. Re-applied after every scrape so they survive the delete/recreate cycle. | **Yes — but read §4.2, because the bigger point is that you're re-solving something already solved.** |
| `ScrapingPolicyReview` | Full audit trail behind `Site.scrapingPolicyStatus`: robots.txt rules, discovered and reviewed URLs, matched terms, evidence snippets, LLM classification, `nextReviewAt`. | Yes — it's the evidence base for `D2` / `SRC-11`. |
| `WorkerJob` | Internal FIFO queue (`ANALYSIS` / `SCRAPE` / `POLICY_REVIEW`). | No. |

### Q8 — Which `rawData` keys are contractual?

**Contractual — produced by the worker itself, systematically:**

- `_formData` — written at `scrape.ts:1839`, `:3030`, `:3246`. Identical content to
  `applicationInfo`. Depend on it.
- `<fieldName>_href` — including `applicationInfo_href`, `title_href`, `detailUrl_href`. This is a
  systematic convention, not a coincidence: any mapped field whose element is an anchor gets its
  resolved **absolute** URL stored under `<fieldName>_href` (`scrape.ts:737`, `:1088`, `:1477`,
  `:1766`). Depend on it.

**Opportunistic — do not depend on these:**

- `contactEmail`, `employmentType` — **not produced by the worker at all.** They come from per-site
  `setupScript` injections or per-site field mappings. They exist only on the sites whose script
  happens to emit them, and they can disappear the next time that script is rewritten, with no
  schema change and no announcement.
- Everything else in `rawData` is a shallow copy of that site's raw extracted fields
  (`worker/lib/normalizer.ts:767`), so it is site-specific by definition.

`employmentType` in particular you should stop relying on and take from `SRC-03` instead, where it
arrives as a schema.org field with defined semantics.

### Q9 — Upserted, or deleted and reinserted?

**Deleted and reinserted. Full replace per site, every run.** See §0 — this is the answer that most
changes your plan, and it comes with three consequences:

1. `Job.id` rotates every run (`Q1`).
2. **`Job.createdAt` is the time of the last successful persist — not first-seen, and not the
   posting date.** If anything downstream treats it as "when this job appeared", that is wrong
   today. Use `publishDate` (as published by the site) or `ageBucket` (see §4.5).
3. A job disappearing does **not** reliably mean it disappeared from the site. Keep the guard.

---

## 2. SRC-01 – SRC-14

| ID | Verdict |
|---|---|
| `SRC-01` | **Will do** — with `SRC-02`. Keep your guard anyway. |
| `SRC-02` | **Will do.** Partially specced already, but at site level, not per job — read the detail. |
| `SRC-03` | **Will do.** |
| `SRC-04` | **Already possible today. Zero work on our side.** |
| `SRC-05` | **Already shipped.** Read the caveats. |
| `SRC-06` | **Partly — no central lever.** |
| `SRC-07` | **Your premise is wrong; the real ask is smaller. Will do.** |
| `SRC-08` | **Will do. Cheapest high-value item on the list.** |
| `SRC-09` | **Needs a conversation** — partly already there. |
| `SRC-10` | **Needs a conversation.** Genuinely new; needs live testing. |
| `SRC-11` | **Will do**, and we're owning the decision — see `D2`. |
| `SRC-12` | **Will do. Worse than you described — read it.** |
| `SRC-13` | **Already how we work. Committing to it formally.** |
| `SRC-14` | **Will do**, together with `SRC-12`. |

### SRC-01 — `lastSeenAt` + soft removal **[high]**

**Will do, with `SRC-02`.** Neither field exists today. This one fights the delete-and-reinsert
model directly, so it is real work rather than a column addition — it means either upserting rows
or keeping a shadow table of identities. Sequenced after `SRC-02` because the change signal is a
prerequisite for doing it properly.

**Do not retire your 50% guard when it lands.** `removedAt` will make expiry precise for the cases
where a site actually removed a job. It cannot protect you from our worker restarting mid-scrape,
which is a different failure with the same symptom.

### SRC-02 — `updatedAt` or a content hash **[critical]**

**Will do.** Nothing exists today: `Job` has `createdAt` only — no `updatedAt`, no hash.

**One correction on what's already planned.** We have a specced-but-unbuilt `Site.contentHash` +
`Site.lastChangedAt` (sha1 over the sorted `externalJobId` set,
`docs/engineer-notes-frozen-status-and-weekly-cron.md` §2). That is deliberately an **identity-set
hash at site level** — it tells you *whether a site's roster changed*, so it serves your `SRC-04`
"skip unchanged sites" ask. It does **not** tell you a job's content changed, which is what
`SRC-02` is actually about. They are different fields and we'll build both.

The per-job hash is the cheaper half: hashed at persist time over title, description, location,
apply target and salary, exactly as you scoped it.

### SRC-03 — Raw schema.org JSON-LD per job

**Will do.** See `Q5`. Storing the raw block rather than parsed fields is the right call and it's
what we'll do. Expect this to be the largest data-quality win per unit of effort on the list,
because it fills `baseSalary`, `employmentType`, `validThrough` and `hiringOrganization` at once —
i.e. it closes `Q6` and most of your 0.65%-expiry problem without a dedicated extractor for either.

### SRC-04 — Per-`Site` heartbeat

**Already possible today. No work on our side, and you don't need to wait for us.** `ScrapeRun`
already has everything:

- `lastScrapedAt` → `max(ScrapeRun.createdAt)` for that site (or `completedAt` for finished runs)
- `lastRunStatus` → `status` of the newest run: `IN_PROGRESS | COMPLETED | PARTIAL | FAILED`
- `jobCount` → a column on the row
- plus `failureCategory`, `error`, `warnings`, `totalJobs`, `validJobs`, `invalidJobs`

**A run row is always written**, including on zero yield — it's created when the scrape is
triggered, before any browser work, so the early-return paths in §0 still leave a row behind. That
satisfies the second half of your `D1` ask structurally, today.

Read `PARTIAL` as "this inventory is truncated, do not reconcile against it."

### SRC-05 — Company-level capture per `Site` **[high]**

**Already shipped.** Commit `0022850`. Columns on `Site`, all nullable and additive:

| Column | Notes |
|---|---|
| `companyHomepageUrl` | Corporate homepage, **origin only, no path** — derived by stripping the careers subdomain, then header/footer link, then `og:url`. This is your "canonical corporate website as distinct from the careers subdomain". |
| `companyAbout` | **Plain text, never HTML** — the reader may render it unescaped. Sourced from JSON-LD `description`, else OG/meta description. |
| `companyLogoPath` | **Path only**, e.g. `/logos/<siteId>.png` — prefix your own origin. Served by Caddy from a named volume. `NULL` means no logo: render nothing, not a placeholder, not a favicon. |
| `companyLogoSourceUrl` | Where the bytes came from. Retained only so the file can be re-fetched if the volume is lost. **Never display it.** |
| `companyHqAddress` | Full address line as published by the company. |
| `companyHqCity` | **Verbatim from `CSV files/city.csv`, or `NULL`.** Never an off-list value — same discipline as `Job.location`. |
| `companyProfileStatus` | TEXT, not an enum, so an unrecognised value can never throw in your Prisma client. `NULL` \| `"COMPLETE"` \| `"PARTIAL"` \| `"FAILED"`. |
| `companyProfileAt` | `NULL` ⟺ never attempted. This is the field that separates "not attempted" from "attempted, found nothing". |

**Three caveats before you build against it:**

1. **Captured once at onboarding and never refreshed.** A company that re-brands keeps the old logo
   and copy until someone re-runs `scripts/company-profile.ts`. If that matters, say so and we'll
   fold it into the cadence work.
2. **Absence is always `NULL`, never `""`.** Branch on null.
3. **Two things you asked for are missing.** We store the about-page *text*, not the about-page
   *URL* — we think that's more useful, but tell us if you need the URL as well and we'll add it.
   And there is no company size or founding year: nothing on a careers page reliably carries
   either, so those two of your five company-page fields stay empty regardless of what we do.

### SRC-06 — Push harder on `department`

**Partly, and honestly: there is no central lever.** A label-based fallback already exists in
`worker/lib/normalizer.ts` (see `worker/lib/labeled-department.test.ts`) and catches `מחלקה:`-style
labelled text. Beyond that, `department` is whatever a site's own config maps it to, so raising
42.9% is per-site onboarding work across 187 sites, not one fix we can ship.

We'll push it during new onboards and re-onboards. We won't promise a number.

**Better lever available:** `SRC-03`. Where a site has JSON-LD, `occupationalCategory` and
`hiringOrganization.department` often carry exactly this, centrally, for free. Suggest you
re-measure your 2,298 uncategorised *after* `SRC-03` lands rather than before.

### SRC-07 — Re-capture `applicationInfo` every scrape, with `capturedAt` **[critical]**

**Your premise is wrong, which makes this much cheaper than you scoped it.**

Forms are **already re-extracted live on every scrape** — `extractFormDataOrFallback`
(`scrape.ts:2471`) calls the live DOM extractor on every detail-page visit. It is not
captured-once-and-frozen.

The real problem is that the fallback is **silent**. When the live extractor returns null — the
configured `formSelector` isn't in the DOM right now, e.g. an Elementor or Wix modal that only
mounts on click — we fall back to the onboarding-time static blob and hand you the result with no
indication of which one you got. There is also a `preferStatic` path that returns the static blob
without even trying live, for listing-only sites where a live match is usually the site's own
newsletter form (`LRN-APPLY-7`).

So you can indeed be handed a months-old form descriptor. You just can't tell when.

**Will do**, reduced to what's actually missing: stamp `capturedAt` and a provenance marker
(`live` \| `static`) onto `applicationInfo`. Treat `static` as "may be stale, do not submit against
this without re-validating" — which is precisely the guarantee you were asking for.

### SRC-08 — Hidden inputs, `enctype`, file constraints **[critical]**

**Will do. This is the cheapest high-value item on your list and we're doing it first in Tier 2.**
All three are missing and all three live in one function:

- **hidden input values** — the names are already captured on the live path (`Q3`); we add `value`.
  On the static path we drop the `hidden` filter in the recipe.
- **`enctype`** — not read at all today. One line.
- **file field constraints** — `accept` is on the DOM and not read; one line. **Max size is usually
  not in the DOM** — it's a server-side CF7/PHP setting. We'll give you `accept` and flag max size
  as generally unavailable rather than pretend otherwise.

### SRC-09 — Submittability classification per form **[high]**

**Needs a conversation — but you already have one third of it.**

*Already available:* login-gated flows, detected and auto-skipped (`Q4`,
`worker/lib/applyGate.ts`, `failureCategory: "apply_requires_login"`).

*Not available:* captcha presence and kind, JS-only vs plain POST, single- vs multi-step. Captcha
detection is genuinely close to free at extraction time, as you guessed. JS-only is the hard one
and cannot be answered from the DOM alone — see the `actionUrl` trap in `Q4`. Honest answer: the
only reliable classifier for JS-only is attempting a submission, which is `SRC-10`'s problem.

Your adapter-registry-with-allowlist-and-dry-run framing is the right shape and matches how we'd
build it. Let's scope this together once `SRC-08` has landed and you've seen what a complete
descriptor actually looks like.

### SRC-10 — What a successful submission looks like **[high]**

**Needs a conversation.** Nothing exists today, and this cannot be derived by reading a page — it
requires actually submitting and observing, per site.

We do have the beginnings of the harness: `scripts/test-apply.ts` and
`scripts/find-test-apply-jobs.ts` (commit `63395a1`) are operator tooling for exercising a real
site's apply flow. That's the natural place for this to live. It is real engineering on our side
and it needs `D2` settled first — which it now is.

### SRC-11 — Apply-on-behalf policy field **[high]**

**Will do, and we're keeping the decision.** See `D2`. A distinct field on `Site`, separate from
`scrapingPolicyStatus`, defaulting to "not permitted" rather than inheriting the read permission.
You are right that permission to read is not permission to submit, and right that it should sit
with whoever owns the site relationship.

Until it exists, treat `RESTRICTED` and `REQUIRES_WRITTEN_PERMISSION` as hard exclusions from
proxy-apply, and treat everything else as **not yet cleared** rather than cleared.

### SRC-12 — TLS on the Postgres connection **[critical]**

**Will do — and it is worse than you described.** Confirmed from `docker-compose.yml`:

- The image is stock `postgres:16-alpine`, which ships with **`ssl = off`** and no certificates.
  Your client isn't choosing plaintext; the server can't offer anything else.
- `ports: - "5432:5432"` publishes the port on the host interface, i.e. **to the public internet**.
- The credential in the compose file is the **`postgres` superuser**.

So it is not just the corpus and a password in plaintext hourly — it is a **superuser** password.
Whoever holds it can drop the database, and anyone on the path can read it. That reframes this from
a hygiene item to the most serious thing in either document, and it's why we're doing it first and
separately from the roadmap.

Fix, shipping as one change with `SRC-14`: generate certs, mount them, run the server with
`ssl=on`, restrict the published port to your address rather than `0.0.0.0`, and move you off the
superuser. **We will give you notice before flipping it** so you can switch your client in step —
you said you'd change it the day the server accepts TLS; we'll tell you which day that is.

### SRC-13 — Additive-only schema changes, and somewhere to announce them

**Already how we work, and we'll commit to it formally.** The discipline is written into the schema
itself — the company-profile block in `prisma/schema.prisma` carries an explicit *"nothing here may
become NOT NULL, change type, or be renamed"* because the public jobs site also reads this database
directly. You're the second reader with the same requirement.

Committing to: **no renames, no type changes, no new NOT NULL columns on `Job`, `Site` or
`ScrapeRun`.** New fields only. Removals get announced and deprecated, never dropped silently.

For announcements: this document's thread until we have somewhere better. If you'd rather have a
changelog file in the repo that you can poll, say so and we'll add one — that's cheaper for both of
us than email.

### SRC-14 — A named read-only role

**Will do, shipping with `SRC-12`.** You are currently connecting as superuser, so this is not only
a rotation-convenience item — it's removing write and DROP rights you should never have had. A
named role with `CONNECT` + `USAGE` + `SELECT` and nothing else.

---

## 3. D1–D3

### D1 — A cadence we can hold you to **[high]**

**No number yet — and we'd rather say that than give you one we'd miss.**

There is no cron. Building one is not just a scheduler: the worker is single-threaded FIFO with a
15-minute per-site timeout, so 187 sites is a throughput question we haven't measured, and a
cadence promised before that measurement would be fiction.

What we can tell you:

- **The direction is daily.** That's the target end state, not a maybe.
- **Weekly is the specced intermediate step**, designed in
  `docs/engineer-notes-frozen-status-and-weekly-cron.md`, and is what will most likely land first.
- **A run row is already written for every triggered scrape, including zero-yield ones** — so the
  second half of your ask is satisfied today (`SRC-04`).
- We'll come back with a committed number once the cron exists and we've watched it run.

**In the meantime, alert on the freshness query in §0 rather than on cadence.** It catches both
"nobody scraped this" and "scraped fine, config is dead", which a cadence alert alone would miss —
and it works today, against manual scrapes, with no commitment from us.

We agree with your framing that applying on a candidate's behalf against a stale snapshot is the
failure mode to design out. That is an argument for not starting `SRC-10` until the cadence exists,
and we're treating it as one.

### D2 — Who decides whether you may submit a form on a site **[high]**

**We own it.** A distinct field on `Site`, separate from `scrapingPolicyStatus` (`SRC-11`).

The reasoning is the one you gave: the evidence already sits on our side. `ScrapingPolicyReview`
holds the robots rules, the reviewed URLs, the matched terms, the evidence snippets and the LLM
classification behind every status. Splitting the judgement from the evidence would produce exactly
the second, contradictory register you were trying to avoid.

Two conditions attached:

1. **It defaults to "not permitted."** A site is excluded from proxy-apply until affirmatively
   cleared — not cleared by default because reading was allowed. Expect the initial permitted set
   to be small.
2. **It is a slower field than `scrapingPolicyStatus`.** Read permission is re-checked
   automatically every ~90 days. This one moves at human speed, because it's a different kind of
   judgement.

### D3 — Capacity and sequencing

**Taking:** `SRC-01`, `SRC-02`, `SRC-03`, `SRC-07`, `SRC-08`, `SRC-11`, `SRC-12`, `SRC-13`,
`SRC-14`. Plus `SRC-04` and `SRC-05`, which need nothing from us.

**Conversation, not commitment:** `SRC-09`, `SRC-10`.

**Partial, no number promised:** `SRC-06`.

Sequencing:

| Order | Items | Why here |
|---|---|---|
| 1 | `SRC-12` + `SRC-14` | Superuser credentials in plaintext on a public port. Unrelated to the roadmap; blocked by nothing. |
| 2 | `SRC-08` + `SRC-07` stamp | Small — one function plus a recipe edit — and it unblocks all of your Tier 2 planning. |
| 3 | `SRC-03` | Best data-quality return per unit of effort. Closes `Q6`, most of your expiry gap, and probably some of `SRC-06`. |
| 4 | `SRC-02` (per-job hash) | Your top item. Cheap at persist time. |
| 5 | `SRC-01` (`lastSeenAt` / `removedAt`) | Real work — fights the delete/reinsert model. Wants `SRC-02` first. |
| 6 | `SRC-11` + the cron | `SRC-11` is small; it's here because it's only meaningful alongside cadence, which in turn gates `SRC-10`. |

**No dates.** We'll report progress against this order. Items 1 and 2 are small enough that you
should expect them soon; item 5 is the one that could slip.

**On the `applicationInfo` contract — which you didn't ask about but need before writing any Tier 2
code:** the current shape is **stable, depend on it.** `applicationInfo` is a `String` that is
**either** a JSON-encoded form descriptor **or** a plain URL or email address, depending on the
site. Branch on that. We will not change the column type or the encoding. If we add a typed field
later it will sit alongside this one, additively, and this one will keep working.

---

## 4. Corrections

You asked for these above any single item. Five, in descending order of how much they change your
plan.

### 4.1 "We treat `Job` as a full-replace snapshot of a site's current state" — half right

Full-replace: correct. "Snapshot of the site's current state": **not reliable in either
direction.** It can be truncated or empty when the site is fine (worker restart, crash between
chunks, timeout → `PARTIAL`), and it can be months-stale while reading `ACTIVE` / `COMPLETED` when
the config is dead (`empty_results` / `structure_changed` return before the delete). See §0.

**Consequence for you:** keep the 50% guard, read `ScrapeRun.status` and `failureCategory`, and
build the freshness query. `SRC-01` does not remove the need for any of the three.

### 4.2 "We run our own Hebrew location resolver that maps roughly 90% of source location strings"

**You are re-solving a solved problem, and losing data doing it.**

`Job.location` is **already canonicalised** against `CSV files/city.csv` at persist time
(`scrape.ts:3440`). More importantly, `Job.locations` is a **`String[]`** holding every place a job
names — roughly 15% of jobs list more than one (`"חולון ובת-ים, ת\"א, מודיעין"`), which a single
string cannot represent. `Job.location` is deliberately just `locations[0]`, kept as a scalar so
existing readers don't break.

If you're reading only `location` and re-resolving it, you are (a) duplicating our work, (b)
possibly contradicting it, and (c) **discarding the secondary locations entirely** — which is
probably a chunk of your unmapped 10%, because a multi-place string won't match any single city.

Read `locations[]`. Values in it are either verbatim from `city.csv` or the raw string where no
match existed — never a silently dropped value. Precedence at write time is: manual dashboard
override → extracted value → site-level HQ fallback → `"Unknown"`.

And yes, we hold corrections: `JobLocationOverride`, keyed `(siteId, jobKey)` with
`jobKey = externalJobId ?? detailUrl`, re-applied after every scrape.

### 4.3 "3,848 jobs already carry a structured form descriptor… captured once and never refreshed"

The count is right; "never refreshed" is wrong. Forms are re-extracted live on every scrape, with a
**silent** fallback to the onboarding blob. See `SRC-07`. The fix you need is much smaller than the
one you scoped.

### 4.4 "Zero salary data across 6,597 jobs" reads as absence — it isn't

It's a missing column on our side, not missing data on the sites. Our analyzers actively score
salary candidates in three separate engines and then discard the result for want of somewhere to
put it. See `Q6`.

### 4.5 Two smaller ones

- **`Job.createdAt` is not a first-seen date.** It's the last successful persist. If anything
  downstream reads it as a posting date, that's a live bug. Use `publishDate`, or `ageBucket`.
- **You haven't mentioned `ageBucket`, and you should use it.** It's a computed freshness bucket
  written at persist time — `fresh` / `d90` / `d180` / `d365`, and indexed. It supersedes the older
  `minPublishDays` mechanism, which is now inert and silently ignored at scrape time. For your
  staleness filtering this is more useful than `publishDate`, which is a free-text string in
  whatever format the site happened to use.

---

## 5. What we'd like back

All four of your §6 offers, yes. In priority order:

1. **The ~10% of location strings your resolver can't map.** Highest value to us. Every one is
   either a `city.csv` gap or an extraction bug, and both are directly fixable. Please send the raw
   string plus `siteId` — with the caveat from §4.2 that some of them will be multi-place strings we
   already resolved into `locations[]`.
2. **The rows you reject and why.** Especially the `http` `siteUrl` — that's a real bug on our side
   and we'll fix it once you name the site. Also the 4 jobs with no `externalJobId`: those are the
   `unresolved` case in `applyJobIdFallback` (no title and no URL), and knowing which sites they're
   on tells us where extraction is failing.
3. **Per-site accepted / duplicate / rejected counts.** This is a yield report we cannot produce
   ourselves, and it would catch partial drift — the failure class in §0 that produces no signal on
   our side at all. If you can only send one thing on a schedule, send this.
4. **Submission failures, once proxy-apply runs.** Agreed that this is live validation of the
   hardest part of the crawl. Later, obviously.

No schedule needed — a file drop, or an endpoint we can poll, is fine.

---

## 6. Summary against your §9

| ID | Your ask | Us |
|---|---|---|
| `SRC-02` | A change signal | **Will do.** Per-job hash at persist time, plus the site-level roster hash for your skip-unchanged case. |
| `SRC-05` | Company capture at scrape time | **Already shipped.** Read the caveats — captured once, `companyLogoPath` is a path not a URL, and there's no size or founding year. |
| `SRC-12` | TLS on the database connection | **Doing it first.** Worse than you thought: stock Postgres with SSL off, port published publicly, and you're on the superuser account. |

**And one back, which we'd put above all three:** build the freshness query in §0 this week.
`max(ScrapeRun.createdAt)` vs `max(Job.createdAt)` per site. It needs nothing from us, it catches
the silent-drift class that none of the fourteen items above catch, and we currently have at least
three sites sitting in exactly that state.
