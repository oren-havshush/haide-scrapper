/**
 * Last-resort `externalJobId` synthesis.
 *
 * `addsite2.md` §6.2 already prescribes a hash fallback when a site exposes no
 * native job id ("Hash of title+department+location (stable, disambiguated)",
 * see also LRN-ID-1 / LRN-ID-2), but that rule is only ever executed by a
 * per-site `setupScript` an onboarder has to remember to write. The worker
 * itself has never had a fallback: `scrape.ts` persists
 * `normalized.externalJobId || null`, so a site onboarded without the rule
 * stores NULL on every row.
 *
 * That is not a cosmetic gap. `decideActivationStatus` re-runs after EVERY
 * scrape and requires `externalJobId` fill >= 0.9, so such a site scrapes
 * perfectly well and is then demoted ACTIVE -> REVIEW the next time anything
 * rescrapes it. Three ACTIVE sites are in that state today; a scheduled
 * rescrape would demote all three unattended.
 *
 * This module closes the class centrally. It is deliberately narrow:
 *
 *   - It NEVER overwrites an extracted id. It is consulted only when
 *     extraction produced nothing for that job.
 *   - It hashes TITLE + DEPARTMENT + DETAIL URL and pointedly NOT location.
 *     LRN-ID-7 records a site whose ids churned because a later
 *     location-normalisation fix changed the hash input; location is
 *     canonicalised against "CSV files/city.csv" on every run, so it is exactly
 *     the wrong thing to key on.
 *   - It is index-free. Nothing about DOM order or array position enters the
 *     hash, so a reordered listing yields the same ids (addsite2.md:370).
 *   - The `h-` prefix marks the id as synthetic, keeps it clear of native
 *     numeric ids, and stops `verify-jobids` reading an all-integer id set as
 *     index-based.
 */

/**
 * djb2, xor variant — the same small pure hash the setupScript recipe uses
 * (`addsite2-recipes/setupscript-patterns.md` §3, `haideHash`). Kept identical
 * so an id synthesised here matches one a site-level script would produce for
 * the same input. Returns lowercase base-36: short, ASCII, filename-safe.
 */
export function haideHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h) ^ input.charCodeAt(i);
    h = h >>> 0; // keep it an unsigned 32-bit int
  }
  return h.toString(36);
}

/** The fields a synthesised id is derived from. */
export interface JobIdSeed {
  title?: string | null;
  department?: string | null;
  /** The job's detail URL, when the site has one. Never the listing URL. */
  url?: string | null;
}

/**
 * Build a stable synthetic id, or null when there is nothing stable to hash.
 *
 * Returning null matters: a job with no title and no URL has no content that
 * survives a rescrape, so inventing an id for it would fabricate a dedup key
 * that changes every run — worse than leaving the column empty.
 */
export function synthesizeExternalJobId(seed: JobIdSeed): string | null {
  const parts = [seed.title, seed.department, seed.url]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => p.length > 0);

  if (parts.length === 0) return null;
  // Title alone is too weak to key on when the site gives us nothing else:
  // two identical titles would collapse into one row on save.
  if (parts.length === 1 && !seed.title?.trim()) return null;

  return "h-" + haideHash(parts.join("|"));
}

/**
 * Fill in missing ids across a scrape's records.
 *
 * Returns the ids to persist alongside a report the caller can turn into a
 * `ScrapeRun` warning. Two conditions are worth surfacing:
 *
 *   - `synthesized > 0` — the site has no id mapping. It works, but it is
 *     leaning on a fallback, and a native id would be better.
 *   - `collisions > 0` — two jobs hashed identically, i.e. same title,
 *     department and URL. They will dedup into one row on save. That is the
 *     silent job-loss class from LRN-ID-8, and it is the one thing here that
 *     genuinely needs a human.
 */
export function applyJobIdFallback(
  records: Array<{ externalJobId?: string | null } & JobIdSeed>,
): { ids: Array<string | null>; synthesized: number; unresolved: number; collisions: number } {
  const ids: Array<string | null> = [];
  const seen = new Set<string>();
  let synthesized = 0;
  let unresolved = 0;
  let collisions = 0;

  for (const rec of records) {
    const extracted =
      typeof rec.externalJobId === "string" ? rec.externalJobId.trim() : "";
    if (extracted.length > 0) {
      ids.push(extracted);
      continue;
    }
    const built = synthesizeExternalJobId(rec);
    if (!built) {
      ids.push(null);
      unresolved++;
      continue;
    }
    if (seen.has(built)) collisions++;
    seen.add(built);
    ids.push(built);
    synthesized++;
  }

  return { ids, synthesized, unresolved, collisions };
}
