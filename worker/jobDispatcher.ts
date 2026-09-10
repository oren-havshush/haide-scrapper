import { prisma } from "../src/lib/prisma";
import type { WorkerJob } from "../src/generated/prisma/client";
import { Prisma } from "../src/generated/prisma/client";
import { handleAnalysisJob } from "./jobs/analyze";
import { handleScrapeJob } from "./jobs/scrape";
import { handlePolicyReviewJob } from "./jobs/policyReview";
import { emitWorkerEvent } from "./lib/emitEvent";
import { planFailureCleanup, readScrapeRunId } from "./lib/failureCleanup";

export async function processJob(job: WorkerJob) {
  console.info(`[worker] Processing job ${job.id} (type: ${job.type}, site: ${job.siteId})`);

  // Update job to IN_PROGRESS
  await prisma.workerJob.update({
    where: { id: job.id },
    data: {
      status: "IN_PROGRESS",
      startedAt: new Date(),
      attempts: { increment: 1 },
    },
  });

  // Fetch associated site
  const site = await prisma.site.findUnique({ where: { id: job.siteId } });
  if (!site) {
    await prisma.workerJob.update({
      where: { id: job.id },
      data: { status: "FAILED", error: `Site ${job.siteId} not found` },
    });
    console.error(`[worker] Site not found for job ${job.id}: ${job.siteId}`);
    return;
  }

  try {
    let result: Record<string, unknown>;

    switch (job.type) {
      case "ANALYSIS":
        result = await handleAnalysisJob(job, site);
        break;
      case "SCRAPE":
        result = await handleScrapeJob(job, site);
        break;
      case "POLICY_REVIEW":
        result = await handlePolicyReviewJob(job, site);
        break;
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }

    // Mark job as completed
    await prisma.workerJob.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        result: result as Prisma.InputJsonValue,
      },
    });

    console.info(`[worker] Job ${job.id} completed successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Mark job as failed
    await prisma.workerJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        error: errorMessage,
      },
    });

    // This catch used to delete every Job row for the site and set it FAILED.
    // Exceptions reach here from paths that decided nothing — the config
    // parsers run before handleScrapeJob's own try, and its catch block makes
    // unguarded DB calls — so a transient DB blip emptied a site. See
    // worker/lib/failureCleanup.ts for the rule that replaced it.

    // `site` above is a snapshot taken before the handler ran, and the handler
    // may have moved the site itself (failScrapeRun, the activation gate).
    // Re-read so the rescue keys off the status that is actually there now.
    const current = await prisma.site.findUnique({
      where: { id: job.siteId },
      select: { status: true },
    });

    const scrapeRunId = readScrapeRunId(job.payload);
    const cleanup = planFailureCleanup({
      siteStatus: current?.status,
      scrapeRunId,
    });

    // An escaped exception leaves the ScrapeRun IN_PROGRESS, and createScrapeRun
    // then refuses the site with a ConflictError until a reaper pass — which is
    // at worker boot or the next nightly, so potentially a day of being
    // unscrapeable by hand. Close it here, since the link is right there.
    //
    // updateMany with the status in the WHERE clause is deliberate: if the
    // handler already completed the run and threw afterwards, that COMPLETED run
    // must not be relabelled FAILED.
    if (cleanup.closeScrapeRun && scrapeRunId) {
      await prisma.scrapeRun.updateMany({
        where: { id: scrapeRunId, status: "IN_PROGRESS" },
        data: {
          status: "FAILED",
          error: errorMessage,
          failureCategory: "other",
          completedAt: new Date(),
        },
      });
    }

    // ANALYZING is the only status this may change, and it deletes nothing.
    // Written directly rather than through updateSiteStatus, which deletes every
    // Job row on a FAILED transition — the exact wipe being removed here.
    if (cleanup.rescueSite) {
      await prisma.site.update({
        where: { id: job.siteId },
        data: {
          status: "FAILED",
          failedAt: new Date(),
        },
      });
    }

    // Only announce a status change that actually happened.
    if (cleanup.emitStatusChange) {
      await emitWorkerEvent({
        type: "site:status-changed",
        payload: { siteId: job.siteId, status: "FAILED" },
      });
    }

    console.error(`[worker] Job ${job.id} failed:`, { siteId: job.siteId, error: errorMessage });
  }
}
