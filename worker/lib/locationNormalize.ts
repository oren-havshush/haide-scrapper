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
 *   - NEVER blanks a value. If nothing matches, the raw string is returned as-is
 *     so no information is lost. "Unknown" stays reserved for jobs that printed
 *     no location at all.
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
  "אזור גוש דן": "אזור מרכז", "אזור תל אביב": "תל אביב-יפו",
  צפון: "אזור צפון", הצפון: "אזור צפון", "אזור הצפון": "אזור צפון",
  דרום: "אזור דרום", הדרום: "אזור דרום", "אזור הדרום": "אזור דרום", הנגב: "אזור דרום",
  שפלה: "אזור שפלה", השפלה: "אזור שפלה", "אזור השפלה": "אזור שפלה",
  שרון: "אזור השרון", השרון: "אזור השרון",
  "ירושלים והסביבה": "אזור ירושלים", 'ירושלים יו"ש': "אזור ירושלים",
  'ירושלים ויו"ש': "אזור ירושלים",
  "אילת והערבה": "אזור אילת", "אילת והסביבה": "אזור אילת",
  "כל הארץ": "פריסה ארצית", ארצי: "פריסה ארצית", "כלל הארץ": "פריסה ארצית",
  "חיפה והקריות": "חיפה", "חיפה וקריות": "חיפה",
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

/** Genuinely-abroad postings — not Israeli cities, and not a data defect. */
const ABROAD =
  /^(new york|singapore|canada|uk|united kingdom|usa|us|apac|emea|europe|germany|france|india|china|japan|australia|poland|romania|brazil|mexico|spain|italy|netherlands|belgium|remote)$/i;

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
  for (const c of BY_LEN) if (c.length >= 3) candidates.push([c, c]);
  for (const [k, v] of Object.entries(LOCATION_ALIAS)) if (k.length >= 3) candidates.push([k, v]);
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

function resolvePart(part: string): string | null {
  const p = squash(part);
  if (!p) return null;
  if (CANONICAL.has(p)) return p;
  if (LOCATION_ALIAS[p]) return LOCATION_ALIAS[p];

  const lower = p.toLowerCase().replace(/,?\s*(israel|il)\.?$/i, "").trim();
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

  if (p.length >= 5) for (const c of BY_LEN) if (c.length >= 5 && levenshtein1(p, c)) return c;
  return null;
}

/**
 * Normalise a raw location into canonical values.
 * Returns [] only when the input is empty/"Unknown"; otherwise always non-empty
 * (falling back to the raw string), so a value is never silently destroyed.
 */
export function normalizeLocations(raw: string | null | undefined): string[] {
  const original = (raw ?? "").trim();
  if (!original || original === "Unknown") return [];
  if (CANONICAL.has(original)) return [original];

  const s = squash(original).replace(LABEL, "").trim();
  if (!s) return [original];
  if (ABROAD.test(s)) return [s];

  const out: string[] = [];
  for (const part of s.split(/\s*[,|/;]\s*/).map((x) => x.trim()).filter(Boolean)) {
    const direct = resolvePart(part);
    if (direct) {
      if (!out.includes(direct)) out.push(direct);
      continue;
    }
    for (const v of scanPlaces(part)) if (!out.includes(v)) out.push(v);
  }
  return out.length ? out : [original];
}

/** True when every value belongs to the canonical vocabulary. */
export function isCanonicalLocation(v: string): boolean {
  return CANONICAL.has(v);
}
