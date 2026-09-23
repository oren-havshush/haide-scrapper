/**
 * locationOverrides.ts — reading a site's manual location overrides back.
 *
 * An override is a human's assertion about one job, and `buildJobRows` puts it
 * above everything the scraper decides. It is keyed by
 * `externalJobId ?? detailUrl`, which on a site with no id mapping is a
 * synthesised `h-<hash>` seeded from the job's own fields — so the key can
 * move. halilit re-keyed 6 of its 7 jobs across one config change; sinaistore's
 * were byte-identical across three months. The difference is the config.
 *
 * When a key moves the override survives (it is keyed on siteId+jobKey, not on
 * the Job row) and matches nothing. That is not an error to swallow: it is a
 * standing instruction about a job, now detached from it, and someone has to
 * either re-apply it or delete it. All this does is make that legible.
 *
 * Pure, so it can be tested without a database.
 */

export type OverrideRow = {
  id: string;
  jobKey: string;
  location: string;
  locations: string[];
  /** The job's title when the override was set. NULL for rows predating the column. */
  jobTitle: string | null;
  updatedAt: Date;
};

export type MatchableJob = {
  id: string;
  title: string;
  externalJobId: string | null;
  detailUrl: string | null;
};

export type ResolvedOverride = {
  id: string;
  jobKey: string;
  location: string;
  locations: string[];
  updatedAt: Date;
  /** The live job this override applies to, or null. */
  jobId: string | null;
  matched: boolean;
  /** Two jobs claim this key, so it is deliberately left unmatched. */
  ambiguous: boolean;
  /** What to show: the job's CURRENT title when matched, else the stored one. */
  jobTitle: string | null;
  /** The title it was set against, kept beside the current one. */
  titleWhenSet: string | null;
  /** The job has been retitled since — which is how a hash key moves. */
  titleChanged: boolean;
};

/**
 * Pair each override with the job it applies to.
 *
 * Unmatched rows come first — they are the ones needing a decision — then the
 * most recently edited, which is what an operator was last doing.
 */
export function matchOverrides(
  overrides: readonly OverrideRow[],
  jobs: readonly MatchableJob[],
): ResolvedOverride[] {
  // Index by both identities, exactly as buildJobRows matches them. A key two
  // jobs claim is recorded as ambiguous rather than resolved: picking one would
  // attach a human's assertion to a job they may not have meant, and an
  // override outranks everything, so the wrong guess is published.
  const byKey = new Map<string, MatchableJob>();
  const ambiguous = new Set<string>();
  for (const j of jobs) {
    for (const key of [j.externalJobId, j.detailUrl]) {
      if (!key) continue;
      if (byKey.has(key) && byKey.get(key)!.id !== j.id) ambiguous.add(key);
      byKey.set(key, j);
    }
  }

  const rows = overrides.map((o): ResolvedOverride => {
    const isAmbiguous = ambiguous.has(o.jobKey);
    const job = isAmbiguous ? undefined : byKey.get(o.jobKey);
    return {
      id: o.id,
      jobKey: o.jobKey,
      location: o.location,
      locations: o.locations,
      updatedAt: o.updatedAt,
      jobId: job?.id ?? null,
      matched: !!job,
      ambiguous: isAmbiguous,
      jobTitle: job?.title ?? o.jobTitle,
      titleWhenSet: o.jobTitle,
      titleChanged: !!job && !!o.jobTitle && job.title !== o.jobTitle,
    };
  });

  return rows.sort((a, b) => {
    if (a.matched !== b.matched) return a.matched ? 1 : -1;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });
}
