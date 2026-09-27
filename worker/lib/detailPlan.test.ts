// Run: npx tsx worker/lib/detailPlan.test.ts
//
// Which detail pages a scheduled scrape visits, and what it carries forward.
// Every carry is a claim that stored text still describes a live job, so every
// case below is a reason NOT to carry — and the one case that carries.

import {
  CARD_FINGERPRINT_KEY,
  CONFIG_SAVED_AT_KEY,
  DETAIL_CARRIED_KEY,
  DETAIL_FETCHED_AT_KEY,
  DETAIL_MAX_AGE_MS,
  PENDING_DETAIL_KEY,
  buildCarriedRawFields,
  cardFingerprint,
  detailModeFor,
  indexStoredRows,
  isCarryEligible,
  isFullDetailRun,
  planDetailFetch,
  seedFingerprint,
  stampFetched,
  type StoredRaw,
} from "./detailPlan";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}
function check(name: string, body: () => void) {
  try {
    body();
  } catch (e) {
    console.error(`FAIL: ${name} threw — ${(e as Error).message}`);
    failures++;
  }
}

const NOW = new Date("2026-09-30T00:30:00Z"); // 03:30 Jerusalem, a Wednesday night
const SAVED_AT = "2026-08-16T16:25:02.434Z";
const URL_A = "https://www.ashtrom.co.il/career/4843";
const URL_B = "https://www.ashtrom.co.il/career/4849";

/** Tonight's card for a job, as the listing walk leaves it. */
function seed(over: Record<string, string> = {}): Record<string, string> {
  return {
    title: "מנהל.ת חשבונות מנוסה",
    location: "אזור מרכז",
    department: "כספים",
    externalJobId: "/career/4843",
    _detailUrl: URL_A,
    _listingUrl: "https://www.ashtrom.co.il/career",
    [PENDING_DETAIL_KEY]: "1",
    ...over,
  };
}

/** The stored rawData a full fetch of that card left behind. */
function stored(over: Record<string, string> = {}, fromSeed = seed()): StoredRaw {
  return {
    title: fromSeed.title!,
    location: fromSeed.location!,
    department: fromSeed.department!,
    externalJobId: fromSeed.externalJobId!,
    description: "תיאור המשרה המלא",
    publishDate: "11/08/2026",
    _formData: "{\"fields\":[]}",
    _detailUrl: fromSeed._detailUrl!,
    _listingUrl: fromSeed._listingUrl!,
    _detailNavStatus: "ok",
    [CARD_FINGERPRINT_KEY]: seedFingerprint(fromSeed),
    [DETAIL_FETCHED_AT_KEY]: "2026-09-27T23:10:00.000Z",
    [CONFIG_SAVED_AT_KEY]: SAVED_AT,
    ...over,
  };
}

function plan(
  seeds: Array<Record<string, string>>,
  rows: StoredRaw[],
  over: Partial<Parameters<typeof planDetailFetch>[0]> = {},
) {
  return planDetailFetch({
    seeds,
    index: indexStoredRows(rows.map((rawData) => ({ rawData }))),
    mode: "incremental",
    eligible: true,
    configSavedAt: SAVED_AT,
    now: NOW,
    ...over,
  });
}
const only = (p: ReturnType<typeof plan>) => p.decisions[0]!;

