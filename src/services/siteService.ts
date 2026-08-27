import { prisma } from "@/lib/prisma";
import { ConflictError, DuplicateSiteError, InvalidTransitionError, NotFoundError } from "@/lib/errors";
import type { PaginationParams } from "@/lib/types";
import type { SiteStatus } from "@/generated/prisma/enums";
import { emitEvent } from "@/services/eventService";

const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  ANALYZING: ["REVIEW", "ACTIVE", "FAILED"],
  REVIEW: ["SKIPPED", "ACTIVE", "FAILED", "ANALYZING"],
  ACTIVE: ["SKIPPED", "FAILED", "REVIEW", "ANALYZING"],
  FAILED: ["SKIPPED", "ANALYZING", "ACTIVE"],
  SKIPPED: ["ANALYZING", "FAILED"],
};

const STATUS_TIMESTAMP_MAP: Record<string, string> = {
  ANALYZING: "analyzingAt",
  REVIEW: "reviewAt",
  ACTIVE: "activeAt",
  FAILED: "failedAt",
  SKIPPED: "skippedAt",
};

export async function createSite(siteUrl: string) {
  try {
    const site = await prisma.site.create({
      data: {
        siteUrl,
        status: "ANALYZING",
        analyzingAt: new Date(),
      },
    });

    // Create worker job for background AI analysis (picked up by story 2-1)
    await prisma.workerJob.create({
      data: {
        siteId: site.id,
        type: "ANALYSIS",
        status: "PENDING",
      },
    });

    return site;
  } catch (error: unknown) {
    // Handle Prisma unique constraint violation (P2002)
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as Record<string, unknown>).code === "P2002"
    ) {
      throw new DuplicateSiteError();
    }
    throw error;
  }
}

export async function listSites(
  params: PaginationParams & {
    status?: string;
    policyStatus?: string;
    siteUrl?: string;
    companyNameSearch?: string;
    urlSearch?: string;
    sortBy?: "createdAt" | "confidenceScore" | "reviewAt";
    sortOrder?: "asc" | "desc";
  }
) {
  const {
    page,
    pageSize,
    status,
    policyStatus,
    siteUrl,
    companyNameSearch,
    urlSearch,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = params;
  const where: Record<string, unknown> = {};
  if (status) {
    where.status = status as SiteStatus;
  }
  if (policyStatus) {
    where.scrapingPolicyStatus = policyStatus;
  }
  // urlSearch (partial, case-insensitive) wins over the exact-match siteUrl
  // filter when both are supplied. The exact-match path is only used by the
  // /addsite skill for dedupe, so they never come from the same caller.
  if (urlSearch) {
    where.siteUrl = { contains: urlSearch, mode: "insensitive" };
  } else if (siteUrl) {
    where.siteUrl = siteUrl;
  }
  if (companyNameSearch) {
    where.companyName = { contains: companyNameSearch, mode: "insensitive" };
  }

  // Build orderBy - handle nulls for confidenceScore and reviewAt
  const orderBy =
    sortBy === "confidenceScore" || sortBy === "reviewAt"
      ? { [sortBy]: { sort: sortOrder, nulls: "last" as const } }
      : { [sortBy]: sortOrder };

  const [sites, total] = await Promise.all([
    prisma.site.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        scrapeRuns: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, status: true, jobCount: true, createdAt: true, completedAt: true, warnings: true },
        },
      },
    }),
    prisma.site.count({ where }),
  ]);

  // Flatten scrapeRuns array to latestScrapeRun for each site
  const sitesWithScrapeInfo = sites.map((site) => {
    const { scrapeRuns, ...rest } = site;
    return {
      ...rest,
      latestScrapeRun: scrapeRuns[0] ?? null,
    };
  });

  return { sites: sitesWithScrapeInfo, total };
}

export async function getStatusCounts(): Promise<Record<string, number> & { total: number }> {
  const counts = await prisma.site.groupBy({
    by: ["status"],
    _count: { _all: true },
  });

  const result: Record<string, number> = {
    ANALYZING: 0,
    REVIEW: 0,
    ACTIVE: 0,
    FAILED: 0,
    SKIPPED: 0,
  };

  let total = 0;
  for (const row of counts) {
    result[row.status] = row._count._all;
    total += row._count._all;
  }

  return { ...result, total };
}

