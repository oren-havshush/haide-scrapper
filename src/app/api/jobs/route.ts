import { NextRequest } from "next/server";
import { listResponse } from "@/lib/api-utils";
import { formatErrorResponse } from "@/lib/errors";
import { paginationSchema, jobsFilterSchema } from "@/lib/validators";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    const pagination = paginationSchema.parse({
      page: searchParams.get("page") ?? undefined,
      pageSize: searchParams.get("pageSize") ?? undefined,
    });

    const filters = jobsFilterSchema.parse({
      siteId: searchParams.get("siteId") ?? undefined,
      scrapeRunId: searchParams.get("scrapeRunId") ?? undefined,
      validationStatus: searchParams.get("validationStatus") ?? undefined,
      siteUrlSearch: searchParams.get("siteUrlSearch") ?? undefined,
      companyNameSearch: searchParams.get("companyNameSearch") ?? undefined,
      ageBucket: searchParams.get("ageBucket") ?? undefined,
    });

    // Build Prisma where clause
    const where: Prisma.JobWhereInput = {};

    if (filters.siteId) {
      where.siteId = filters.siteId;
    }

    if (filters.scrapeRunId) {
      where.scrapeRunId = filters.scrapeRunId;
    } else if (filters.siteId) {
      // Default to latest scrape run for a site to avoid mixing historical runs.
      const latestRun = await prisma.scrapeRun.findFirst({
        where: { siteId: filters.siteId },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (latestRun) {
        where.scrapeRunId = latestRun.id;
      }
    }

    if (filters.validationStatus === "valid") {
      where.validationStatus = "valid";
    } else if (filters.validationStatus === "invalid") {
      where.validationStatus = { startsWith: "invalid:" };
    }

    // Free-text filters on the related Site. AND-compose with siteId when both
    // are supplied (Prisma combines `where.siteId` and `where.site = {...}`
    // naturally). For text-only queries we deliberately skip the "latest run"
    // narrowing above because jobs from different sites can't share a run id;
    // each job already carries its own scrapeRunId.
    if (filters.siteUrlSearch || filters.companyNameSearch) {
      where.site = {
        ...(filters.siteUrlSearch && {
          siteUrl: { contains: filters.siteUrlSearch, mode: "insensitive" },
        }),
        ...(filters.companyNameSearch && {
          companyName: { contains: filters.companyNameSearch, mode: "insensitive" },
        }),
      };
    }

    // Age-bucket filter: build where.ageBucket from the friendly param.
    if (filters.ageBucket) {
      switch (filters.ageBucket) {
        case "over90":
          where.ageBucket = { in: ["d90", "d180", "d365"] };
          break;
        case "over180":
          where.ageBucket = { in: ["d180", "d365"] };
          break;
        case "over365":
          where.ageBucket = "d365";
          break;
        case "fresh":
          where.ageBucket = "fresh";
          break;
        case "none":
          where.ageBucket = null;
          break;
      }
    }

    const skip = (pagination.page - 1) * pagination.pageSize;

    // Base scope for age counts: same as `where` but without the ageBucket
    // filter so we always get counts for all buckets.
    const whereForCounts: Prisma.JobWhereInput = { ...where, ageBucket: undefined };

    const [jobs, total, ageBucketGroups] = await Promise.all([
      prisma.job.findMany({
        where,
        skip,
        take: pagination.pageSize,
        orderBy: { createdAt: "desc" },
        include: {
          site: {
            select: { id: true, siteUrl: true },
          },
        },
      }),
      prisma.job.count({ where }),
      prisma.job.groupBy({
        by: ["ageBucket"],
        where: whereForCounts,
        _count: { ageBucket: true },
      }),
    ]);

    // Shape into { fresh, d90, d180, d365, none } for the UI.
    const ageCounts: Record<string, number> = {
      fresh: 0,
      d90: 0,
      d180: 0,
      d365: 0,
      none: 0,
    };
    for (const row of ageBucketGroups) {
      const key = row.ageBucket ?? "none";
      ageCounts[key] = (ageCounts[key] ?? 0) + row._count.ageBucket;
    }

    return listResponse(jobs, {
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
      ageCounts,
    });
  } catch (error) {
    return formatErrorResponse(error);
  }
}
