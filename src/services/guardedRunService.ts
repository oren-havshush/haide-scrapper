import { prisma } from "@/lib/prisma";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { planGuardedRunRequest } from "@/lib/guardedRun";

/**
 * Guarded single-site runs requested through the API (addsite2 phase two,
 * step 3, option B). This writes GuardedRunRequest rows and reads them back;
 * it queues nothing in the worker. The claim timer on the box runs them with
 * worker/sweep/nightly.ts --claim-request.
 */

/** A request for this site that has not finished: it blocks another. */
const OPEN_STATUSES = ["PENDING", "RUNNING"];

export async function requestGuardedRun(a: { siteId: string; operator: string | null; tokenHash: string | null; now: Date }) {
  return prisma.$transaction(async (tx) => {
    const site = await tx.site.findUnique({ where: { id: a.siteId }, select: { status: true } });
    const pending = (await tx.guardedRunRequest.count({ where: { siteId: a.siteId, status: { in: OPEN_STATUSES } } })) > 0;
    const activeSweep = (await tx.scrapeSweep.count({ where: { status: "RUNNING" } })) > 0;
    const gate = planGuardedRunRequest(site, activeSweep, pending, a.now);
    if (!gate.ok) {
      if (gate.code === "SITE_NOT_FOUND") throw new NotFoundError("Site", a.siteId);
      throw new ConflictError(`${gate.code}: ${gate.reason}`);
    }
    return tx.guardedRunRequest.create({
      data: { siteId: a.siteId, operator: a.operator, tokenHash: a.tokenHash, requestedAt: a.now },
    });
  });
}

/**
 * The site's latest requests, newest first, each with the sweep it ran and
 * that sweep's item for the site — outcome, wouldPromoteTo, warnings — which
 * is what the fix command reads to decide whether to offer promotion.
 */
export async function getGuardedRuns(siteId: string, limit = 5) {
  const rows = await prisma.guardedRunRequest.findMany({
    where: { siteId },
    orderBy: { requestedAt: "desc" },
    take: Math.min(Math.max(limit, 1), 20),
  });
  const sweepIds = rows.map((r) => r.sweepId).filter((s): s is string => !!s);
  const sweeps = sweepIds.length
    ? await prisma.scrapeSweep.findMany({
        where: { id: { in: sweepIds } },
        select: { id: true, status: true, trigger: true, startedAt: true, finishedAt: true, emailStatus: true, items: { where: { siteId } } },
      })
    : [];
  const byId = new Map(sweeps.map((s) => [s.id, s]));
  return rows.map((r) => {
    const sweep = r.sweepId ? byId.get(r.sweepId) : undefined;
    const item = sweep?.items.find((i) => i.phase === "scrape") ?? sweep?.items[0];
    return {
      id: r.id,
      siteId: r.siteId,
      status: r.status,
      operator: r.operator,
      requestedAt: r.requestedAt,
      claimedAt: r.claimedAt,
      finishedAt: r.finishedAt,
      result: r.result,
      sweep: sweep
        ? {
            id: sweep.id,
            status: sweep.status,
            trigger: sweep.trigger,
            startedAt: sweep.startedAt,
            finishedAt: sweep.finishedAt,
            emailStatus: sweep.emailStatus,
            item: item
              ? {
                  outcome: item.outcome,
                  failureCategory: item.failureCategory,
                  jobsBefore: item.jobsBefore,
                  jobsAfter: item.jobsAfter,
                  siteStatus: item.siteStatus,
                  wouldPromoteTo: item.wouldPromoteTo,
                  wouldDemoteTo: item.wouldDemoteTo,
                  warnings: Array.isArray(item.warnings) ? item.warnings.map((w) => String(w)) : [],
                  scrapeRunId: item.scrapeRunId,
                }
              : null,
          }
        : null,
    };
  });
}
