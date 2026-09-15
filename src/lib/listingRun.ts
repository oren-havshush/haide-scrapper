// Which scrape run a site's listings belong to.
//
// The dashboard used "the latest run" for a site, which is right only while the
// latest run owns the rows. It stops being right whenever a newer run wrote
// nothing, and a scheduled run now often writes nothing on purpose:
//
//   - silent drift (empty_results / structure_changed) keeps the listings;
//   - a failure on the scheduled path keeps them (scheduledRun.ts);
//   - the undersize guard refuses a drop and keeps them;
//   - 2026-09-15: maccabi4u's 433 listings were restored under their original
//     run, with the empty 01:36 run still the newest.
//
// Each of those showed the site with 0 listings — or the empty run's count —
// while the older listings were published. A scrape replaces every row for the
// site, so the run that owns rows is the one being shown, and the newest run
// that owns rows is the listing run.
//
// Only reads. The db is a parameter so listingRun.test.ts can exercise these
// exact queries without a database.

import type { PrismaClient } from "@/generated/prisma/client";

export type ListingRunDb = { scrapeRun: Pick<PrismaClient["scrapeRun"], "findFirst" | "findMany"> };

export type ListingRun = {
  id: string;
  siteId: string;
  /** The rows this run owns — the listings the site is showing. */
  listingCount: number;
  completedAt: Date | null;
  /** The run's warnings: they describe the rows being shown. */
  warnings: unknown;
};

/** The newest run for a site that owns at least one Job row, or null. */
export async function findListingRunId(db: ListingRunDb, siteId: string): Promise<string | null> {
  const run = await db.scrapeRun.findFirst({
    where: { siteId, jobs: { some: {} } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return run?.id ?? null;
}

/**
 * The listing run for each site. A site with no listings is absent from the map.
 *
 * Cheap despite reading every run that owns rows: a scrape deletes all of a
 * site's rows before writing its own, so normally one run per site owns any.
 */
export async function findListingRunsBySiteIds(
  db: ListingRunDb,
  siteIds: string[],
): Promise<Map<string, ListingRun>> {
  const map = new Map<string, ListingRun>();
  if (siteIds.length === 0) return map;

  const runs = await db.scrapeRun.findMany({
    where: { siteId: { in: siteIds }, jobs: { some: {} } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      siteId: true,
      completedAt: true,
      warnings: true,
      _count: { select: { jobs: true } },
    },
  });

  for (const run of runs) {
    if (map.has(run.siteId)) continue; // newest first; the first one wins
    map.set(run.siteId, {
      id: run.id,
      siteId: run.siteId,
      listingCount: run._count.jobs,
      completedAt: run.completedAt,
      warnings: run.warnings,
    });
  }
  return map;
}