export async function updateSiteAdminNote(siteId: string, note: string | null) {
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) {
    throw new NotFoundError("Site", siteId);
  }
  const trimmed = note?.trim() ?? null;
  return prisma.site.update({
    where: { id: siteId },
    data: { adminNote: trimmed && trimmed.length > 0 ? trimmed : null },
  });
}

export async function updateSiteCompanyName(siteId: string, name: string | null) {
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) {
    throw new NotFoundError("Site", siteId);
  }
  const trimmed = name?.trim() ?? null;
  return prisma.site.update({
    where: { id: siteId },
    data: { companyName: trimmed && trimmed.length > 0 ? trimmed : null },
  });
}

export async function updateSiteStatus(siteId: string, newStatus: SiteStatus) {
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) {
    throw new NotFoundError("Site", siteId);
  }

  const currentStatus = site.status;
  const allowedTransitions = VALID_STATUS_TRANSITIONS[currentStatus];
  if (!allowedTransitions || !allowedTransitions.includes(newStatus)) {
    throw new InvalidTransitionError(currentStatus, newStatus);
  }

  // Build update data with status and corresponding timestamp
  const timestampField = STATUS_TIMESTAMP_MAP[newStatus];
  const updateData: Record<string, unknown> = {
    status: newStatus,
    [timestampField]: new Date(),
  };

  // A deliberate re-analyze clears the config lock so the fresh analysis is
  // allowed to write its result (otherwise the analyzer-race guard in
  // worker/jobs/analyze.ts would skip the write and the re-analyze would be a
  // no-op). Fixes LRN-RACE-3.
  if (newStatus === "ANALYZING") {
    updateData.configLocked = false;
  }

  // Moving a site to FAILED wipes its scraped jobs automatically.
  let updatedSite;
  if (newStatus === "FAILED") {
    const [, site2] = await prisma.$transaction([
      prisma.job.deleteMany({ where: { siteId } }),
      prisma.site.update({ where: { id: siteId }, data: updateData }),
    ]);
    updatedSite = site2;
  } else {
    updatedSite = await prisma.site.update({
      where: { id: siteId },
      data: updateData,
    });
  }

  // Emit SSE event for status change
  emitEvent({
    type: "site:status-changed",
    payload: { siteId, status: newStatus },
  });

  // If re-analyzing, create a new worker job
  if (newStatus === "ANALYZING") {
    await prisma.workerJob.create({
      data: {
        siteId: siteId,
        type: "ANALYSIS",
        status: "PENDING",
      },
    });
  }

  return updatedSite;
}

export async function createAnalysisJob(
  siteId: string,
  opts: { force?: boolean } = {},
) {
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) {
    throw new NotFoundError("Site", siteId);
  }

  // Re-analysing a live site is destructive, and nothing about the button says
  // so. The transition to ANALYZING deliberately clears configLocked (see
  // updateSiteStatus), which lets the analyzer overwrite fieldMappings, and a
  // FAILED outcome deletes the site's scraped jobs. careers.iec.co.il lost a
  // working config and all 53 of its jobs exactly this way; every selector
  // still reported "MATCHED" afterwards, so the damage was invisible until the
  // job count hit zero.
  //
  // Refuse by default for a site that has something to lose. Callers who mean
  // it pass force.
  if (!opts.force && site.status === "ACTIVE") {
    const jobCount = await prisma.job.count({ where: { siteId } });
    if (jobCount > 0) {
      throw new ConflictError(
        `Site is ACTIVE with ${jobCount} job(s). Re-analysing overwrites its saved ` +
          `config and can delete those jobs. Back the config up first ` +
          `(npx tsx scripts/export-site-configs.ts --site ${siteId}), then retry ` +
          `with force=true.`,
      );
    }
  }

  // Check for existing pending/in-progress analysis job
  const existingJob = await prisma.workerJob.findFirst({
    where: {
      siteId,
      type: "ANALYSIS",
      status: { in: ["PENDING", "IN_PROGRESS"] },
    },
  });

  if (existingJob) {
    throw new ConflictError("An analysis is already in progress for this site");
  }

  const workerJob = await prisma.workerJob.create({
    data: {
      siteId,
      type: "ANALYSIS",
      status: "PENDING",
    },
  });

  return workerJob;
}

