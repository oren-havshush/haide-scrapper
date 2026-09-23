// Run: npx tsx worker/lib/anchoredGazetteer.test.ts
//
// The second-stage gazetteer reads ADVERTISING PROSE and writes a published
// city. Everything about that is dangerous, and CLAUDE.md already records why:
// `\b` does not fire after a Hebrew letter, final letters differ, and ordinary
// Hebrew words ARE town names — `כנות` inside `הסוכנות`, `משמרות` meaning
// "shifts", `יקום` inside `מיקום`. Scanning for city-shaped words finds all of
// them, and each one ships as a real address on the public jobs site.
//
// So the scan is anchored. A place is read only where the ad says it is naming
// one: after a location LABEL, or after a word for the employer's own premises.
// Everywhere else is not searched at all.
//
// Fixtures are real ad text: nirlat (cmp01cdsd001a01ph74xluh8r) and tikshoov
// (cmu5mleu7000c01p950bo7eqx), read from /api/jobs on 2026-09-23.

import { extractLocationFromGazetteer } from "./normalizer";
import { isCanonicalLocation, normalizeLocations } from "./locationNormalize";

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
console.log("# nirlat — the three ads that name a place, and the four values");
// ---------------------------------------------------------------------------
{
  // JB-812. The ad names TWO sites, separated by a slash. The old scan returned
  // ONE — and the second one, ניר עוז, losing באר שבע entirely. Splitting the
  // value is the point: an employer writing "X/Y" has named both.
  eq(
    extractLocationFromGazetteer(
      'נירלט מגייסת טכנאי.ת פיתוח לאתר החברה בבאר שבע/ניר עוז! במסגרת התפקיד: ' +
        "• ביצוע עבודות פיתוח וניסויים כחלק מתהליכי פיתוח ושיפור מוצרי החברה",
    ),
    ["באר שבע", "ניר עוז"],
    "JB-812: לאתר החברה ב<X>/<Y> yields both places",
  );

  // JB-802. The value carries a settlement word the city.csv row does not.
  eq(
    extractLocationFromGazetteer(
      "נירלט מגייסת יצרן.ית צבע (על בסיס ממס) לאתר הייצור בקיבוץ ניר עוז! " +
        "במסגרת התפקיד: • הכנת מנות צבע בהתאם להוראות הייצור",
    ),
    ["ניר עוז"],
    "JB-802: בקיבוץ <city> — the settlement word does not block the city",
  );

  // JB-765. A label, with a dash rather than a colon, at the very end of the ad.
  eq(
    extractLocationFromGazetteer(
      "יכולת למידה מהירה של מערכות מידע כגון: CRM, SAP, MES.\nמקום- נתניה",
    ),
    ["נתניה"],
    "JB-765: מקום- <city>",
  );

  // JB-817, for completeness: the same site phrase with the city directly after ב.
  eq(
    extractLocationFromGazetteer("נירלט מגייסת מבקר.ת איכות לאתר הייצור בבאר שבע! במסגרת התפקיד:"),
    ["באר שבע"],
    "JB-817: לאתר הייצור ב<city>",
  );
}

// ---------------------------------------------------------------------------
console.log("# nirlat — the ads that name no place must yield nothing");
// ---------------------------------------------------------------------------
{
  // JB-828's requirements line. `במפעל` IS an anchor, and what follows it is a
  // slash-separated list — of materials. A value that is not on city.csv is not
  // a place, however well-formed the sentence around it is.
  eq(
    extractLocationFromGazetteer("ניסיון קודם במפעל צבע / כימיה / דבקים – יתרון משמעותי."),
    [],
    "JB-828: במפעל צבע / כימיה / דבקים names no place",
  );

  // JB-808. The anchor fires; nothing resolvable follows it.
  eq(
    extractLocationFromGazetteer(
      "בעלי ניסיון בעבודה במפעל יצרני – חובה רישיון נהיגה-חובה נכונות לעבודה פיזית- חובה",
    ),
    [],
    "JB-808: במפעל יצרני names no place",
  );

  // JB-830. No anchor anywhere in a 1,000-character marketing ad.
  eq(
    extractLocationFromGazetteer(
      "נירלט מגייסת מנהל/ת תקשורת שיווקית. התפקיד כולל: אחריות על גיבוש והובלת " +
        "אסטרטגיית התקשורת השיווקית והדיגיטלית של נירלט, לטובת חיזוק המותג והגדלת " +
        "המכירות. ניהול אתר נירלט, כולל פלטפורמת אי-קומרס. תכנון והובלת קמפיינים ממומנים.",
    ),
    [],
    "JB-830: an ad with no anchor yields nothing — including from ניהול אתר נירלט",
  );
}

