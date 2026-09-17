// Run: npx tsx worker/lib/locationOffList.test.ts
//
// Three rules that together stop an off-list city reaching the Job table.
// Every fixture is real text from tikshoov.co.il (site cmp3029bh001b01nyrezdzwho),
// whose 120 stored listings held 49 values that are in neither city.csv nor
// IL_CANONICAL — the largest single source of off-list locations on the fleet.
//
// Rule 1  normalizeLocations never returns a value outside the vocabulary.
// Rule 2  aliases resolve BEFORE that check, so a legal spelling still lands.
// Rule 3  שדרות and אזור are never matched as a bare or prefixed word.

import {
  normalizeLocations,
  isCanonicalLocation,
  LOCATION_ALIAS,
  LOCATION_EN,
} from "./locationNormalize";
import { extractLocationFromGazetteer } from "./normalizer";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}
const eq = (got: unknown, want: unknown, msg: string) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    console.error(`FAIL: ${msg}\n  got=${g}\n  want=${w}`);
    failures++;
  }
};

// ---------------------------------------------------------------------------
console.log("# rule 1 — normalizeLocations never returns an off-list value");
// ---------------------------------------------------------------------------
// The leak this closes is the raw-string passthrough documented in LRN-LOC-5:
// `return out.length ? out : [original]` handed an unresolved token back
// verbatim, and the worker's persist path stored it. These seven strings are
// what tikshoov actually served; none is a place.
{
  const offList = [
    "תקשוב מהבית", // the employer's "work from home" bucket
    "צ'ק פוסט", // a Haifa district, not a city.csv row
    "הכשרה בקדמת גליל", // "training at Kadmat Galil"
    "באזור תעשייה קדמת גליל",
    "לוד (מול תחנת הרכבת", // truncated, with an unbalanced paren
    "עבודה מהבית (ההכשרה מתקיימת פרונטלית בתחנה המרכזית ירושלים).",
    "Sderot Nowhere", // no Hebrew at all, and not abroad either
  ];
  for (const raw of offList) {
    const out = normalizeLocations(raw);
    const bad = out.filter((v) => !isCanonicalLocation(v));
    eq(bad, [], `no off-list value survives: ${JSON.stringify(raw)}`);
  }

  // The contract is total, not a filter applied at one call site: EVERY value
  // returned for ANY input must be canonical.
  const corpus = [
    "חיפה וקריות",
    'ירושלים יו"ש',
    "חולון - ראשון לציון",
    "מרכז וגוש דן",
    "תל אביב - בני ברק",
    "יקום / נתניה.",
    "תל אביב/ היברידי",
    "חיפה (צ'ק פוסט).",
    "",
    "Unknown",
    ...offList,
  ];
  for (const raw of corpus) {
    for (const v of normalizeLocations(raw)) {
      assert(
        isCanonicalLocation(v),
        `every returned value is canonical — ${JSON.stringify(raw)} yielded ${JSON.stringify(v)}`,
      );
    }
  }

  // An unresolvable value must come back EMPTY, so the caller stores nothing
  // rather than something wrong. A wrong value is worse than a missing one.
  eq(normalizeLocations("צ'ק פוסט"), [], "an unresolvable value yields [] , not the raw string");
}