check("the fingerprint", () => {
  const base = { title: "מהנדס/ת", location: "חיפה", department: "הנדסה", link: URL_A };
  const fp = cardFingerprint(base);
  assert(/^[0-9a-f]{40}$/.test(fp), `a sha1 hex digest (got ${JSON.stringify(fp)})`);
  assert(cardFingerprint({ ...base, title: "  מהנדס/ת \n" }) === fp, "surrounding whitespace is not a change");
  assert(
    cardFingerprint({ ...base, title: "מהנדס/ת  בכיר" }) === cardFingerprint({ ...base, title: "מהנדס/ת בכיר" }),
    "a doubled inner space is not a change",
  );
  assert(cardFingerprint({ ...base, title: "מהנדס/ת בכיר" }) !== fp, "a retitle is a change");
  assert(cardFingerprint({ ...base, location: "חדרה" }) !== fp, "a relocation is a change");
  assert(cardFingerprint({ ...base, department: "ייצור" }) !== fp, "a new department is a change");
  assert(cardFingerprint({ ...base, link: URL_B }) !== fp, "a new link is a change");
  assert(
    cardFingerprint({ title: "a", location: "", department: "b", link: "" }) !==
      cardFingerprint({ title: "a", location: "b", department: "", link: "" }),
    "the fields are delimited — a value cannot slide into its neighbour",
  );
  assert(
    cardFingerprint({ title: "a", location: null, department: undefined, link: URL_A }) ===
      cardFingerprint({ title: "a", location: "", department: "", link: URL_A }),
    "absent and empty are the same card",
  );
  assert(
    seedFingerprint(seed()) ===
      cardFingerprint({ title: seed().title, location: seed().location, department: seed().department, link: URL_A }),
    "a seed's fingerprint is its four card values, link = the detail URL",
  );
});

check("the one case that carries", () => {
  const p = plan([seed()], [stored()]);
  assert(only(p).action === "carry", `a known card with an unchanged fingerprint carries (got ${only(p).action})`);
  assert(p.carried === 1 && p.fetched === 0, "and is counted as carried");
});

check("every reason to fetch", () => {
  const reasonOf = (p: ReturnType<typeof plan>) => {
    const d = only(p);
    return d.action === "fetch" ? d.reason : "carry";
  };
  assert(reasonOf(plan([seed()], [])) === "new", "an id not stored is new");
  assert(
    reasonOf(plan([seed({ title: "מנהל.ת חשבונות בכיר.ה" })], [stored()])) === "fingerprint_changed",
    "a stored id whose card changed is fetched",
  );
  assert(
    reasonOf(plan([seed()], [stored({ [CARD_FINGERPRINT_KEY]: "" })])) === "no_fingerprint",
    "a row without a fingerprint — every row on the first night — is fetched",
  );
  const noFp = stored();
  delete noFp[CARD_FINGERPRINT_KEY];
  assert(reasonOf(plan([seed()], [noFp])) === "no_fingerprint", "an absent fingerprint key too");
  assert(
    reasonOf(plan([seed()], [stored({ _detailNavStatus: "timeout" })])) === "last_visit_failed",
    "a row whose detail visit failed has nothing worth carrying",
  );
  assert(
    reasonOf(plan([seed()], [stored({ [CONFIG_SAVED_AT_KEY]: "2026-07-01T00:00:00.000Z" })])) === "config_changed",
    "a row fetched under an older config is fetched, so a config change is tested at once",
  );
  assert(
    reasonOf(plan([seed()], [stored()], { configSavedAt: null })) === "config_changed",
    "a config with no savedAt can never prove a row current",
  );
  assert(
    reasonOf(plan([seed()], [stored({ [DETAIL_FETCHED_AT_KEY]: new Date(NOW.getTime() - DETAIL_MAX_AGE_MS).toISOString() })])) === "stale",
    "text exactly 8 days old is stale — the backstop behind the weekly refresh",
  );
  assert(
    reasonOf(plan([seed()], [stored({ [DETAIL_FETCHED_AT_KEY]: new Date(NOW.getTime() - DETAIL_MAX_AGE_MS + 60_000).toISOString() })])) !== "stale",
    "a minute under 8 days is not",
  );
  assert(
    reasonOf(plan([seed()], [stored({ [DETAIL_FETCHED_AT_KEY]: "yesterday" })])) === "stale",
    "an unparseable stamp proves nothing",
  );
  assert(
    reasonOf(plan([seed()], [stored({ [DETAIL_FETCHED_AT_KEY]: new Date(NOW.getTime() + 2 * 3_600_000).toISOString() })])) === "stale",
    "a stamp from the future proves nothing either",
  );
  assert(reasonOf(plan([seed()], [stored()], { mode: "full" })) === "mode_full", "the weekly full pass fetches everything");
  assert(reasonOf(plan([seed()], [stored()], { eligible: false })) === "ineligible", "an ineligible site fetches everything");

  // Two stored rows claiming one id: which one is this card? Neither can be trusted.
  const twin = stored({ _detailUrl: URL_B });
  assert(reasonOf(plan([seed()], [stored(), twin])) === "new", "an ambiguous id is treated as new");
});