export async function saveSiteConfig(
  siteId: string,
  config: {
    listingSelector?: string;
    itemSelector?: string;
    revealSelector?: string;
    fieldMappings: Record<string, unknown>;
    pageFlow: Array<{ url: string; action: string; waitFor?: string }>;
    formCapture: { formSelector: string; actionUrl: string; method: string; fields: Array<{ name: string; label: string; fieldType: string; required: boolean; tagName: string; options?: Array<{ value: string; label: string }> }> } | null;
    originalMappings?: Record<string, unknown>;
    pagination?:
      | { type: "click"; nextSelector: string; maxPages?: number; settleMs?: number }
      | { type: "url"; param: string; start?: number; step?: number; maxPages?: number; settleMs?: number };
    setupScript?: string;
    loadMoreSelector?: string;
    browserOverrides?: { userAgent?: string; extraHeaders?: Record<string, string>; bypassCSP?: boolean };
    applyRequiresLogin?: boolean;
    applyLoginReason?: string;
    minPublishDate?: string;
    minPublishDays?: number;
    locationFallback?: string;
  }
) {
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) {
    throw new NotFoundError("Site", siteId);
  }

  const fieldMappingsWithMeta: Record<string, unknown> = {
    ...config.fieldMappings,
    _meta: {
      listingSelector: config.listingSelector || null,
      itemSelector: config.itemSelector || null,
      revealSelector: config.revealSelector || null,
      originalMappings: config.originalMappings || null,
      formCapture: config.formCapture,
      pagination: config.pagination || null,
      setupScript: config.setupScript || null,
      loadMoreSelector: config.loadMoreSelector || null,
      browserOverrides: config.browserOverrides || null,
      applyRequiresLogin: config.applyRequiresLogin === true,
      applyLoginReason: config.applyLoginReason || null,
      minPublishDate: config.minPublishDate || null,
      minPublishDays:
        typeof config.minPublishDays === "number" ? config.minPublishDays : null,
      locationFallback: config.locationFallback || null,
      savedAt: new Date().toISOString(),
    },
  };

  const transitionToReview = site.status === "ACTIVE";

  // Build update data for config save.
  // When editing an ACTIVE site, send it back to REVIEW until re-approved.
  // Lock the config so the async analyzer can't clobber this write
  // (analyzer-race guard, LRN-RACE-1/2). Cleared on a deliberate re-analyze
  // (updateSiteStatus -> ANALYZING).
  const updateData: Record<string, unknown> = {
    fieldMappings: fieldMappingsWithMeta,
    pageFlow: config.pageFlow,
    configLocked: true,
  };
  if (transitionToReview) {
    updateData.status = "REVIEW";
    updateData.reviewAt = new Date();
  }

  const updatedSite = await prisma.site.update({
    where: { id: siteId },
    data: updateData,
  });

  if (transitionToReview) {
    emitEvent({
      type: "site:status-changed",
      payload: { siteId, status: "REVIEW" },
    });
  }

  return updatedSite;
}

export async function createScrapeRun(siteId: string, options?: { maxJobs?: number }) {
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) {
    throw new NotFoundError("Site", siteId);
  }

  // Validate site status is appropriate for scraping
  const scrapeAllowedStatuses: string[] = ["ACTIVE", "REVIEW", "FAILED"];
  if (!scrapeAllowedStatuses.includes(site.status)) {
    throw new ConflictError(`Cannot trigger scrape for site with status ${site.status}`);
  }

  // Validate site has field mappings configured
  if (!site.fieldMappings || typeof site.fieldMappings !== "object") {
    throw new ConflictError("Site has no field mappings configured. Save config before triggering a scrape.");
  }

  // Check for existing in-progress scrape
  const existingScrape = await prisma.scrapeRun.findFirst({
    where: {
      siteId,
      status: "IN_PROGRESS",
    },
  });

  if (existingScrape) {
    throw new ConflictError("A scrape is already in progress for this site");
  }

  // Create ScrapeRun first, then WorkerJob with scrapeRunId in payload
  const scrapeRun = await prisma.scrapeRun.create({
    data: {
      siteId,
      status: "IN_PROGRESS",
    },
  });

  await prisma.workerJob.create({
    data: {
      siteId,
      type: "SCRAPE",
      status: "PENDING",
      payload: {
        scrapeRunId: scrapeRun.id,
        ...(options?.maxJobs ? { maxJobs: options.maxJobs } : {}),
      },
    },
  });

  return scrapeRun;
}

