# alut — אלו"ט (Civi board `FPEVT4D67N` / src `8315`)

`siteUrl`: `https://app.civi.co.il/promos/id=FPEVT4D67N&src=8315`
Onboarded 2026-09-27. Config mirror: `sites/_configs/app-civi--*.json` + `.setup.js`.

The stored `setupScript` is **7,994 of the 8,000 characters** the validator allows
(`LRN-API-7`). There are six characters of headroom: any edit has to buy its own
space, and a PUT that goes over returns `VALIDATION_ERROR`, writes nothing, and still
passes `verify-config`. This file holds the reasoning that would otherwise live in the
script's comments.

## Coverage — the board paginates at 20

`coverage: 46/46`. The board renders 20 cards and pages with
`profRefresh(page, 20, 3, "")`, where the `3` is the page count: 20 + 20 + 6 = 46.
Page 1 alone would have shipped **20 of 46 jobs** and no gate would have said a word.

The script merges pages 2..N with same-origin `fetch('…&p=N')` rather than calling
`profRefresh()`, which does `location.assign()` and would destroy the script's own
context. `p` past the last page **re-serves the last page** (`p=4` returns the same 6
rows as `p=3`), so the loop stops as soon as a page contributes no new `openPromo` id —
that also guards a server that ignores `&p=` entirely.

## Location — a closed whitelist, not a scan