check("identity: the card's id when it has one, else the detail URL", () => {
  // Detail-only id (8 sites): the card has no externalJobId; the URL is the key.
  const s = seed({ externalJobId: "" });
  const row = stored({ externalJobId: "4843" }, s);
  assert(only(plan([s], [row])).action === "carry", "a detail-only-id site matches on the URL");

  // Same id, different URL: the link is in the fingerprint, so it is fetched.
  const moved = seed({ _detailUrl: URL_B });
  const p = only(plan([moved], [stored()]));
  assert(p.action === "fetch" && p.reason === "fingerprint_changed", "a known id at a new link is fetched");

  // A card id that is stored under a different row's URL still matches by id.
  assert(
    only(plan([seed()], [stored({ _detailUrl: "https://elsewhere/1" }, seed({ _detailUrl: "https://elsewhere/1" }))])).action === "fetch",
    "matching by id does not skip the link comparison",
  );
});

check("hashed ids: a retitle is fetched and re-keyed, as today", () => {
  // No card id; the worker synthesises h-<hash(title+dept+url)> after the visit.
  // Before the visit the URL is the key and the title is in the fingerprint.
  const s = seed({ externalJobId: "" });
  const row = stored({ externalJobId: "h-1p1cu0x" }, s);
  const retitled = seed({ externalJobId: "", title: "מנהל.ת חשבונות ראשי.ת" });
  const d = only(plan([retitled], [row]));
  assert(d.action === "fetch" && d.reason === "fingerprint_changed", "a retitled hashed-id job is fetched in full");
});

check("eligibility", () => {
  assert(
    isCarryEligible({ listingFields: ["title", "location", "detailUrl"], detailFields: ["description"] }),
    "a card with a title and a detail page is eligible",
  );
  assert(
    !isCarryEligible({ listingFields: [], detailFields: ["title", "location", "description"] }),
    "railcareer / anvei-zion: the card shows only the link — always full",
  );
  assert(
    !isCarryEligible({ listingFields: ["title", "location"], detailFields: [] }),
    "no detail-scope field (mei-avivim): every field re-runs on the detail page — always full",
  );
});

check("what a carried row is made of", () => {
  const tonight = seed({ title: "מנהל.ת חשבונות מנוסה" });
  const row = stored();
  const out = buildCarriedRawFields(tonight, row);
  assert(out.description === "תיאור המשרה המלא", "the stored description is carried");
  assert(out.publishDate === "11/08/2026", "the stored publishDate is carried");
  assert(out._formData === row._formData, "the stored apply form is carried");
  assert(out.title === tonight.title && out.location === tonight.location, "card fields are tonight's");
  assert(out._detailUrl === URL_A && out._listingUrl === tonight._listingUrl, "the link and listing page are tonight's");
  assert(out[DETAIL_FETCHED_AT_KEY] === row[DETAIL_FETCHED_AT_KEY], "the stamp says when the text was really fetched");
  assert(out[CONFIG_SAVED_AT_KEY] === SAVED_AT, "and under which config");
  assert(out[CARD_FINGERPRINT_KEY] === row[CARD_FINGERPRINT_KEY], "the fingerprint travels");
  assert(out._detailNavStatus === "ok", "the carried visit was a good one");
  assert(out[DETAIL_CARRIED_KEY] === "1", "and the row says it was carried");
  assert(!(PENDING_DETAIL_KEY in out), "the pending marker is gone");

  // A location that is detail-only is carried; one on the card is tonight's.
  const s2 = seed({ location: "" });
  delete s2.location;
  const out2 = buildCarriedRawFields(s2, stored({ location: "הרצליה" }, s2));
  assert(out2.location === "הרצליה", "a detail-only location is carried");

  const odd = buildCarriedRawFields(seed(), { ...stored(), weird: 42 as unknown as string });
  assert(!("weird" in odd), "non-string stored values are not smuggled into raw fields");
});

