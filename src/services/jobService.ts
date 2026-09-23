import { prisma } from "@/lib/prisma";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { resolveLocationInput } from "@/lib/locations";
import { matchOverrides } from "@/lib/locationOverrides";

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
    select: { id: true, siteId: true, title: true, externalJobId: true, detailUrl: true },
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
    // The title is written on every save, create and update alike. jobKey can
    // stop matching when a config change re-seeds a synthesised id (halilit:
    // 6 of 7 jobs), and a row reading "site X, key h-1p1cu0x, חיפה" is one
    // nobody can re-apply or delete with confidence.
    prisma.jobLocationOverride.upsert({
      where: { siteId_jobKey: { siteId: job.siteId, jobKey } },
      create: {
        siteId: job.siteId,
        jobKey,
        location: primary,
        locations: list,
        jobTitle: job.title,
      },
      update: { location: primary, locations: list, jobTitle: job.title },
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

/**
 * A site's manual location overrides, paired with the jobs they apply to.
 *
 * Read-only, and its whole purpose is the rows that DON'T pair. An override is
 * keyed by `externalJobId ?? detailUrl`; on a site with no id mapping that is a
 * synthesised `h-<hash>` whose stability depends on the config that seeds it
 * (halilit re-keyed 6 of its 7 jobs across one config change). When the key
 * moves, the override survives — it is keyed on siteId+jobKey, not on the Job
 * row — and silently applies to nothing. Until this, the only way to find that
 * out was to notice a location had quietly reverted.
 */
export async function listLocationOverrides(siteId: string) {
  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { id: true } });
  if (!site) {
    throw new NotFoundError("Site", siteId);
  }

  const [overrides, jobs] = await Promise.all([
    prisma.jobLocationOverride.findMany({
      where: { siteId },
      select: {
        id: true,
        jobKey: true,
        location: true,
        locations: true,
        jobTitle: true,
        updatedAt: true,
      },
    }),
    prisma.job.findMany({
      where: { siteId },
      select: { id: true, title: true, externalJobId: true, detailUrl: true },
    }),
  ]);

  const rows = matchOverrides(overrides, jobs);
  return {
    overrides: rows,
    total: rows.length,
    unmatched: rows.filter((r) => !r.matched).length,
  };
}