ALUT is a nationwide non-profit: its 46 postings name ~25 different towns, so there is
no HQ city to hardcode (the Civi recipe's default) and no per-job location field to
read. Location is parsed out of the **title**, which is where this board states it.

**Substring matching is not usable here**, and this board is a clean demonstration of
the hazard CLAUDE.md names. Matching `city.csv` entries as substrings of the 46 titles
produced, among others:

| title fragment | bogus city | why |
|---|---|---|
| `עו״ס מעון` / `למעונות יום` | `מעון` | a real `city.csv` entry inside an ordinary word |
| `בטיפול באומנות` | `מנות` | ditto |
| `רכז כפר עופרים` | `עופר` | ditto |
| `מסלול התמחות` | `מסלול` | ditto |

So `placesIn()` tokenises on Hebrew word boundaries and matches **whole words only**,
longest window first, peeling one or two Hebrew prefix letters (`בלמוהכש`) off the
first word so `בנתניה`, `ובאר שבע` and `באבן יהודה` resolve. It matches only against a
**closed table** whose every canonical value was checked, on 2026-09-27, to be verbatim
on both `CSV files/city.csv` **and** the worker's own canonical list — the two lists
differ in 29 spellings (`LRN-LOC-4`), and only values on both survive intact.

A place the board names that is **not** in the table yields **no location at all**.
That is deliberate: `resolveJobLocation()` falls back to `location: list[0] ?? extracted`,
so an injected value that `normalizeLocations()` cannot resolve ships **raw** as the
job's location. A closed table makes that branch unreachable. The cost is that a town
ALUT opens next year reads as `Unknown` until this table is extended — missing, never
wrong.

Two ALUT campuses are named in titles and are deliberately **absent** from the table
because they are not `city.csv` towns: **הדסים** (`alut-845499`) and **כפר עופרים**
(`alut-715183`). `כפר עופרים` is not `עופר` and not `בית אריה - עופרים`.

**`הדסים` stays `Unknown` — owner decision, 2026-09-27.** The title does name the place,
so this is a vocabulary gap rather than a parse failure. The alternatives were mapping it
to a containing municipality (I could not establish which one from ALUT's own site:
`/map` is a JS widget with no addresses in its text, and `/services/*` and `/צור-קשר/`
return 403 to us) or adding `הדסים` to `city.csv`, which needs a deploy because CI asserts
`city.csv` and `il-places.ts` match. Neither was worth it for one job; `Unknown` is the
honest value. Do not "fix" this without being asked.

### One named workplace: `מרכז הרפואי שמיר` → `באר יעקב`

`alut-652447` (`רופא.ה למכון האבחון והמחקר ״המרכז לאוטיזם״`) never writes a town. Its only
statement of place is an institution:

> `…במכון האבחון והמחקר ״המרכז לאוטיזם״ במרכז הרפואי שמיר (אסף הרופא)`

So neither the title nor the pure-place-line rule can reach it, and a third source exists
for this one case: a regex on the full ad, consulted only when the first two found nothing.

**`באר יעקב` is the operator's value, supplied 2026-09-27 from the hospital's public
address. It was NOT machine-verified here** — `shamir.org` answers 200 but its visible text
is a cookie banner with no address, and ALUT's own pages gave only "בבית החולים שמיר אסף
הרופא". Per `LRN-HQ-7` this note is the only durable record of where the value came from.
`באר יעקב` was checked verbatim on both `city.csv` and the worker list, and is not a region.
Note the town the hospital itself prints, `צריפין`, is **absent from `city.csv`**, which is
why the publishable answer is not the printed one.

Two traps the key is shaped around:

- **Never the bare word `שמיר`** — `city.csv` contains `שמיר`, Kibbutz Shamir in the Upper
  Galilee, ~200 km away. Matching it here would ship a confidently wrong city.
- **Never bare `אסף הרופא`** — it also appears in `alut-793108`
  (`…בשיתוף … ובית ספר לאחיות אסף הרופא שמיר`), where it is a *partner institution*, not the
  job's location. That job correctly stays `Unknown`.

The key is therefore `במרכז הרפואי שמיר`, **with the ב**: the ב is what marks the institution
as the workplace, the same distinction the worker's own anchored gazetteer draws. Measured
over all 46 ads: `במרכז הרפואי שמיר` matches 1 job, `מרכז הרפואי שמיר` 1, bare `אסף הרופא` 2,
bare `שמיר` 2.

Surface forms the table carries because the board prints them: `מודיען` (the
employer's typo for `מודיעין`), `פתח תקוה`, `ג ברנר` (printed `ג. ברנר`), and — via a
pre-tokenising substitution, since they do not survive word splitting — `ת״א`/`ת"א`,
`פ״ת`/`פ"ת`, and the Arabic `حورة` on the one Arabic-language posting.

Two narrow extensions beyond the title:

- **A body line that is nothing but places.** `alut-846791` states its eight towns on
  line 2 of the description, not in its title. The line is accepted only when every
  word on it is consumed by a place match and at least two places are found — a bar no
  prose sentence clears. This is the only path by which body text is read.
- **Nationwide, from the title only.** `בפריסה ארצית` / `ברחבי הארץ` in a title is the
  job's own scope and maps to `פריסה ארצית`, a real `city.csv` entry. The worker's
  gazetteer excludes that phrase from its prose scan for good reason (it usually
  describes a shuttle service), which is exactly why it is taken from the title and
  nowhere else.

### One posting where the employer contradicts itself

`alut-985461` titles itself `… הרצליה, ראשון לציון ופתח תקווה` and then opens its body with
`… בפתח תקווה, נתניה, ראשון לציון וחולון` — four towns, a different four. It is the **only**
one of the 46 whose body names a town its title does not (measured, not assumed).

It ships with the **title's** three. Two towns the body names (`נתניה`, `חולון`) are therefore
not published for that job, and one the title names (`הרצליה`) is absent from its body. That
is the employer's inconsistency, not a parse failure, and the repo rule is to publish employer
content as-is rather than correct it. The alternative — reading a prose line that merely *ends*
in a list of towns — would widen the scan surface on all 46 postings and every future one to
fix a single row, which is the trade the closed-line rule exists to refuse.

If the owner would rather over-publish than under-publish on a contradiction, the change is to
union the title's places with those on a body line that restates the title; it is a deliberate
policy call, not a bug fix.

### Result

32 of 46 postings carry a location, 14 are `Unknown`, and `verify-location-csv`
passes. The worker gazetteer on its own reached 9 of 46, and several of those were
partial — `alut-985461` lists three towns and the bare multi-word scan returned only
`פתח תקווה`.

## The Arabic posting — shipping, pending an owner decision

`alut-915276` is Arabic (`روضات التواصل في حورة` — communication kindergartens in
Hura). It currently ships, with `חורה` as its location.

**Language counts for this board (`LRN-LANG-1` asks for these):
45 Hebrew-only, 1 Arabic-only, 0 paired, 0 mixed.**

An earlier version of this file said the row was kept because, "unlike the Russian rows
on keshet-teamim, it is not a translation of a Hebrew record." **That misread
`LRN-LANG-1`**, which found the opposite: keshet's Russian rows were *independent
records*, not a translation layer — `קופאי/ת` 876017 named 10 branches against RU
826252's 15, "neither list is a subset", and Civi has no translation-group id to pair
them on. Keshet's Hebrew-only outcome was the owner choosing between two overlapping
record sets, not a de-duplication.

The real reason to keep this row is simpler and does not rest on that contrast: with
**zero pairs** there is no overlapping set to choose between, and no Hebrew posting
covers Hura. Dropping it would drop a vacancy nothing else publishes.

The honest caveat: `alut-831625` (`נשות טיפול לצוות רב תחומי בגני תקשורת בפריסה ארצית`)
is the same role family nationwide. It is not a pair — the Arabic ad is specifically
Arabic-speaking kindergartens in Hura, and per `LRN-LANG-1` near-pairs are not
equivalents — but someone could reasonably read the two as one role advertised twice.

**Status: the language policy for this site is NOT settled.** `LRN-LANG-1` says the
three counts go in front of the owner *before* building and that the call is theirs,
"not a default"; that did not happen here, and the counts above were produced after the
site was already ACTIVE. The owner is checking whether "Hebrew only" is a fleet rule.
If it is, the change is a positive-evidence guard in the `setupScript` (keep a card
because its title carries Hebrew, never because it failed an Arabic blacklist) plus a
re-scrape, and `alut-915276` is named in the `adminNote` as a real vacancy that no
longer ships.

## Apply

Per-job, injected as `.__ai-applicationInfo`: the posting's own
`promo/id=<jobId>&src=8315` action URL plus that posting's own field list. The field
set genuinely varies — four shapes across the 46 postings:

| fields | postings |
|---|---|
| `name, phone, email, cciittyy, cv` | 32 |
| `name, phone, email, cv` | 10 |
| `name, phone, email` | 3 |
| `name, phone, email, cciittyy` | 1 |

so it is read per job rather than hardcoded. Three postings accept no CV upload at all.

The site-level `formCapture` is the superset, with `formSelector: "form.Form"`. The
listing page carries **zero** `<form>` elements, so that selector matches nothing there
and the static fields are what reach `rawData._formData` (`LRN-APPLY-7`).

## Body split

`#je-descr` → `description`, `#je-details` → `requirements`, per the owner's field
rules: a `דרישות` / `כישורים` block is **moved**, never copied, and its label line is
dropped along with `תיאור תפקיד:` / `התפקיד כולל:` / `מה התפקיד בולל:` (the
employer's typo). Two postings (`alut-715183`, `alut-664743`) have no body beyond
their title, so the "strip a repeated title lead" rule only fires when content
remains — an empty description would be worse than a repeated one.

No detail page on this board answered 200-with-an-empty-body (`LRN-SPA-11`), but the
listing `.descr` fallback is kept: that failure is per-promo and appeared on another
Civi board without warning.

## externalJobId

`alut-<openPromo id>`, which equals the board's own `#je-public-id` on all 46 pages.
Namespaced because `verify-jobids` rejects a bare numeric id as index-based and cannot
tell the employer's `512159` from a row index (`LRN-ID-11`). The prefix is set on the
first config: the id is the dedup key, so adding it later would re-key every job.
