/**
 * locationNormalize.ts — map a raw scraped location onto the canonical
 * vocabulary in "CSV files/city.csv".
 *
 * Why this exists: 59% of stored jobs (3,710 of 6,249, across 85 of 141 sites)
 * held a location that was not a canonical entry — the same handful of variants
 * recurring across unrelated sites ("מרכז"/"גוש דן"/"מרכז - גוש דן", "צפון",
 * "תל אביב", plus a leaked "מיקום:" label on 79 values). Fixing that per-site
 * would mean 85 separate edits; doing it once here fixes every site, including
 * ones not yet onboarded.
 *
 * Contract:
 *   - NEVER returns a value outside the vocabulary. If nothing matches, the
 *     result is EMPTY. This reverses the original "never blank a value" rule:
 *     the raw-string passthrough (`out.length ? out : [original]`) was the leak
 *     LRN-LOC-5 names, and it is how tikshoov stored 49 values that are in
 *     neither list ("חיפה וקריות", "צ'ק פוסט", "תקשוב מהבית"). A wrong value is
 *     worse than a missing one: nothing downstream repairs a wrong location,
 *     while an empty one is filled by the gazetteer or locationFallback.
 *     Genuinely-abroad postings ("new york", "remote") are off-list too, so
 *     they now come back empty rather than as a foreign city.
 *   - Returns a LIST. 926 jobs genuinely name several places
 *     ("חולון ובת-ים, ת\"א, מודיעין"); callers that need one value take [0].
 *
 * Cascade, per comma/pipe/slash-separated part:
 *   exact -> alias/abbreviation -> English -> hyphen/spelling variant ->
 *   typo (edit distance 1) -> scan for every known place named inside it
 *
 * Measured on the live fleet: canonical 35.6% -> 98.5%.
 */
import { IL_CANONICAL } from "../data/il-places";

const CANONICAL: ReadonlySet<string> = new Set(IL_CANONICAL);
/** Longest-first so "תל אביב-יפו" is consumed whole, never re-matched as "תל אביב". */
const BY_LEN: readonly string[] = [...IL_CANONICAL].sort((a, b) => b.length - a.length);