// ---------------------------------------------------------------------------
console.log("# tikshoov — the five false matches, each from its own real ad");
// ---------------------------------------------------------------------------
{
  // Every one of these five words is a genuine city.csv row, which is exactly
  // what makes them dangerous: they pass every downstream gate.
  for (const name of ["שדרות", "אזור", "משמרות", "חניתה", "יקום"]) {
    assert(isCanonicalLocation(name), `${name} really is on city.csv — that is the trap`);
  }

  // 1. שדרות — a BOULEVARD. Two different tikshoov ads, two different streets.
  eq(
    extractLocationFromGazetteer(
      "מיקום המשרה: חיפה (מושבה גרמנית, קניון סיטי סנטר, שדרות בן גוריון 6). מיקום מרכזי ונגיש.",
    ),
    ["חיפה"],
    "4953: the label's own value is חיפה; שדרות בן גוריון is a street",
  );
  eq(
    extractLocationFromGazetteer(
      "קופת חולים מאוחדת. מיקום המשרה: אשקלון (שדרות התעשייה 8, בניין בית דסור - מול כלא אשקלון).",
    ),
    ["אשקלון"],
    "4893: likewise — שדרות התעשייה is a street inside the אשקלון value",
  );

  // 2. אזור — "the area of".
  eq(
    extractLocationFromGazetteer(
      "מיקום המשרה: ירושלים (המטה הארצי, קלרמון גאנו 4 - אזור גבעת התחמושת). מתן מענה טלפוני.",
    ),
    ["ירושלים"],
    "3327: אזור גבעת התחמושת does not make the town אזור",
  );

  // 3. משמרות — "shifts". Six tikshoov ads say עבודה במשמרות; none is in the
  //    moshav. Note the ב prefix: this is precisely the "ב<city>" shape the old
  //    scan trusted.
  eq(
    extractLocationFromGazetteer(
      "עבודה בימים א'-ה' בין השעות 08:00-18:00. עבודה במשמרות: 08:00-16:00 או 10:00-18:00.",
    ),
    [],
    "5043: עבודה במשמרות is a shift pattern, not מושב משמרות",
  );

  // 4. חניתה — via the edit-distance-1 tail, from חניכה ("mentoring").
  eq(
    extractLocationFromGazetteer(
      "ניהול אישי ומקצועי של נציגי הצוות - חניכה והובלת הצוות לעמידה ביעדים - ביצוע שיחות משוב",
    ),
    [],
    "5102/4082: חניכה is not the kibbutz חניתה",
  );

  // 5. יקום — inside מיקום, the label word itself (LRN-LOC-6). The anchored
  //    scan cannot make this mistake: מיקום is consumed AS the anchor.
  eq(
    extractLocationFromGazetteer("מיקום המשרה: עבודה מהבית (ההכשרה מתקיימת פרונטלית בנתניה)."),
    [],
    "5046: a work-from-home label value names no city — and יקום is not lifted out of מיקום",
  );
  // And the real place of that name still resolves when an ad actually says it.
  eq(
    extractLocationFromGazetteer("מיקום המשרה: יקום"),
    ["יקום"],
    "5093/4998: the kibbutz יקום still lands when the label names it",
  );
}

