import { prisma } from "@/lib/prisma";

/**
 * Sweep history for the dashboard. READ ONLY — nothing here writes.
 *
 * The rendered report is read back from `ScrapeSweep.logText` rather than
 * re-rendered here. The driver rendered it once, from results it held in
 * memory, and some of what it knew (per-site defects) has no column to be read
 * back from. Re-rendering would quietly produce a shorter report than the one
 * in the journal, and the two would disagree about the same night.
 */
export async function getSweeps(opts: { limit?: number } = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);

  const sweeps = await prisma.scrapeSweep.findMany({
    orderBy: { startedAt: "desc" },
    take: limit,
    include: {
      items: {
        orderBy: { startedAt: "asc" },
      },
    },
  });

  // Item rows carry siteId, not siteUrl — the sweep log deliberately outlives
  // the sites it describes, so this is a lookup rather than a join, and a
  // deleted site shows its id rather than breaking the page.
  const siteIds = [...new Set(sweeps.flatMap((s) => s.items.map((i) => i.siteId)))];
  const sites = siteIds.length
    ? await prisma.site.findMany({
        where: { id: { in: siteIds } },
        select: { id: true, siteUrl: true },
      })
    : [];
  const urlById = new Map(sites.map((s) => [s.id, s.siteUrl]));

  return {
    data: sweeps.map((s) => ({
      id: s.id,
      kind: s.kind,
      status: s.status,
      trigger: s.trigger,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
      haltedAt: s.haltedAt,
      haltReason: s.haltReason,
      selectedCount: s.selectedCount,
      ok: s.ok,
      failed: s.failed,
      silentDrift: s.silentDrift,
      skippedConflict: s.skippedConflict,
      wouldHaveDemoted: s.wouldHaveDemoted,
      wouldHavePromoted: s.wouldHavePromoted,
      listingsProtected: s.listingsProtected,
      /** The stored report. Its first line is the verdict line. */
      logText: s.logText,
      /** First line of logText, so a list can show it without parsing. */
      verdictLine: s.logText ? s.logText.split("\n")[0] : null,
      items: s.items.map((i) => ({
        siteId: i.siteId,
        siteUrl: urlById.get(i.siteId) ?? `(deleted site ${i.siteId})`,
        phase: i.phase,
        outcome: i.outcome,
        failureCategory: i.failureCategory,
        jobsBefore: i.jobsBefore,
        jobsAfter: i.jobsAfter,
        newestJobAt: i.newestJobAt,
        siteStatus: i.siteStatus,
        wouldDemoteTo: i.wouldDemoteTo,
        wouldPromoteTo: i.wouldPromoteTo,
        scrapeRunId: i.scrapeRunId,
      })),
    })),
    meta: { total: sweeps.length, limit },
  };
}