/** Unify the punctuation that makes identical names compare unequal. */
export function squash(s: string): string {
  return s
    .replace(/[״"”“]/g, '"')
    .replace(/[׳'’‘]/g, "'")
    .replace(/[‐-―–—]/g, "-")
    .replace(/[‎‏ ]/g, " ")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** A "מיקום:" / "מיקום המשרה:" label that leaked into the value. */
const LABEL = /^\s*מיקום(\s+המשרה)?\s*:?\s+/;

/** Region spellings, abbreviations and known variants -> canonical. Keys are squash()ed. */
export const LOCATION_ALIAS: Readonly<Record<string, string>> = {
  מרכז: "אזור מרכז", המרכז: "אזור מרכז", "אזור המרכז": "אזור מרכז",
  "גוש דן": "אזור מרכז", "מרכז גוש דן": "אזור מרכז", "מרכז-גוש דן": "אזור מרכז",
  "אזור גוש דן": "אזור מרכז",
  צפון: "אזור צפון", הצפון: "אזור צפון", "אזור הצפון": "אזור צפון",
  דרום: "אזור דרום", הדרום: "אזור דרום", "אזור הדרום": "אזור דרום", הנגב: "אזור דרום",
  שפלה: "אזור שפלה", השפלה: "אזור שפלה", "אזור השפלה": "אזור שפלה",
  שרון: "אזור השרון", השרון: "אזור השרון",
  "ירושלים והסביבה": "אזור ירושלים", 'ירושלים יו"ש': "אזור ירושלים",
  'ירושלים ויו"ש': "אזור ירושלים",
  "אילת והערבה": "אזור אילת", "אילת והסביבה": "אזור אילת",
  "כל הארץ": "פריסה ארצית", ארצי: "פריסה ארצית", "כלל הארץ": "פריסה ארצית",
  // NOTE: no entry here may map an AREA onto a single city. A region key is
  // fine when its value is itself a region ("ירושלים יו\"ש" -> "אזור ירושלים"):
  // that keeps the area the ad actually gave. Removed 2026-09-17 for turning an
  // area into a city the ad never stated — see AREA_LABEL below.
  // abbreviations
  'ת"א': "תל אביב-יפו", "תל אביב": "תל אביב-יפו", 'ת"א-יפו': "תל אביב-יפו",
  'פ"ת': "פתח תקווה", 'ראשל"צ': "ראשון לציון", 'ב"ש': "באר שבע", 'ר"ג': "רמת גן",
  // spelling variants seen live
  "פתח תיקווה": "פתח תקווה", "פתח תקוה": "פתח תקווה", "פתח תיקוה": "פתח תקווה",
  "פתח-תקווה": "פתח תקווה", "נצרת עלית": "נצרת עילית", יקנעם: "יוקנעם",
  // standing overrides — city.csv has no standalone לוד/רמלה, and חצור is
  // ambiguous there; pinned by product decision (2026-08-03).
  לוד: "רמלה לוד", רמלה: "רמלה לוד", חצור: "חצור הגלילית",
};

/** Latin-script city names used by English-language boards. */
export const LOCATION_EN: Readonly<Record<string, string>> = {
  "tel aviv": "תל אביב-יפו", "tel-aviv": "תל אביב-יפו", "tel aviv-yafo": "תל אביב-יפו",
  jerusalem: "ירושלים", haifa: "חיפה", netanya: "נתניה", "beer sheva": "באר שבע",
  "be'er sheva": "באר שבע", beersheba: "באר שבע", rehovot: "רחובות", holon: "חולון",
  "ramat gan": "רמת גן", "petah tikva": "פתח תקווה", "petach tikva": "פתח תקווה",
  "rishon lezion": "ראשון לציון", herzliya: "הרצליה", raanana: "רעננה",
  "ra'anana": "רעננה", "kfar saba": "כפר סבא", modiin: "מודיעין", karmiel: "כרמיאל",
  yokneam: "יוקנעם", ashdod: "אשדוד", ashkelon: "אשקלון", eilat: "אילת",
  "nes ziona": "נס ציונה", yavne: "יבנה", lod: "רמלה לוד", ramla: "רמלה לוד",
  "rosh haayin": "ראש העין", "rosh ha'ayin": "ראש העין", "bnei brak": "בני ברק",
  givatayim: "גבעתיים", "hod hasharon": "הוד השרון", "kiryat gat": "קרית גת",
  nazareth: "נצרת", tiberias: "טבריה", acre: "עכו", hadera: "חדרה",
  israel: "פריסה ארצית",
};

/**
 * Names that ARE city.csv entries but read as an ordinary Hebrew noun whenever
 * they turn up inside a longer string, so scanning for them manufactures places:
 *   שדרות = "boulevard" — "שדרות רוטשילד 15" is a Tel Aviv street, not Sderot.
 *   אזור  = "the area of" — "אזור גבעת התחמושת" is a Jerusalem district, not Azor.
 * Same class as LRN-LOC-2's "במשמרות" (= in shifts) resolving to the moshav
 * משמרות, and the mirror of normalizer.ts's BARE_PREFIX_DENYLIST.
 *
 * This gates the SCANNER only. An exact value still resolves through the
 * canonical/alias path above, so a job really located in שדרות or אזור is
 * unaffected — and the "אזור <region>" entries are consumed whole, longest
 * needle first, before the bare word is ever considered.
 */
const SCAN_DENYLIST: ReadonlySet<string> = new Set(["שדרות", "אזור"]);

/**
 * Compound labels that name an AREA AROUND a city rather than the city, and
 * whose area has no entry of its own in city.csv. They resolve to nothing.
 *
 * Deleting their alias entries is not enough on its own: "חיפה וקריות" leads
 * with a real city name, so the scanner below would find "חיפה" at offset 0 and
 * re-create exactly the collapse the alias removal was meant to stop.
 *
 * This is the tikshoov 4082 case. That ad names no place at all — no
 * "מיקום המשרה:" line, a title ending in the Haifa district צ'ק פוסט — and its
 * only signal was the board's bucket "חיפה וקריות", which spans Haifa AND
 * קרית אתא / קרית מוצקין / קרית ביאליק. Publishing "חיפה" asserted a city the
 * employer never gave, and nothing downstream repairs that (LRN-LOC-1).
 *
 * Note these are NOT the same as the region aliases kept above: "אזור מרכז",
 * "אזור ירושלים" and "פריסה ארצית" ARE city.csv entries, so a bucket that maps
 * onto one of them loses nothing.
 */
const AREA_LABEL: ReadonlySet<string> = new Set([
  "חיפה וקריות",
  "חיפה והקריות",
  "אזור תל אביב",
]);

/**
 * True for a value that names an AREA around a city rather than a city.
 *
 * Exported because the gazetteer needs the identical rule and reaches it by a
 * different route: it matches the longest place name a value STARTS with, and
 * "חיפה וקריות" starts with "חיפה". Without this the area label would collapse
 * to the city by the front door after being shut out of the alias table —
 * exactly job 4082 again.
 */
export function isAreaLabel(v: string): boolean {
  return AREA_LABEL.has(squash(v));
}

function levenshtein1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length] === 1;
}

const isHeb = (ch: string) => /[֐-׿]/.test(ch);

/**
 * Every known place named inside a string — "חיפה חדרה והצפון" yields all three.
 * Longest-first and non-overlapping; each hit must sit on a word boundary so a
 * name can't be found inside a longer word ("גפן" inside "נוף הגפן"). Only a
 * leading ו- is tolerated; ה- is not, since definite forms that matter
 * ("הצפון", "השרון") are alias keys in their own right.
 */
function scanPlaces(raw: string): string[] {
  const hay = squash(raw);
  const candidates: Array<[string, string]> = [];
  for (const c of BY_LEN) if (c.length >= 3 && !SCAN_DENYLIST.has(c)) candidates.push([c, c]);
  for (const [k, v] of Object.entries(LOCATION_ALIAS))
    if (k.length >= 3 && !SCAN_DENYLIST.has(k)) candidates.push([k, v]);
  candidates.sort((a, b) => b[0].length - a[0].length);

  const taken: Array<[number, number]> = [];
  const hits: Array<{ at: number; value: string }> = [];
  for (const [needle, canonical] of candidates) {
    let from = 0;
    for (;;) {
      const at = hay.indexOf(needle, from);
      if (at === -1) break;
      from = at + 1;
      const end = at + needle.length;
      const before = at > 0 ? hay[at - 1] : " ";
      const after = end < hay.length ? hay[end] : " ";
      if (isHeb(before) && before !== "ו") continue;
      if (isHeb(after)) continue;
      if (taken.some(([a, b]) => at < b && end > a)) continue;
      taken.push([at, end]);
      hits.push({ at, value: canonical });
    }
  }
  hits.sort((a, b) => a.at - b.at);
  const out: string[] = [];
  for (const h of hits) if (!out.includes(h.value)) out.push(h.value);
  return out;
}

/**
 * Resolve one value EXACTLY: the canonical list, the alias table, the English
 * table, and the two spelling variants — and nothing approximate.
 *
 * Split out from resolvePart so a caller can ask for certainty. The
 * edit-distance-1 tail below is a recovery for a value an employer typed
 * slightly wrong; applied to a word lifted out of prose it is an invention
 * machine (`חניכה`, "mentoring", resolves to the kibbutz `חניתה`). The anchored
 * gazetteer in normalizer.ts takes its values from ad text and therefore uses
 * this, never resolvePart.
 */
export function resolveExactLocation(part: string): string | null {
  const p = squash(part);
  if (!p) return null;
  if (CANONICAL.has(p)) return p;
  if (LOCATION_ALIAS[p]) return LOCATION_ALIAS[p];

  // "Tel Aviv, Israel" -> "tel aviv". Keep the unstripped form when the suffix
  // IS the whole value, or a bare "Israel" would strip to nothing and miss its
  // own LOCATION_EN entry (-> פריסה ארצית).
  const lowerRaw = p.toLowerCase();
  const lower = lowerRaw.replace(/,?\s*(israel|il)\.?$/i, "").trim() || lowerRaw;
  if (LOCATION_EN[lower]) return LOCATION_EN[lower];
  if (/^[a-z]/i.test(p))
    for (const [en, he] of Object.entries(LOCATION_EN))
      if (en.length >= 4 && lower.includes(en)) return he;

  for (const alt of [
    p.replace(/-/g, " "),
    p.replace(/ /g, "-"),
    p.replace(/קרית/g, "קריית"),
    p.replace(/קריית/g, "קרית"),
  ])
    if (CANONICAL.has(alt)) return alt;

  return null;
}

function resolvePart(part: string): string | null {
  const exact = resolveExactLocation(part);
  if (exact) return exact;
  // The approximate tail: an employer's typo, recovered. Deliberately NOT part
  // of resolveExactLocation — see the note there.
  const p = squash(part);
  if (p.length >= 5) for (const c of BY_LEN) if (c.length >= 5 && levenshtein1(p, c)) return c;
  return null;
}

/**
 * Normalise a raw location into canonical values.
 *
 * Returns [] whenever nothing in the input resolves — empty input, the
 * "Unknown" sentinel, prose, a district, a street, or a foreign city. Every
 * value it DOES return is guaranteed to be in the vocabulary; the final filter
 * is the single gate, and it runs AFTER the whole cascade so the alias and
 * abbreviation spellings that employers actually write still land.
 */
export function normalizeLocations(raw: string | null | undefined): string[] {
  const original = (raw ?? "").trim();
  if (!original || original === "Unknown") return [];
  if (CANONICAL.has(original)) return [original];

  const s = squash(original).replace(LABEL, "").trim();
  if (!s) return [];

  const out: string[] = [];
  for (const part of s.split(/\s*[,|/;]\s*/).map((x) => x.trim()).filter(Boolean)) {
    // An area-around-a-city label contributes nothing — and must not reach the
    // scanner, which would pick the city out of its first word.
    if (AREA_LABEL.has(part)) continue;
    const direct = resolvePart(part);
    if (direct) {
      if (!out.includes(direct)) out.push(direct);
      continue;
    }
    for (const v of scanPlaces(part)) if (!out.includes(v)) out.push(v);
  }
  // The gate. Nothing leaves this function that city.csv does not contain —
  // a caller can trust the output instead of re-checking it.
  return out.filter((v) => CANONICAL.has(v));
}

/** True when every value belongs to the canonical vocabulary. */
export function isCanonicalLocation(v: string): boolean {
  return CANONICAL.has(v);
}

/**
 * A region or a nationwide marker rather than a single place.
 *
 * These are legal city.csv entries and legal for a JOB — a job really can be
 * "אזור מרכז". A company HQ is a place, so they are refused there: without this,
 * a street called "רחוב השפלה" resolved through the alias table to "אזור שפלה"
 * and became the HQ region of a Tel Aviv company.
 *
 * Lives here, beside the vocabulary itself, because both sides of the fence
 * need the identical rule — scripts/lib/city-csv.ts for the capture and
 * src/lib/locations.ts for the dashboard write path. Two copies of a regex is
 * the drift src/lib/ats-hosts.ts was created to end.
 */
export function isRegionLocation(v: string): boolean {
  return /^אזור\s/.test(v) || v === "פריסה ארצית";
}
