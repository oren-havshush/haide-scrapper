/**
 * jobLocation.ts — which place a stored Job row ends up carrying.
 *
 * Lifted out of `buildJobRows` (worker/jobs/scrape.ts) for the reason
 * listingTargets.ts and scheduledRun.ts were: the decision is pure, the thing
 * it decides is published data, and nothing that needs Playwright and Prisma to
 * run can be tested. The caller still owns reading the overrides and the
 * previous rows; this owns the precedence.
 *
 * Persistence is delete-all-then-insert, so every scrape re-decides this for
 * every job from scratch. That is what makes the carry-forward rule necessary
 * rather than merely nice: a site whose listing page stops printing a city for
 * one job does not thereby move that job to the company HQ — it keeps the place
 * it published yesterday, which the employer did state, in preference to a
 * site-wide default nobody stated for it.
 */

import { isCanonicalLocation, normalizeLocations } from "./locationNormalize";

/** What the site published for this job before this scrape. */
export type PreviousLocation = {
  location: string;
  locations: readonly string[];
  /** The previous row's firstSeenAt, carried by buildJobRows (worker/lib/firstSeen.ts). */
  firstSeenAt?: Date | null;
};

export type JobLocationInput = {
  /** Manual dashboard override, primary value; null when none is set. */
  overrideLocation: string | null;
  /** Manual dashboard override, full list; null/empty when none is set. */
  overrideLocations: readonly string[] | null;
  /**
   * What THIS scrape extracted, already trimmed. `null` means the scrape found
   * nothing at all — note that a config deliberately injecting the string
   * "Unknown" is NOT nothing (LRN-LOC-7): it is the config asserting that this
   * job states no place, and it still suppresses everything below it.
   */
  extracted: string | null;
  /** The row this job had before the delete/re-create; null for a new job. */
  previous: PreviousLocation | null;
  /** Site-level default from `_meta.locationFallback` (typically the HQ). */
  fallback: string | null;
};

export type JobLocationSource = "override" | "extracted" | "previous" | "fallback" | "unknown";

export type JobLocationResult = {
  /** The single primary value; the public jobs site reads this column directly. */
  location: string;
  /** The full list. Empty only for "Unknown". */
  locations: string[];
  /** Which rule produced it. Reported, never stored. */
  source: JobLocationSource;
  /** Stored override values that are not on city.csv and were skipped. */
  offListOverride?: string[];
};

/**
 * A previous row may be carried forward only if it is still clean.
 *
 * Deliberately all-or-nothing. Rows written before the city gate landed
 * (`590f187`) can hold values city.csv never contained, and a partly-canonical
 * list is exactly the shape that looks repaired and is not. "A wrong value is
 * worse than a missing one" — so a list with one bad entry carries nothing,
 * rather than carrying the good half and quietly changing the primary value.
 */
export function canCarryForward(previous: PreviousLocation | null): boolean {
  if (!previous) return false;
  const primary = previous.location?.trim();
  if (!primary || !isCanonicalLocation(primary)) return false;
  // "Unknown" is not on city.csv, so it fails above — asserted in the test
  // rather than special-cased here, so the two cannot drift apart.
  const list = previous.locations ?? [];
  if (list.length === 0) return true; // a bare canonical primary is enough
  if (!list.every((v) => typeof v === "string" && isCanonicalLocation(v))) return false;
  return list[0] === primary;
}

/**
 * Precedence:
 *   1. a manual dashboard override — a human said so, and nothing outranks that;
 *   2. what this scrape extracted;
 *   3. what the site published for this job before, when still verbatim on
 *      city.csv;
 *   4. the site-level fallback;
 *   5. "Unknown".
 *
 * Step 3 is the new one. It sits BELOW step 2 rather than above it so a genuine
 * relocation still lands, and ABOVE step 4 because the fallback is a statement
 * about the site, not about this job.
 */
export function resolveJobLocation(input: JobLocationInput): JobLocationResult {
  // The override is gated like everything else (owner, 2026-10-02): overrides
  // saved before the write-side check (2026-06) held values city.csv never
  // contained and were replayed verbatim every night. Each stored member goes
  // through normalizeLocations — the canonicaliser the write path
  // (resolveLocationInput) applies to each comma part — and only what lands
  // on city.csv is kept. When nothing survives, the job falls through to the
  // steps below and the dropped values are reported (override_off_list).
  const override = input.overrideLocation?.trim() || null;
  let offListOverride: string[] | undefined;
  if (override) {
    if (override === "Unknown") return { location: "Unknown", locations: [], source: "override" };
    const members = input.overrideLocations?.length ? [...input.overrideLocations] : [override];
    const list: string[] = [];
    const dropped: string[] = [];
    for (const m of members) {
      const resolved = normalizeLocations(m);
      if (resolved.length === 0) dropped.push(m);
      for (const v of resolved) if (!list.includes(v)) list.push(v);
    }
    if (list.length > 0) {
      return { location: list[0]!, locations: list, source: "override", ...(dropped.length > 0 ? { offListOverride: dropped } : {}) };
    }
    offListOverride = dropped;
  }
  const withDropped = (r: JobLocationResult): JobLocationResult => (offListOverride ? { ...r, offListOverride } : r);

  // The location COLUMN is what the public jobs site reads, so it is city-gated
  // like the list: when normalizeLocations rejects the string, the column is
  // "Unknown", never the raw string. It used to be `list[0] ?? extracted`, and
  // clalitsmile published "רחב" that way (2026-09-30).
  const extracted = input.extracted?.trim() || null;
  if (extracted) {
    const list = normalizeLocations(extracted);
    return withDropped({ location: list[0] ?? "Unknown", locations: list, source: "extracted" });
  }

  // What this site published for this job yesterday, when it is still a value
  // city.csv contains. Ahead of the fallback and behind everything else: the
  // employer stated this place for THIS job, and a site-wide default did not.
  if (canCarryForward(input.previous)) {
    const prev = input.previous!;
    const list = prev.locations.length > 0 ? [...prev.locations] : [prev.location];
    return withDropped({ location: list[0]!, locations: list, source: "previous" });
  }

  const fallback = input.fallback?.trim() || null;
  if (fallback) {
    const list = normalizeLocations(fallback);
    // Same gate as above; the fallback is also checked on save (validators.ts).
    return withDropped({ location: list[0] ?? "Unknown", locations: list, source: "fallback" });
  }

  return withDropped({ location: "Unknown", locations: [], source: "unknown" });
}

/** The run warning for a stored override the gate skipped, named per site in the night report. */
export function overrideOffListWarning(siteId: string, jobKey: string, raw: readonly string[]): string {
  const values = raw.map((v) => JSON.stringify(v)).join(", ");
  return `override_off_list: site ${siteId} job ${jobKey} — ${values} not on city.csv; the override value was skipped`;
}
