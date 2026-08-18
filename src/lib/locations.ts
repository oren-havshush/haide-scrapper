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
} from "../../worker/lib/locationNormalize";

export { normalizeLocations, isCanonicalLocation };

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
    // normalizeLocations passes an unresolved string straight through
    // (`return out.length ? out : [original]`), so a bad token comes back
    // verbatim — that is exactly the case this gate has to catch.
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
