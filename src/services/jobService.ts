import { prisma } from "@/lib/prisma";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { resolveLocationInput } from "@/lib/locations";

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

  // A manual edit may name several places, comma-separated. Canonicalise each
  // one and reject anything outside the approved city vocabulary, then store the
  // full list alongside the primary value so the next scrape doesn't collapse it.
  // Previously this only split on commas: an alias an operator typed (`ת"א`) was
  // stored raw, i.e. a value absent from city.csv, which nothing repairs later.
  const { primary, list } = resolveLocationInput(location);

  await prisma.$transaction([
    prisma.jobLocationOverride.upsert({
      where: { siteId_jobKey: { siteId: job.siteId, jobKey } },
      create: { siteId: job.siteId, jobKey, location: primary, locations: list },
      update: { location: primary, locations: list },
    }),
    prisma.job.update({
      where: { id: jobId },
      data: { location: primary, locations: list },
    }),
  ]);

  return prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      title: true,
      location: true,
      locations: true,
      externalJobId: true,
      detailUrl: true,
      siteId: true,
    },
  });
}
