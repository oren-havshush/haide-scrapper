import { prisma } from "@/lib/prisma";
import { getStatusCounts } from "./siteService";

export interface ScrapeHealth {
  successRate: number;
  successCount: number;
  failureCount: number;
  totalSites: number;
}

export interface DashboardOverview {
  scrapeHealth: ScrapeHealth;
  statusCounts: Record<string, number> & { total: number };
  reviewQueueDepth: number;
  totalJobs: number;
}

export interface FailedSiteRow {
  id: string;
  siteUrl: string;
  status: string;
  failedAt: Date | null;
  latestScrapeRun: {
    id: string;
    failureCategory: string | null;
    error: string | null;
    createdAt: Date;
  } | null;
}

export interface FailedSitesResult {
  data: FailedSiteRow[];
  meta: { total: number; showing: number };
}

export async function getDashboardOverview(): Promise<DashboardOverview> {
  // Run all queries in parallel for performance
  const [statusCounts, scrapeHealth, totalJobs] = await Promise.all([
    getStatusCounts(),
    getScrapeHealth(),
    prisma.job.count(),
  ]);

  return {
    scrapeHealth,
    statusCounts,
    reviewQueueDepth: statusCounts.REVIEW ?? 0,
    totalJobs,
  };
}

async function getScrapeHealth(): Promise<ScrapeHealth> {
  // Get latest scrape run per site and aggregate
  const sites = await prisma.site.findMany({
    where: { scrapeRuns: { some: {} } },
    include: {
      scrapeRuns: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true },
      },
    },
  });

  let successCount = 0;
  let failureCount = 0;
  for (const site of sites) {
    const latestRun = site.scrapeRuns[0];
    if (latestRun?.status === "COMPLETED") successCount++;
    else if (latestRun?.status === "FAILED") failureCount++;
    // IN_PROGRESS runs are excluded from the health metric
  }

  const totalSites = successCount + failureCount;
  const successRate = totalSites > 0
    ? Math.round((successCount / totalSites) * 1000) / 10
    : 0;

  return { successRate, successCount, failureCount, totalSites };
}

export async function getFailedSitesWithReasons(): Promise<FailedSitesResult> {
  const [failedSites, total] = await Promise.all([
    prisma.site.findMany({
      where: { status: "FAILED" },
      include: {
        scrapeRuns: {
          where: { status: "FAILED" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, failureCategory: true, error: true, createdAt: true },
        },
      },
      orderBy: { failedAt: "desc" },
      take: 10,
    }),
    prisma.site.count({ where: { status: "FAILED" } }),
  ]);

  const data: FailedSiteRow[] = failedSites.map((site) => ({
    id: site.id,
    siteUrl: site.siteUrl,
    status: site.status,
    failedAt: site.failedAt,
    latestScrapeRun: site.scrapeRuns[0] ?? null,
  }));

  return {
    data,
    meta: { total, showing: data.length },
  };
}
