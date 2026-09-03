/**
 * scripts/lib/city-csv.ts
 *
 * The single reader for "CSV files/city.csv" — the product's canonical city
 * list. Extracted from scripts/verify-location-csv.ts so the location gate and
 * the company-profile capture can never drift onto two different parsers.
 *
 * city.csv is a real RFC4180 CSV: it carries a `city` header and quotes any
 * value containing a gershayim — `"ביל""ו"` is the single value `ביל"ו`. A
 * naive split(",") both admits the header as a legal city and mangles the 18
 * real places whose names contain a quote (נתב"ג, בני עי"ש, ביל"ו …).
 *
 * The rule this file exists to enforce: a stored city is VERBATIM from this
 * list or it is NULL. Never a near-miss, never a normalized variant. See
 * docs/addsite-learnings.md LRN-LOC-4 — the worker gazetteer is NOT this list
 * (29 spellings diverge), and nothing downstream repairs a wrong value.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { LOCATION_EN, normalizeLocations } from "../../worker/lib/locationNormalize";

export const CITY_CSV_PATH = path.join("CSV files", "city.csv");

/**
 * Comparison form only. NEVER store the output of this — it is the key used to
 * look a value up, while the value written to the database is the untouched
 * CSV spelling returned alongside it.
 */
export function normalizeCity(value: string): string {
  return value
    .normalize("NFC")
    .trim()
    .replace(/״/g, '"')
    .replace(/׳/g, "'")
    .replace(/\s+/g, " ");
}

/** Parse one RFC4180 line into cells, honouring quotes and "" escapes. */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

export interface CityList {
  /** normalized form -> the verbatim CSV spelling to store. */
  byNormalized: Map<string, string>;
  /** Verbatim spellings, longest first — the scan order for matchCity(). */
  sortedVerbatim: string[];
}

export function parseCityCsv(raw: string): CityList {
  const byNormalized = new Map<string, string>();
  for (const line of raw.replace(/^\ufeff/, "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    for (const cell of parseCsvLine(line)) {
      const verbatim = cell.trim();
      const key = normalizeCity(cell);
      if (!key || key === "city") continue; // drop the header row
      if (!byNormalized.has(key)) byNormalized.set(key, verbatim);
    }
  }
  const sortedVerbatim = [...byNormalized.values()].sort(
    (a, b) => b.length - a.length || a.localeCompare(b),
  );
  return { byNormalized, sortedVerbatim };
}

export function loadCityList(csvPath: string = CITY_CSV_PATH): CityList {
  return parseCityCsv(readFileSync(csvPath, "utf8"));
}

/** True when `value` is an exact city.csv entry. */
export function isKnownCity(value: string, cities: CityList): boolean {
  return cities.byNormalized.has(normalizeCity(value));
}

/** The verbatim CSV spelling for `value`, or null when it is not on the list. */
export function canonicalCity(value: string, cities: CityList): string | null {
  return cities.byNormalized.get(normalizeCity(value)) ?? null;
}

/**
 * Address nouns, stripped from the head of a segment.
 *
 * They exist because city.csv genuinely contains places whose names are
 * ordinary address words — "רחוב" is a real moshav in the Beit She'an valley
 * and "אלון" a real settlement — so raw matching invents a city out of
 * "רחוב הרצל 12" every single time.
 *
 * Building nouns were once handled by DROPPING the whole segment, on the
 * reasoning that a building name is never a city. That was wrong in the other
 * direction: "בית עוז ר״ג" is a building name followed by Ramat Gan, and
 * discarding it left that address with no city at all. Both kinds are now
 * stripped, and the last-place-wins rule in matchCityInAddress() is what keeps
 * the building NAME from being read as the city.
 */
