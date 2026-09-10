import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { processJob } from "./jobDispatcher";
import { planFailureCleanup, readScrapeRunId } from "./lib/failureCleanup";

let isShuttingDown = false;
let isProcessing = false;

const POLL_INTERVAL_MS = 5000;

// A worker restart is evidence about the worker, not about the site. This used
// to delete every Job row for whatever was in flight and set the site FAILED,
// which meant a deploy landing mid-scrape emptied that site. Same rule as the
// dispatcher's catch — see worker/lib/failureCleanup.ts.
async function recoverInterruptedJobs() {
  const interrupted = await prisma.workerJob.findMany({
    where: { status: "IN_PROGRESS" },
    include: { site: true },
  });

  if (interrupted.length === 0) return;

  let rescued = 0;
  for (const job of interrupted) {
    await prisma.workerJob.update({
      where: { id: job.id },
      data: { status: "FAILED", error: "Worker interrupted" },
    });

    const scrapeRunId = readScrapeRunId(job.payload);
    const cleanup = planFailureCleanup({
      siteStatus: job.site?.status,
      scrapeRunId,
    });

    // Close the run so the site is scrapeable again immediately, rather than
    // waiting for a reaper pass. Scoped to IN_PROGRESS so a run the handler
    // already finished is never relabelled.
    if (cleanup.closeScrapeRun && scrapeRunId) {
      await prisma.scrapeRun.updateMany({
        where: { id: scrapeRunId, status: "IN_PROGRESS" },
        data: {
          status: "FAILED",
          error: "Worker interrupted",
          failureCategory: "interrupted",
          completedAt: new Date(),
        },
      });
    }

    // Only ANALYZING moves, and nothing is deleted. Without this an interrupted
    // analysis would strand the site in ANALYZING across every later restart.
    if (cleanup.rescueSite) {
      await prisma.site.update({
        where: { id: job.siteId },
        data: { status: "FAILED", failedAt: new Date() },
      });
      rescued++;
    }
  }

  console.info(
    `[worker] Recovered ${interrupted.length} interrupted job(s)` +
      (rescued > 0 ? `, rescued ${rescued} site(s) stuck in ANALYZING` : "") +
      " — no listings deleted",
  );
}

async function pollForJobs() {
  if (isShuttingDown || isProcessing) return;

  try {
    // Find the oldest PENDING job (FIFO order)
    const job = await prisma.workerJob.findFirst({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
    });

    if (!job) return;

    isProcessing = true;
    await processJob(job);
  } catch (error) {
    console.error("[worker] Poll error:", error);
  } finally {
    isProcessing = false;
  }
}

async function main() {
  console.info("[worker] Starting worker process...");

  await recoverInterruptedJobs();

  const intervalId = setInterval(pollForJobs, POLL_INTERVAL_MS);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.info(`[worker] Received ${signal}. Shutting down gracefully...`);
    isShuttingDown = true;
    clearInterval(intervalId);

    // Wait for in-progress job to complete (max 30 seconds)
    const shutdownStart = Date.now();
    while (isProcessing && Date.now() - shutdownStart < 30_000) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (isProcessing) {
      console.warn("[worker] Timed out waiting for in-progress job. Forcing exit.");
    }

    console.info("[worker] Worker shut down cleanly.");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  console.info(`[worker] Polling for jobs every ${POLL_INTERVAL_MS / 1000}s...`);
}

main().catch((error) => {
  console.error("[worker] Fatal error:", error);
  process.exit(1);
});
