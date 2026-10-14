// The body of the one persistence transaction (scrape.ts, R1): delete the
// site's listings, insert every row in batches, close the run COMPLETED. Run
// inside prisma.$transaction, so a throw anywhere rolls all of it back and the
// previous listings stay exactly as they were. Manual and scheduled runs alike
// since H1 (owner, 2026-10-14): a manual run used to delete first and then save
// in chunks of 20 outside one transaction, so a timeout or an error mid-save
// left a half-emptied company page.

import { INSERT_BATCH, chunkRows } from "./scheduledRun";

/** What the transaction body needs of Prisma's transaction client. */
export type ListingsTx<R> = {
  job: {
    deleteMany(args: { where: { siteId: string } }): Promise<unknown>;
    createMany(args: { data: R[] }): Promise<unknown>;
  };
  scrapeRun: {
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
};

export async function replaceListingsInTx<R>(
  tx: ListingsTx<R>,
  args: { siteId: string; scrapeRunId: string; rows: R[]; totalJobs: number; invalidJobs: number; now?: Date },
): Promise<void> {
  await tx.job.deleteMany({ where: { siteId: args.siteId } });
  for (const batch of chunkRows(args.rows, INSERT_BATCH)) {
    await tx.job.createMany({ data: batch });
  }
  await tx.scrapeRun.update({
    where: { id: args.scrapeRunId },
    data: {
      // COMPLETED or nothing. PARTIAL is not reachable here, which is the
      // trade this path makes: atomicity over per-chunk progress.
      status: "COMPLETED",
      jobCount: args.rows.length,
      totalJobs: args.totalJobs,
      validJobs: args.rows.length,
      invalidJobs: args.invalidJobs,
      completedAt: args.now ?? new Date(),
    },
  });
}