export async function getLatestScrapeRun(siteId: string) {
  const scrapeRun = await prisma.scrapeRun.findFirst({
    where: { siteId },
    orderBy: { createdAt: "desc" },
    select: { id: true, siteId: true, status: true, jobCount: true, createdAt: true, completedAt: true },
  });

  return scrapeRun;
}

export async function getLatestScrapeRunsBySiteIds(siteIds: string[]) {
  if (siteIds.length === 0) return {};

  // Use raw query approach: get the most recent scrape run per site
  const scrapeRuns = await prisma.scrapeRun.findMany({
    where: { siteId: { in: siteIds } },
    orderBy: { createdAt: "desc" },
    select: { id: true, siteId: true, status: true, jobCount: true, createdAt: true, completedAt: true },
  });

  // Build map of siteId -> latest ScrapeRun (first occurrence per siteId since ordered desc)
  const map: Record<string, typeof scrapeRuns[number]> = {};
  for (const run of scrapeRuns) {
    if (!map[run.siteId]) {
      map[run.siteId] = run;
    }
  }

  return map;
}

export async function clearSiteJobs(siteId: string) {
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) {
    throw new NotFoundError("Site", siteId);
  }

  await prisma.$transaction([
    prisma.job.deleteMany({ where: { siteId } }),
    prisma.scrapeRun.deleteMany({ where: { siteId } }),
  ]);
}

export async function deleteSite(siteId: string) {
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) {
    throw new NotFoundError("Site", siteId);
  }

  // Delete all related records in a transaction, respecting FK order
  await prisma.$transaction([
    prisma.workerJob.deleteMany({ where: { siteId } }),
    prisma.analysisResult.deleteMany({ where: { siteId } }),
    prisma.job.deleteMany({ where: { siteId } }),
    prisma.scrapeRun.deleteMany({ where: { siteId } }),
    prisma.site.delete({ where: { id: siteId } }),
  ]);
}

// ---------------------------------------------------------------------------
// Company profile
//
// Captured ONCE per site at onboarding by scripts/company-profile.ts. These
// functions touch ONLY the `company*` columns. They must never write `status`,
// `configLocked`, `fieldMappings`, `pageFlow`, or any `*At` timestamp other
// than `companyProfileAt`, and they must never call saveSiteConfig() (which
// sets configLocked and demotes ACTIVE -> REVIEW) or updateSiteStatus().
//
// The allowlist assertion below is the mechanical guarantee of that invariant:
// a future edit cannot slip a non-company field into this write path without
// tripping it.
// ---------------------------------------------------------------------------

const COMPANY_PROFILE_FIELDS = [
  "companyHomepageUrl",
  "companyAbout",
  "companyLogoPath",
  "companyLogoSourceUrl",
  "companyHqAddress",
  "companyHqCity",
  "companyProfileStatus",
  "companyProfileAt",
] as const;

/** The `company*` columns, as returned by GET /api/sites/:id/company-profile. */
export const COMPANY_PROFILE_SELECT = {
  id: true,
  siteUrl: true,
  companyName: true,
  companyHomepageUrl: true,
  companyAbout: true,
  companyLogoPath: true,
  companyLogoSourceUrl: true,
  companyHqAddress: true,
  companyHqCity: true,
  companyProfileStatus: true,
  companyProfileAt: true,
} as const;

export type CompanyProfileInput = {
  companyHomepageUrl?: string | null;
  companyAbout?: string | null;
  companyLogoPath?: string | null;
  companyLogoSourceUrl?: string | null;
  companyHqAddress?: string | null;
  companyHqCity?: string | null;
  companyProfileStatus?: string | null;
};

