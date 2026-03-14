import { prisma } from "../src/lib/prisma";
import type { WorkerJob } from "../src/generated/prisma/client";
import { Prisma } from "../src/generated/prisma/client";
import { handleAnalysisJob } from "./jobs/analyze";
import { handleScrapeJob } from "./jobs/scrape";
import { emitWorkerEvent } from "./lib/emitEvent";

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

    // Update site to FAILED
    await prisma.site.update({
      where: { id: job.siteId },
      data: {
        status: "FAILED",
        failedAt: new Date(),
      },
    });

    // Emit SSE event for site status change to FAILED
    await emitWorkerEvent({
      type: "site:status-changed",
      payload: { siteId: job.siteId, status: "FAILED" },
    });

    console.error(`[worker] Job ${job.id} failed:`, { siteId: job.siteId, error: errorMessage });
  }
}