// ---------------------------------------------------------------------------
console.log("# CLAUDE.md's two named traps");
// ---------------------------------------------------------------------------
{
  // כנות inside הסוכנות. The word is a real moshav; the ad is about an agency.
  eq(
    extractLocationFromGazetteer("החברה עובדת מול הסוכנות היהודית ומול משרדי הממשלה."),
    [],
    "הסוכנות does not contain the moshav כנות",
  );
  eq(
    extractLocationFromGazetteer("נכונות לעבודה במשמרות ובסופי שבוע."),
    [],
    "במשמרות is shifts, not the moshav",
  );
  // The final-letter case named in CLAUDE.md: סניף ends in ף, סניפים in פ.
  eq(
    extractLocationFromGazetteer("דרוש/ה מנהל/ת לסניף ברחובות."),
    ["רחובות"],
    "the singular סניף is an anchor",
  );
  eq(
    extractLocationFromGazetteer("דרוש/ה מנהל/ת לסניפי החברה בחדרה."),
    ["חדרה"],
    "and so is the construct plural סניפי — the final letter differs",
  );
}

// ---------------------------------------------------------------------------
console.log("# the anchor set, and the fact that nothing else is scanned");
// ---------------------------------------------------------------------------
{
  for (const [text, want] of [
    ["מיקום המשרה: נתניה (שילוב עבודה מהבית)", ["נתניה"]],
    ["מיקום: חיפה", ["חיפה"]],
    ["מקום העבודה: אשדוד", ["אשדוד"]],
    ["כתובת: רחובות", ["רחובות"]],
    ["העבודה באתר נתניה", ["נתניה"]],
    ["העבודה בסניף חדרה", ["חדרה"]],
    ["העבודה במפעל בבאר שבע", ["באר שבע"]],
    ["העבודה במשרדי החברה בהרצליה", ["הרצליה"]],
    ["העבודה במשרדינו ברמת גן", ["רמת גן"]],
  ] as Array<[string, string[]]>) {
    eq(extractLocationFromGazetteer(text), want, `anchor fires: ${JSON.stringify(text)}`);
  }

  // The removed behaviour, stated so it cannot come back by accident. Each of
  // these was a real production fixture of the bare-word scan; each is now
  // deliberately unrecognised, because the same shape is what produced the five
  // false matches above.
  for (const text of [
    "מחסנאי/ת לנמל אשדוד דרוש/ה מחסנאי/ת!", // ל<noun> <bare city>
    "דרוש/ה נהג/ת חלוקה 12 טון למושב כנות חברת ישרקו", // ל<noun> <bare city>
    "דרוש/ה מפעיל/ת CNC למפעל מצליח ברמת הגולן!!", // ב<region>, unanchored
    "📍 פארק המדע רחובות", // a cue within 30 chars
  ]) {
    eq(extractLocationFromGazetteer(text), [], `no longer scanned: ${JSON.stringify(text)}`);
  }
}

