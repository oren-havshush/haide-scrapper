import { prisma } from "@/lib/prisma";
import { NotFoundError, ValidationError } from "@/lib/errors";

/**
 * Persist a manual location override for a job, keyed by (siteId, jobKey).
 * Also updates the current Job row immediately so the dashboard reflects the
 * change before the next scrape re-runs.
 *
 * jobKey = externalJobId ?? detailUrl. Both are stable across scrapes because
 * the site config drives extraction of externalJobId and detailUrl from the
 * same page element on every run.
 */
export async function updateJobLocation(jobId: string, location: string) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, siteId: true, externalJobId: true, detailUrl: true },
  });

  if (!job) {
    throw new NotFoundError("Job", jobId);
  }

  const jobKey = job.externalJobId ?? job.detailUrl;
  if (!jobKey) {
    throw new ValidationError(
      "Cannot save a location override for this job: it has neither an externalJobId nor a detailUrl to use as a stable key.",
    );
  }

  const trimmed = location.trim();

  await prisma.$transaction([
    prisma.jobLocationOverride.upsert({
      where: { siteId_jobKey: { siteId: job.siteId, jobKey } },
      create: { siteId: job.siteId, jobKey, location: trimmed },
      update: { location: trimmed },
    }),
    prisma.job.update({
      where: { id: jobId },
      data: { location: trimmed },
    }),
  ]);

  return prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      title: true,
      location: true,
      externalJobId: true,
      detailUrl: true,
      siteId: true,
    },
  });
}