// ---------------------------------------------------------------------------
console.log("# rule 2 — aliases resolve before the off-list check");
// ---------------------------------------------------------------------------
// Rule 1 must not be implemented as a membership test on the RAW input: the
// spellings operators and employers actually write are legal precisely because
// the cascade maps them first (LRN-LOC-5, "emitted value != stored value").
{
  // tikshoov job 4923 — the ad says תל אביב, which city.csv does not contain.
  eq(normalizeLocations("תל אביב"), ["תל אביב-יפו"], "תל אביב -> תל אביב-יפו");
  eq(
    normalizeLocations("תל אביב/ היברידי"),
    ["תל אביב-יפו"],
    "4923: תל אביב survives the slash list, היברידי is dropped",
  );

  // tikshoov job 2441 — קריית with the double yod; city.csv has קרית.
  eq(normalizeLocations("קריית מוצקין"), ["קרית מוצקין"], "קריית מוצקין -> קרית מוצקין");
  eq(normalizeLocations("קריית גת"), ["קרית גת"], "קריית גת -> קרית גת");

  // The whole alias and English tables must land inside the vocabulary,
  // otherwise rule 1 would silently start deleting legal values.
  for (const [k, v] of Object.entries(LOCATION_ALIAS)) {
    assert(isCanonicalLocation(v), `alias ${JSON.stringify(k)} -> ${JSON.stringify(v)} is canonical`);
    eq(normalizeLocations(k), [v], `alias ${JSON.stringify(k)} still resolves under rule 1`);
  }
  for (const [k, v] of Object.entries(LOCATION_EN)) {
    assert(isCanonicalLocation(v), `english ${JSON.stringify(k)} -> ${JSON.stringify(v)} is canonical`);
    eq(normalizeLocations(k), [v], `english ${JSON.stringify(k)} still resolves under rule 1`);
  }

  // Abbreviations and the gershayim squash, which only work post-alias.
  eq(normalizeLocations('ת"א'), ["תל אביב-יפו"], 'ת"א -> תל אביב-יפו');
  const bilu = normalizeLocations("ביל״ו");
  eq(bilu.length, 1, "ביל״ו with a typographic gershayim resolves to one value");
  assert(isCanonicalLocation(bilu[0]), "and that value is canonical");
}

// ---------------------------------------------------------------------------
console.log("# rule 3 — שדרות and אזור are never matched as a bare or prefixed word");
// ---------------------------------------------------------------------------
// Both ARE real city.csv rows, and both are overwhelmingly a common noun when
// they appear inside a longer string: שדרות = "boulevard", אזור = "the area
// of". Same class as LRN-LOC-2's במשמרות -> משמרות. The denylist applies to the
// scanner only; an exact value is still the city.
{
  // tikshoov 4953: the ad names חיפה, and שדרות is Ben Gurion BOULEVARD.
  eq(
    normalizeLocations("חיפה (מושבה גרמנית, קניון סיטי סנטר, שדרות בן גוריון 6)"),
    ["חיפה"],
    "4953: שדרות בן גוריון is a boulevard, not Sderot",
  );
  eq(normalizeLocations("שדרות בן גוריון 6"), [], "a boulevard alone yields no city");
  eq(normalizeLocations("שדרות רוטשילד 15"), [], "שדרות רוטשילד is not Sderot either");

  // tikshoov 3327: the ad names ירושלים, and אזור means "the area of".
  eq(
    normalizeLocations("ירושלים (המטה הארצי, קלרמון גאנו 4 - אזור גבעת התחמושת)"),
    ["ירושלים"],
    "3327: אזור גבעת התחמושת is 'the area of', not the town אזור",
  );
  eq(normalizeLocations("אזור גבעת התחמושת"), [], "'the area of X' alone yields no city");
  eq(normalizeLocations("באזור תעשייה קדמת גליל"), [], "prefixed באזור yields no city");

  // ...but the towns themselves still resolve when that is what the value says.
  eq(normalizeLocations("שדרות"), ["שדרות"], "an exact שדרות is still the city Sderot");
  eq(normalizeLocations("אזור"), ["אזור"], "an exact אזור is still the town Azor");

  // Region aliases beginning with אזור must be untouched — they are consumed
  // whole, longest-first, before the bare word is ever considered.
  eq(normalizeLocations("אזור מרכז"), ["אזור מרכז"], "אזור מרכז is a legal region entry");
  eq(normalizeLocations("מרכז"), ["אזור מרכז"], "the מרכז alias still yields אזור מרכז");
  eq(normalizeLocations('ירושלים יו"ש'), ["אזור ירושלים"], "the tikshoov bucket still maps to its region");

  // The same rule on the gazetteer side: a cue plus a bare ב-prefix used to
  // read Rothschild Boulevard as the city Sderot.
  eq(
    extractLocationFromGazetteer("המשרד ממוקם בשדרות רוטשילד 15"),
    null,
    "gazetteer: בשדרות רוטשילד is not the city שדרות",
  );
  // A labeled value keeps the full vocabulary — that context is reliable.
  eq(
    extractLocationFromGazetteer("מיקום המשרה: שדרות"),
    "שדרות",
    "gazetteer: a labeled שדרות is still the city",
  );
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nall location off-list assertions passed");
