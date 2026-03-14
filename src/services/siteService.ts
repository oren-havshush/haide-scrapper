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
  SKIPPED: ["ANALYZING"],
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
    siteUrl?: string;
    sortBy?: "createdAt" | "confidenceScore" | "reviewAt";
    sortOrder?: "asc" | "desc";
  }
) {
  const { page, pageSize, status, siteUrl, sortBy = "createdAt", sortOrder = "desc" } = params;
  const where: Record<string, unknown> = {};
  if (status) {
    where.status = status as SiteStatus;
  }
  if (siteUrl) {
    where.siteUrl = siteUrl;
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
          select: { id: true, status: true, jobCount: true, createdAt: true, completedAt: true },
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

  const updatedSite = await prisma.site.update({
    where: { id: siteId },
    data: updateData,
  });

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

export async function createAnalysisJob(siteId: string) {
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) {
    throw new NotFoundError("Site", siteId);
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
    formCapture: { formSelector: string; actionUrl: string; method: string; fields: Array<{ name: string; label: string; fieldType: string; required: boolean; tagName: string }> } | null;
    originalMappings?: Record<string, unknown>;
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
      savedAt: new Date().toISOString(),
    },
  };

  // Build update data — save config only, do NOT auto-transition status.
  // User must approve test extraction results before triggering full scrape.
  const updateData: Record<string, unknown> = {
    fieldMappings: fieldMappingsWithMeta,
    pageFlow: config.pageFlow,
  };

  const updatedSite = await prisma.site.update({
    where: { id: siteId },
    data: updateData,
  });

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
