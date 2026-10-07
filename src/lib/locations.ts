/**
 * Location vocabulary for the dashboard write path.
 *
 * The approved rule (2026-08-09): a job may carry several locations, on the
 * condition that EVERY city is a verbatim entry in "CSV files/city.csv".
 *
 * Why this validates against `IL_CANONICAL` and not against the CSV itself:
 * next.config sets `output: "standalone"`, and the runner image copies only
 * `.next/standalone`, `.next/static` and `public` — "CSV files/city.csv" is NOT
 * in the deployed image, so an fs read here would ENOENT in production and take
 * location editing down with it. `IL_CANONICAL` is a bundled TS module, and
 * `src/lib/locations.test.ts` asserts the two lists are still identical, so the
 * CSV stays the source of truth without being read at request time.
 */
import { ValidationError } from "./errors";
import {
  normalizeLocations,
  isCanonicalLocation,
  isRegionLocation,
  CITY_ABBREVIATIONS,
} from "../../worker/lib/locationNormalize";

// isRegionLocation is re-exported for the company-HQ write path, which accepts a
// narrower vocabulary than a job does: a job may legitimately be "אזור מרכז",
// a headquarters may not. Defined in the worker module so the capture script and
// this server share one definition rather than two copies of a regex.
export { normalizeLocations, isCanonicalLocation, isRegionLocation };

/** Sentinel for a job that states no location at all. */
export const UNKNOWN_LOCATION = "Unknown";

export interface ResolvedLocation {
  /** Mirrors Job.location — always `list[0]`, or the Unknown sentinel. */
  primary: string;
  /** Mirrors Job.locations[] — empty only for the Unknown sentinel. */
  list: string[];
}

/**
 * Turn a raw dashboard edit into the pair stored on the Job row.
 *
 * Accepts several places comma-separated, canonicalises each one (so the alias
 * spellings an operator actually types — `ת"א`, `תל אביב`, `מרכז` — become the
 * canonical value), de-duplicates, and rejects anything that does not land in
 * the approved vocabulary. Rejecting is the point: a wrong-but-non-empty
 * location is never auto-repaired later — the gazetteer and `locationFallback`
 * only fill an EMPTY location (LRN-LOC-1).
 */
export function resolveLocationInput(raw: string): ResolvedLocation {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) throw new ValidationError("Location must not be empty.");

  // Explicitly clearing a location back to the sentinel.
  if (trimmed === UNKNOWN_LOCATION) {
    return { primary: UNKNOWN_LOCATION, list: [] };
  }

  const list: string[] = [];
  const rejected: string[] = [];

  for (const part of trimmed.split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean)) {
    const resolved = normalizeLocations(part);
    // normalizeLocations drops whatever it cannot place, so a bad token comes
    // back as an EMPTY list — that is the case this gate has to catch. The
    // canonical re-check is kept as a belt-and-braces assertion on a contract
    // this file does not own.
    if (resolved.length === 0 || resolved.some((v) => !isCanonicalLocation(v))) {
      rejected.push(part);
      continue;
    }
    for (const v of resolved) if (!list.includes(v)) list.push(v);
  }

  if (rejected.length > 0) {
    throw new ValidationError(
      `Not a known location: ${rejected.map((r) => `"${r}"`).join(", ")}. ` +
        `Every city must be an entry in "CSV files/city.csv" — check the spelling, ` +
        `or use "${UNKNOWN_LOCATION}" to clear the location.`,
    );
  }
  if (list.length === 0) throw new ValidationError("Location must not be empty.");

  return { primary: list[0], list };
}

// Built from code points: a literal escape here would be decoded by the editor
// into the raw character (CLAUDE.md, "Every path that writes a file...").
// gershayim, right and left double quotation marks
const HQ_QUOTES = new RegExp(`[${String.fromCharCode(0x05f4, 0x201d, 0x201c)}]`, "g");
// geresh, right and left single quotation marks
const HQ_APOSTROPHES = new RegExp(`[${String.fromCharCode(0x05f3, 0x2019, 0x2018)}]`, "g");
// left-to-right mark, right-to-left mark, no-break space
const HQ_INVISIBLE = new RegExp(`[${String.fromCharCode(0x200e, 0x200f, 0x00a0)}]`, "g");

/**
 * The company HQ-city gate: the one write path where a person types a city
 * (saveCompanyHqCity, and the dashboard form through it). null (or blank)
 * clears.
 *
 * EXACT, owner 2026-10-07. A value is accepted only when it is an entry of
 * "CSV files/city.csv" or one of the CITY_ABBREVIATIONS keys (stored as its
 * full entry). Before 2026-10-07 this ran normalizeLocations(), the scraper's
 * alias, English and fuzzy matcher, which stored a typed "תקווה" as תקומה — a
 * different town. That matcher is right for scraped job text and is not
 * touched; it is simply not used here.
 *
 * The one thing normalised before the comparison is how quote marks are typed:
 * gershayim and curly quotes become ", geresh and curly apostrophes become ',
 * two apostrophes count as a quote mark, and invisible direction marks and
 * no-break spaces go. So ביל״ו is the entry ביל"ו and פ''ת is פ"ת. No letter,
 * dash or space inside the name changes, so it cannot turn one place into
 * another — and an entry like "בית אריה - עופרים" stays exactly itself, which
 * squash() would not leave it.
 */
export function resolveHqCity(city: string | null): string | null {
  const raw = city?.trim() || null;
  if (raw === null) return null;

  const typed = raw
    .replace(HQ_QUOTES, '"')
    .replace(HQ_APOSTROPHES, "'")
    .replace(/''/g, '"')
    .replace(HQ_INVISIBLE, "")
    .trim();
  const entry = Object.prototype.hasOwnProperty.call(CITY_ABBREVIATIONS, typed)
    ? CITY_ABBREVIATIONS[typed]
    : typed;

  if (!isCanonicalLocation(entry)) {
    throw new ValidationError(
      `Not a known city: "${raw}". A company HQ city must be exactly an entry ` +
        `of "CSV files/city.csv" (or a listed abbreviation such as ת"א) — ` +
        `pick the city from the list.`,
    );
  }
  if (isRegionLocation(entry)) {
    throw new ValidationError(
      `"${entry}" is a region, not a place. A job may be in a region; a ` +
        `company headquarters is at an address.`,
    );
  }
  return entry;
}