const STREET_NOUN = /^(רחוב|רח['׳]?|שדרות|שד['׳]?|דרך|שביל|סמטת|סמטה|כיכר|ככר)\s+/;
const BUILDING_NOUN = /^(מגדלי?|בניין|בנין|בית|קומה|קומת|אזור התעשייה|אזה"ת)\s+/;

/** Strip postal code, house number, PO-box noise and a trailing country name. */
function cleanAddressSegment(segment: string): string | null {
  let s = segment.trim();
  s = s.replace(/\b\d{5,9}\b/g, " "); // postal code
  s = s.replace(/(ישראל|israel)\.?/gi, " "); // country
  s = s.replace(/^\s*ת\.?\s*ד\.?\s*/, " "); // PO box marker
  s = s.replace(/\s+/g, " ").trim();

  // Both noun kinds are STRIPPED, not dropped. Dropping a building segment
  // outright looked safer and silently lost real cities: "בית עוז ר\"ג" is a
  // building name followed by Ramat Gan, and discarding it left that address
  // with no city at all. Stripping the noun keeps whatever follows, and the
  // last-place-wins rule below is what stops the building NAME from being read
  // as the city.
  s = s.replace(STREET_NOUN, "").trim();
  s = s.replace(BUILDING_NOUN, "").trim();
  s = s.replace(/[\s,.-]*\d+[\s,.-]*$/, "").trim(); // trailing house number
  return s;
}

/**
 * Pull the city out of a free-text address line, or return null.
 *
 * Segments are tried LAST-first because an Israeli address puts the city at the
 * end ("דרך מנחם בגין 132, תל אביב"), so the tail is the segment most likely to
 * BE a city while the head is most likely a street that merely CONTAINS a place
 * name.
 *
 * Each candidate goes through the worker's normalizeLocations() cascade —
 * exact -> alias/abbreviation -> English -> hyphen variant -> typo -> scan,
 * which is where "תל אביב" becomes the CSV's "תל אביב-יפו" — and is then GATED
 * through city.csv. The gate is the whole point: normalizeLocations() never
 * returns null (it falls back to the raw string so no data is lost), and its
 * gazetteer is not identical to city.csv (LRN-LOC-4 — 29 spellings diverge).
 * Whatever the gate rejects becomes NULL, never an off-list value.
 *
 * The hyphen-flattened variant is tried alongside each segment because the
 * alias table is keyed on the spaced spelling: "תל-אביב" only reaches
 * "תל אביב-יפו" via "תל אביב".
 */
/** True when `a` and `b` differ by at most one insert, delete or substitution. */
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a === b) return true;

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    // On equal lengths this is a substitution, so advance both; otherwise it is
    // an insertion in the longer string, so advance only that one.
    if (shorter.length === longer.length) i++;
    j++;
  }
  return edits + (longer.length - j) + (shorter.length - i) <= 1;
}

/**
 * Latin-script near-match against the English city table.
 *
 * The worker's cascade handles English names by exact key and by substring, so
 * a transliteration that is merely SPELLED slightly differently falls straight
 * through — "Herzlia" never reaches "herzliya", because it is shorter than the
 * key rather than containing it. Israeli sites transliterate inconsistently
 * enough ("Herzlia"/"Herzeliya", "Raanana"/"Ra'anana") that one edit of slack
 * is the difference between a city and a NULL.
 *
 * One edit only, and a four-character floor, so this cannot turn a short word
 * into an unrelated city. The result still goes through the city.csv gate.
 */
function cityFromLatinNearMatch(segment: string): string | null {
  const probe = segment
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (probe.length < 4 || !/^[a-z]/.test(probe)) return null;

  for (const [english, hebrew] of Object.entries(LOCATION_EN)) {
    if (english.length < 4) continue;
    if (withinOneEdit(probe, english)) return hebrew;
  }
  return null;
}

/**
 * Regions and nationwide markers are legal city.csv entries — the location gate
 * accepts them for a JOB, which can genuinely be "אזור מרכז". A company HQ is a
 * place, not a region, so they are refused for companyHqCity.
 *
 * Without this, a street called "רחוב השפלה" resolved through the alias table to
 * "אזור שפלה" and became the HQ region of a Tel Aviv company.
 */
function isRegion(city: string): boolean {
  return /^אזור\s/.test(city) || city === "פריסה ארצית";
}

export function matchCityInAddress(address: string, cities: CityList): string | null {
  if (!address || !address.trim()) return null;

  const segments = address
    .split(/[,|;\n•]|\s{2,}/)
    .map((s) => cleanAddressSegment(s))
    .filter((s): s is string => s !== null && s.length >= 2 && /\p{L}/u.test(s));

  for (let i = segments.length - 1; i >= 0; i--) {
    const variants = [segments[i]];
    const flattened = segments[i].replace(/-/g, " ").replace(/\s+/g, " ").trim();
    if (flattened !== segments[i]) variants.push(flattened);

    for (const variant of variants) {
      // LAST match wins, not the first. normalizeLocations() returns places in
      // order of appearance, and an Israeli address ends with the city — so the
      // EARLIER hits are street names that happen to contain a place name.
      // "רחוב יגאל אלון 53 תל אביב" yields ["רחוב", "אלון", "תל אביב-יפו"] and
      // taking the first stored Alon, a real moshav, as the HQ city of a
      // Tel Aviv company. "רחוב השפלה 3 תל אביב" failed the same way.
      const gated = normalizeLocations(variant)
        .map((candidate) => canonicalCity(candidate, cities))
        .filter((c): c is string => c !== null && !isRegion(c));
      if (gated.length > 0) return gated[gated.length - 1];

      const nearMatch = cityFromLatinNearMatch(variant);
      if (nearMatch) {
        const canonical = canonicalCity(nearMatch, cities);
        if (canonical && !isRegion(canonical)) return canonical;
      }
    }
  }
  return null;
}
