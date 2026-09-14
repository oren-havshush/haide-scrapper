import { prisma } from "@/lib/prisma";
import type { ScrapingPolicyStatus } from "@/generated/prisma/enums";

export const POLICY_STATUS_LABELS: Record<ScrapingPolicyStatus, string> = {
  NOT_CHECKED: "Not checked yet",
  POLICY_NOT_FOUND: "Policy not found",
  NO_EXPLICIT_RESTRICTION: "No explicit restriction found",
  RESTRICTED: "Restriction found",
  REQUIRES_WRITTEN_PERMISSION: "Requires written permission",
  UNCLEAR_NEEDS_REVIEW: "Unclear / needs manual review",
  CHECK_FAILED: "Failed to check",
};

export interface PolicyStatusCounts {
  NOT_CHECKED: number;
  POLICY_NOT_FOUND: number;
  NO_EXPLICIT_RESTRICTION: number;
  RESTRICTED: number;
  REQUIRES_WRITTEN_PERMISSION: number;
  UNCLEAR_NEEDS_REVIEW: number;
  CHECK_FAILED: number;
  total: number;
  checked: number;
}

/** Group-by counts of scrapingPolicyStatus across all sites. */
export async function getPolicyStatusCounts(): Promise<PolicyStatusCounts> {
  const rows = await prisma.site.groupBy({
    by: ["scrapingPolicyStatus"],
    _count: { _all: true },
  });

  const result: PolicyStatusCounts = {
    NOT_CHECKED: 0,
    POLICY_NOT_FOUND: 0,
    NO_EXPLICIT_RESTRICTION: 0,
    RESTRICTED: 0,
    REQUIRES_WRITTEN_PERMISSION: 0,
    UNCLEAR_NEEDS_REVIEW: 0,
    CHECK_FAILED: 0,
    total: 0,
    checked: 0,
  };

  for (const row of rows) {
    const key = row.scrapingPolicyStatus as ScrapingPolicyStatus;
    result[key] = row._count._all;
    result.total += row._count._all;
  }

  result.checked = result.total - result.NOT_CHECKED;
  return result;
}

/** Enqueue a POLICY_REVIEW WorkerJob for a site (idempotent: skip if one is already PENDING/IN_PROGRESS). */
export async function enqueuePolicyReview(
  siteId: string,
  reviewSource = "direct_discovery",
): Promise<{ jobId: string; alreadyQueued: boolean }> {
  const existing = await prisma.workerJob.findFirst({
    where: {
      siteId,
      type: "POLICY_REVIEW",
      status: { in: ["PENDING", "IN_PROGRESS"] },
    },
    select: { id: true },
  });

  if (existing) {
    return { jobId: existing.id, alreadyQueued: true };
  }

  const job = await prisma.workerJob.create({
    data: {
      siteId,
      type: "POLICY_REVIEW",
      status: "PENDING",
      payload: { reviewSource },
    },
  });

  return { jobId: job.id, alreadyQueued: false };
}

/** Find-or-create a site by URL (without triggering ANALYSIS), then enqueue a POLICY_REVIEW job. */
export async function scanUrlForPolicy(
  siteUrl: string,
): Promise<{ siteId: string; jobId: string; alreadyQueued: boolean; created: boolean }> {
  let site = await prisma.site.findUnique({ where: { siteUrl } });
  let created = false;

  if (!site) {
    site = await prisma.site.create({
      data: {
        siteUrl,
        status: "ANALYZING",
        analyzingAt: new Date(),
      },
    });
    created = true;
  }

  const { jobId, alreadyQueued } = await enqueuePolicyReview(site.id, "manual_url");
  return { siteId: site.id, jobId, alreadyQueued, created };
}

/** Return the latest ScrapingPolicyReview row for a site (for audit/debug view). */
export async function getLatestPolicyReview(siteId: string) {
  return prisma.scrapingPolicyReview.findFirst({
    where: { siteId },
    orderBy: { createdAt: "desc" },
  });
}

/** Policy coverage counts for the dashboard summary. */
export interface PolicyCoverage {
  total: number;
  checked: number;
  unchecked: number;
  restricted: number;
  requiresWrittenPermission: number;
  unclearNeedsReview: number;
  failed: number;
}

export async function getPolicyCoverage(): Promise<PolicyCoverage> {
  const counts = await getPolicyStatusCounts();
  return {
    total: counts.total,
    checked: counts.checked,
    unchecked: counts.NOT_CHECKED,
    restricted: counts.RESTRICTED,
    requiresWrittenPermission: counts.REQUIRES_WRITTEN_PERMISSION,
    unclearNeedsReview: counts.UNCLEAR_NEEDS_REVIEW,
    failed: counts.CHECK_FAILED,
  };
}
