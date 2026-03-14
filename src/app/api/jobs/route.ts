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

    const skip = (pagination.page - 1) * pagination.pageSize;

    const [jobs, total] = await Promise.all([
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
    ]);

    return listResponse(jobs, {
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
    });
  } catch (error) {
    return formatErrorResponse(error);
  }
}