// ---------------------------------------------------------------------------
console.log("# the multi-word exception — a two-word name needs no anchor");
// ---------------------------------------------------------------------------
//
// Every one of the five false matches above is ONE word: שדרות, אזור, משמרות,
// חניתה, יקום. So is כנות. That is not a coincidence — it is the whole reason
// Hebrew prose scanning fails. A one-word place name is a word, and Hebrew has
// a lot of words.
//
// Two words is a different proposition. "באר שבע" and "פתח תקווה" are not
// phrases that occur by accident, and a prefixed ב in front of one is an
// employer saying where the job is. So a name of two or more words is read
// without an anchor; a name of one word still requires one.
//
// 669 of city.csv's 1,368 entries are multi-word, and 20 of the 43 alias keys.
{
  eq(
    extractLocationFromGazetteer("דרוש/ה מחסנאי/ת למחסן שלנו בבאר שבע"),
    ["באר שבע"],
    "בבאר שבע resolves with no anchor",
  );
  eq(
    extractLocationFromGazetteer("העבודה בתל אביב"),
    ["תל אביב-יפו"],
    "בתל אביב resolves, through the alias — a legal spelling still lands (LRN-LOC rule 2)",
  );
  eq(
    extractLocationFromGazetteer("המשרד שלנו בפתח תקווה, ליד הרכבת"),
    ["פתח תקווה"],
    "בפתח תקווה resolves",
  );

  // One word still needs an anchor. These are the same five, now stated as a
  // rule rather than as five separate cases.
  for (const [text, name] of [
    ["המשרד ממוקם בשדרות רוטשילד 15", "שדרות"],
    ["לבסיס באזור צומת שוקת דרוש/ה טכנאי/ת", "אזור"],
    ["העבודה במשמרות בוקר וערב", "משמרות"],
    ["חניכה והובלת הצוות לעמידה ביעדים", "חניתה"],
    ["מיקום המשרה: עבודה מהבית (ההכשרה בנתניה)", "יקום"],
    ["החברה עובדת מול הסוכנות היהודית", "כנות"],
    ["לחברה מובילה ברחובות דרוש/ה מבקר/ת טיב", "רחובות"],
  ] as Array<[string, string]>) {
    const got = extractLocationFromGazetteer(text);
    assert(
      !got.includes(name),
      `one word still needs an anchor: ${JSON.stringify(name)} not read from ${JSON.stringify(text)} (got ${JSON.stringify(got)})`,
    );
  }
  // And the five that matter, as whole results.
  for (const text of [
    "המשרד ממוקם בשדרות רוטשילד 15",
    "לבסיס של צה\"ל באזור צומת שוקת דרוש/ה טכנאי/ת",
    "עבודה בימים א'-ה'. עבודה במשמרות: 08:00-16:00 או 10:00-18:00.",
    "ניהול אישי ומקצועי של נציגי הצוות - חניכה והובלת הצוות לעמידה ביעדים",
    "החברה עובדת מול הסוכנות היהודית ומול משרדי הממשלה.",
  ]) {
    eq(extractLocationFromGazetteer(text), [], `still nothing: ${JSON.stringify(text)}`);
  }

  // The ב has to be attached to the name itself. "בדרום תל אביב" prefixes the
  // DIRECTION, and the direction patterns went with the rest of the bare scan.
  eq(
    extractLocationFromGazetteer("דרוש/ה עובד/ת לחברה בדרום תל אביב"),
    [],
    "the ב must sit on the name, not on a word in front of it",
  );
  // An abbreviation is one token and is not on city.csv at all, so it still
  // needs an anchor even though what it stands for is two words.
  eq(
    extractLocationFromGazetteer('דרוש/ה מנהל/ת חשבונות בת"א'),
    [],
    'בת"א still needs an anchor — the abbreviation is not a city.csv entry',
  );
  eq(
    extractLocationFromGazetteer('מיקום המשרה: ת"א'),
    ["תל אביב-יפו"],
    "and resolves the moment it has one",
  );

  // An area label is two words and must STILL yield nothing: it names a region
  // and several towns at once (job 4082).
  eq(
    extractLocationFromGazetteer("המוקד בחיפה וקריות מגייס"),
    [],
    "an area label is excluded from the multi-word scan too",
  );
  eq(
    extractLocationFromGazetteer("המוקד באזור תל אביב מגייס"),
    [],
    "including אזור תל אביב, which would otherwise collapse to the city",
  );

  // --- the qualifier words, coming back through the anchor door -----------
  //
  // Found by measuring the new rule against the fleet, not by reading the code.
  // The anchored path matches the longest place name a value STARTS with, and
  // when the longer attempts fail it falls to one word — so `באזור טל שחר`
  // ("the area of moshav Tal Shahar", a real elbit ad) degraded to `אזור`, the
  // town. Two of the five false matches are exactly this shape, and both were
  // walking straight back in.
  //
  // A qualifier word in front of other words qualifies them. The place is what
  // follows it.
  eq(
    extractLocationFromGazetteer("מרכיב.ה מכאני לאתר החברה באזור טל שחר דרושים.ות"),
    ["טל שחר"],
    "elbit 4391: באזור טל שחר is the moshav, not the town אזור",
  );
  // The same shape, and לטרון IS a city.csv row — so this one resolves to the
  // place the ad names, which is also what the site stores for job 7042. The
  // qualifier rule does not decide whether a value is a place; it decides which
  // word is being named.
  eq(
    extractLocationFromGazetteer("רכז.ת איכות לאתר הממוקם באזור לטרון דרוש.ה"),
    ["לטרון"],
    "elbit 7042: באזור לטרון is לטרון, not the town אזור",
  );
  eq(
    extractLocationFromGazetteer("מיקום המשרה: שדרות רוטשילד 15"),
    [],
    "a labelled boulevard is not the city שדרות",
  );
  eq(
    extractLocationFromGazetteer("מיקום המשרה: אזור השרון"),
    ["אזור השרון"],
    "but a region that begins with אזור still resolves — longest match first",
  );
  eq(
    extractLocationFromGazetteer("מיקום המשרה: אזור"),
    ["אזור"],
    "and a value that is ONLY אזור is the town, because there is nothing for it to qualify",
  );
  eq(
    extractLocationFromGazetteer("מיקום המשרה: שדרות"),
    ["שדרות"],
    "likewise שדרות alone",
  );

  // --- the nationwide marker is not read from prose ----------------------
  //
  // "פריסה ארצית" is a real city.csv entry and the right answer for a role that
  // genuinely has no one place. It is also two words, so the rule above would
  // read it — and the sentences it appears in are usually not about where the
  // job is. Measured on the fleet: "מערך הסעות בפריסה ארצית" is a nationwide
  // SHUTTLE SERVICE offered as a perk, and "בקווי הייצור בפריסה ארצית"
  // describes the company's production lines.
  //
  // A wrong value is worse than a missing one, and "this job is everywhere" is
  // a wrong value with nothing downstream to catch it. So it is excluded from
  // the UNANCHORED scan only: an ad that labels it, or a site field that
  // states it, still lands.
  eq(
    extractLocationFromGazetteer(
      "שעות נוספות ותנאים נוספים מערך הסעות בפריסה ארצית המשרה מיועדת לנשים וגברים כאחד",
    ),
    [],
    "elbit 4729: a nationwide SHUTTLE SERVICE is not the job's location",
  );
  eq(
    extractLocationFromGazetteer(
      "דרושים.ות עובדים.ות לעבודה בקווי הייצור בפריסה ארצית – עבודה עם משמעות",
    ),
    [],
    "elbit 6613: nationwide PRODUCTION LINES are not the job's location either",
  );
  eq(
    extractLocationFromGazetteer("החברה פועלת בכל הארץ"),
    [],
    "and not through the alias that means the same thing",
  );

  // Still reachable the two ways that are an assertion rather than a mention.
  eq(
    extractLocationFromGazetteer("מיקום המשרה: פריסה ארצית"),
    ["פריסה ארצית"],
    "a labelled nationwide value still lands",
  );
  eq(
    extractLocationFromGazetteer("מיקום המשרה: כל הארץ"),
    ["פריסה ארצית"],
    "including through its alias",
  );
  assert(
    JSON.stringify(normalizeLocations("פריסה ארצית")) === JSON.stringify(["פריסה ארצית"]),
    "and a site field carrying it is untouched — this changes the gazetteer only",
  );

  // Only that value is dropped, not the whole result.
  eq(
    extractLocationFromGazetteer("מערך הסעות בפריסה ארצית. המפעל בבאר שבע."),
    ["באר שבע"],
    "a real place in the same ad still comes through",
  );

  // An anchored value still wins outright. The unanchored scan is a fallback
  // and runs only when the anchors found nothing — a labelled value is the
  // employer answering the question directly.
  eq(
    extractLocationFromGazetteer("מיקום המשרה: חיפה. המטה שלנו בבאר שבע."),
    ["חיפה"],
    "a labelled value is not diluted by a place mentioned elsewhere in the ad",
  );
}

// ---------------------------------------------------------------------------
console.log("# the gate — nothing off-list ever leaves the gazetteer");
// ---------------------------------------------------------------------------
{
  for (const text of [
    "מיקום המשרה: צ'ק פוסט",
    "מיקום המשרה: הכשרה באזור תעשייה קדמת גליל",
    "מיקום המשרה: תקשוב מהבית",
    "מיקום המשרה: לוד (מול תחנת הרכבת",
    "כתובת: רחוב המלאכה 14",
    "העבודה במשרדי החברה בחו\"ל",
    "מיקום המשרה: חיפה וקריות",
  ]) {
    const out = extractLocationFromGazetteer(text);
    const bad = out.filter((v) => !isCanonicalLocation(v));
    eq(bad, [], `no off-list value from ${JSON.stringify(text)}`);
  }
  // The area label in particular: it names a region and two different city
  // groups, and must not collapse to חיפה (the rule-4 case, job 4082).
  eq(extractLocationFromGazetteer("מיקום המשרה: חיפה וקריות"), [], "an area label names no city");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nanchoredGazetteer: a place is read only where the ad says it is naming one");
