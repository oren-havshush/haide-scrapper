import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import {
  NO_JOB_GRACE_MS,
  SWEEP_IN_PROGRESS_GRACE_MS,
  shouldReapRun,
  type ReapOptions,
} from "@/lib/reapRule";

/** The owning WorkerJob, however it was found — by column or by payload. */
type OwnerRow = {
  id: string;
  scrapeRunId: string | null;
  status: string;
  startedAt: Date | null;
};

/**
 * Close ScrapeRuns whose owning WorkerJob is gone, and terminate the job with
 * them.
 *
 * Terminating the job is not tidiness (R7). A stale PENDING row left behind
 * would collide with the `worker_job_one_active_per_site_type` partial unique
 * index the moment anything queued a new job for that site, and
 * `createScrapeRun` would throw P2002 instead of the ConflictError it means to.
 * The run and its job are one fact; they are closed together.
 *
 * `opts.workerIsLive` has no default on purpose — see src/lib/reapRule.ts.
 */
export async function reapOrphanedScrapeRuns(opts: ReapOptions): Promise<{
  scanned: number;
  reaped: number;
  details: Array<{ scrapeRunId: string; siteId: string; reason: string }>;
}> {
  const now = Date.now();

  const candidates = await prisma.scrapeRun.findMany({
    where: { status: "IN_PROGRESS" },
    select: { id: true, siteId: true, createdAt: true },
  });

  if (candidates.length === 0) return { scanned: 0, reaped: 0, details: [] };

  const runIds = candidates.map((c) => c.id);

  // Fast path: the indexed column, written by buildScrapeJobRow and backfilled
  // by the sweep migration. It has no foreign key, so a row here can name a run
  // that no longer exists — that direction is harmless; we only look the other
  // way.
  const owners = await prisma.workerJob.findMany({
    where: { scrapeRunId: { in: runIds } },
    select: { id: true, scrapeRunId: true, status: true, startedAt: true },
  });
  const ownerByRun = new Map<string, OwnerRow>(
    owners.map((o) => [o.scrapeRunId as string, o]),
  );

  // Fallback: rows whose column is NULL but whose payload still names the run.
  //
  // The migration's backfill deliberately skipped payloads naming a deleted run
  // (59 of them on the box), and any row written by a path that forgets the
  // column would land here too. Matching them structurally — "the owning job is
  // already terminal" — is far better than letting them age out on the one-hour
  // backstop, which is the difference between a site being scrapeable again
  // tonight and tomorrow.
  //
  // Raw SQL because a JSON path cannot be combined with `IN (...)` through the
  // query builder. Scoped to the candidate runs, so it never scans the table.
  const unmatched = runIds.filter((id) => !ownerByRun.has(id));
  if (unmatched.length > 0) {
    const viaPayload = await prisma.$queryRaw<OwnerRow[]>`
      SELECT id,
             payload->>'scrapeRunId' AS "scrapeRunId",
             status::text            AS status,
             "startedAt"
      FROM "WorkerJob"
      WHERE "scrapeRunId" IS NULL
        AND payload->>'scrapeRunId' IN (${Prisma.join(unmatched)})
    `;
    for (const row of viaPayload) {
      if (row.scrapeRunId && !ownerByRun.has(row.scrapeRunId)) {
        ownerByRun.set(row.scrapeRunId, row);
      }
    }
  }

  const details: Array<{ scrapeRunId: string; siteId: string; reason: string }> = [];

  for (const run of candidates) {
    const owner = ownerByRun.get(run.id) ?? null;

    const verdict = shouldReapRun(
      {
        runAgeMs: now - run.createdAt.getTime(),
        jobStatus: owner?.status ?? null,
        jobInProgressForMs:
          owner?.status === "IN_PROGRESS" && owner.startedAt
            ? now - owner.startedAt.getTime()
            : null,
      },
      opts,
    );

    if (!verdict.reap) continue;

    // Scoped to IN_PROGRESS so a run that finished between the scan and now is
    // never relabelled — the same discipline as the dispatcher's close.
    const closed = await prisma.scrapeRun.updateMany({
      where: { id: run.id, status: "IN_PROGRESS" },
      data: {
        status: "FAILED",
        error: `Reaped: ${verdict.reason}`,
        failureCategory: "orphaned",
        completedAt: new Date(),
      },
    });

    if (closed.count === 0) continue; // it closed itself; leave the job alone

    if (owner && owner.status !== "COMPLETED" && owner.status !== "FAILED") {
      await prisma.workerJob.updateMany({
        where: { id: owner.id, status: { in: ["PENDING", "IN_PROGRESS"] } },
        data: {
          status: "FAILED",
          error: `Reaped: ${verdict.reason}`,
          completedAt: new Date(),
        },
      });
    }

    details.push({ scrapeRunId: run.id, siteId: run.siteId, reason: verdict.reason });
  }

  return { scanned: candidates.length, reaped: details.length, details };
}

/** At worker boot: nothing found IN_PROGRESS can still be running. */
export const BOOT_REAP_OPTIONS: ReapOptions = {
  workerIsLive: false,
  inProgressGraceMs: 0,
};

/** From the sweep pre-flight: the worker is up and may be mid-scrape. */
export const SWEEP_REAP_OPTIONS: ReapOptions = {
  workerIsLive: true,
  inProgressGraceMs: SWEEP_IN_PROGRESS_GRACE_MS,
};

export { NO_JOB_GRACE_MS, SWEEP_IN_PROGRESS_GRACE_MS };