/** Empty/whitespace-only becomes null, mirroring updateSiteCompanyName(). */
function nullIfBlank(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? null;
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export async function getCompanyProfile(siteId: string) {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: COMPANY_PROFILE_SELECT,
  });
  if (!site) {
    throw new NotFoundError("Site", siteId);
  }
  return site;
}

/**
 * Write the company profile. Presence-based: a key absent from `input` leaves
 * that column untouched; a key present as null clears it. That is what lets
 * "attempted, found nothing" propagate without a partial payload nulling out
 * data another step already wrote.
 *
 * `force` bypasses the once-only guard. Without it, a site whose
 * companyProfileAt is already set is rejected with ConflictError — this is
 * where "scraped once, never refreshed" is enforced in code rather than merely
 * intended, so a re-run cannot clobber a hand-corrected value.
 */
export async function saveCompanyProfile(
  siteId: string,
  input: CompanyProfileInput,
  options?: { force?: boolean },
) {
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) {
    throw new NotFoundError("Site", siteId);
  }

  if (site.companyProfileAt && !options?.force) {
    throw new ConflictError(
      `Company profile for site ${siteId} was already captured at ` +
        `${site.companyProfileAt.toISOString()}. Company data is scraped once ` +
        `per site; pass ?force=1 to overwrite.`,
    );
  }

  const data: Record<string, unknown> = { companyProfileAt: new Date() };

  for (const field of COMPANY_PROFILE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(input, field)) continue;
    const value = (input as Record<string, unknown>)[field];
    data[field] = typeof value === "string" || value === null || value === undefined
      ? nullIfBlank(value as string | null | undefined)
      : value;
  }

  const stray = Object.keys(data).filter(
    (key) => !(COMPANY_PROFILE_FIELDS as readonly string[]).includes(key),
  );
  if (stray.length > 0) {
    throw new Error(
      `company profile write attempted non-company field(s): ${stray.join(", ")}`,
    );
  }

  return prisma.site.update({
    where: { id: siteId },
    data,
    select: COMPANY_PROFILE_SELECT,
  });
}

/**
 * Record the logo file that POST /api/sites/:id/company-logo just wrote.
 * Separate from saveCompanyProfile() because the logo path is server-derived
 * and must never be settable by a client payload. Deliberately does NOT set
 * companyProfileAt: uploading a logo is not by itself a capture attempt, and
 * stamping it here would trip the once-only guard before the profile lands.
 */
export async function saveCompanyLogo(
  siteId: string,
  logoPath: string,
  sourceUrl: string | null,
) {
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) {
    throw new NotFoundError("Site", siteId);
  }
  return prisma.site.update({
    where: { id: siteId },
    data: { companyLogoPath: logoPath, companyLogoSourceUrl: nullIfBlank(sourceUrl) },
    select: COMPANY_PROFILE_SELECT,
  });
}

/**
 * Record an operator-supplied company homepage, WITHOUT marking the site as
 * captured.
 *
 * Some sites host their jobs on a careers-board vendor (app.civi.co.il,
 * comeet.com, myworkdayjobs.com…), where the careers URL has no relationship to
 * the employer's own domain and the board links nothing belonging to them.
 * natali is the worked example: nothing on its board identifies natali.co.il,
 * and guessing from the page produced an accessibility vendor's identity
 * instead. For those, a human supplies the URL and the capture starts there.
 *
 * The critical difference from saveCompanyProfile(): this does NOT set
 * companyProfileAt and is NOT subject to the once-only guard. Supplying a hint
 * is not a capture — stamping the timestamp here would immediately lock the
 * site out of the very capture the hint exists to enable, and drop it from the
 * `--all` queue, which selects on companyProfileAt IS NULL.
 */
export async function saveCompanyHomepage(siteId: string, homepageUrl: string | null) {
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) {
    throw new NotFoundError("Site", siteId);
  }
  return prisma.site.update({
    where: { id: siteId },
    data: { companyHomepageUrl: homepageUrl?.trim() || null },
    select: COMPANY_PROFILE_SELECT,
  });
}
