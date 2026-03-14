import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { processJob } from "./jobDispatcher";

let isShuttingDown = false;
let isProcessing = false;

const POLL_INTERVAL_MS = 5000;

async function recoverInterruptedJobs() {
  const interrupted = await prisma.workerJob.findMany({
    where: { status: "IN_PROGRESS" },
    include: { site: true },
  });

  if (interrupted.length === 0) return;

  for (const job of interrupted) {
    await prisma.workerJob.update({
      where: { id: job.id },
      data: { status: "FAILED", error: "Worker interrupted" },
    });

    await prisma.site.update({
      where: { id: job.siteId },
      data: { status: "FAILED", failedAt: new Date() },
    });
  }

  console.info(`[worker] Recovered ${interrupted.length} interrupted job(s)`);
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