check("what a fetched row is stamped with", () => {
  const raw = { title: "x", description: "y", _detailNavStatus: "ok", [PENDING_DETAIL_KEY]: "1" };
  const out = stampFetched(raw, seed(), SAVED_AT, NOW);
  assert(out[CARD_FINGERPRINT_KEY] === seedFingerprint(seed()), "the fingerprint of the CARD, not of the merged row");
  assert(out[DETAIL_FETCHED_AT_KEY] === NOW.toISOString(), "fetched now");
  assert(out[CONFIG_SAVED_AT_KEY] === SAVED_AT, "under tonight's config");
  assert(!(PENDING_DETAIL_KEY in out), "no longer pending");
  assert(!(DETAIL_CARRIED_KEY in out), "and not carried");
  const failed = stampFetched({ _detailNavStatus: "timeout" }, seed(), SAVED_AT, NOW);
  assert(!(CARD_FINGERPRINT_KEY in failed), "a failed visit is not stamped, so it can never be carried");
  const noCfg = stampFetched({ ...raw }, seed(), null, NOW);
  assert(!(CONFIG_SAVED_AT_KEY in noCfg), "no savedAt, no stamp");
});

check("the weekly full pass is the Saturday 02:00 Jerusalem run", () => {
  // 02:00 Jerusalem is 23:00 UTC the day before in summer (UTC+3), 00:00 UTC in winter (UTC+2).
  assert(detailModeFor(new Date("2026-09-25T23:00:00Z")) === "full", "Sat 26 Sep 02:00 IDT is the full pass");
  assert(detailModeFor(new Date("2026-09-24T23:00:00Z")) === "incremental", "Fri 25 Sep 02:00 IDT is not");
  assert(detailModeFor(new Date("2026-09-26T23:00:00Z")) === "incremental", "Sun 27 Sep 02:00 IDT is not");
  assert(detailModeFor(new Date("2026-12-05T00:00:00Z")) === "full", "Sat 5 Dec 02:00 IST (winter) is the full pass");
  assert(detailModeFor(new Date("2026-12-04T00:00:00Z")) === "incremental", "Fri 4 Dec 02:00 IST is not");
  // In summer the UTC date at 02:00 Jerusalem is still FRIDAY — the host clock
  // (Etc/UTC on the box) would call the full-pass night a Friday. The first
  // case above and the last one below are that trap; the other is the first
  // Saturday of winter time.
  assert(detailModeFor(new Date("2026-10-31T00:30:00Z")) === "full", "Sat 31 Oct 02:30, the night after the switch to winter time");
  assert(detailModeFor(new Date("2026-03-27T23:30:00Z")) === "full", "Sat 28 Mar 02:30 IDT, the night after the switch to summer time");
});

check("which past runs count as a full refresh, for Saturday's selection", () => {
  // On the Saturday pass a site is "fresh" only if its last successful run
  // fetched every detail page. A run from before this existed did (NULL).
  assert(isFullDetailRun("full"), "a full run is");
  assert(isFullDetailRun(null), "a run from before detail modes existed fetched everything");
  assert(!isFullDetailRun("incremental"), "an incremental run is not");
  assert(
    !isFullDetailRun("something-else"),
    "an unknown value is not proof of a full fetch — it fails towards refreshing the site",
  );
});

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("detailPlan: a detail page is skipped only when the stored text provably describes tonight's card");
