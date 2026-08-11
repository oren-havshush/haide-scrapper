import { NextRequest } from "next/server";
import { listResponse } from "@/lib/api-utils";
import { formatErrorResponse } from "@/lib/errors";
import { jobsPaginationSchema, jobsFilterSchema } from "@/lib/validators";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Escape the LIKE metacharacters `\`, `%` and `_`.
 *
 * Prisma compiles `equals` + `mode: "insensitive"` to a Postgres ILIKE and
 * passes the value through unescaped, so those characters would otherwise act
 * as wildcards — searching "%" returned every row, and "1_030" matched 15030.
 * 400 of the stored job ids contain "_" and 31 contain "%", so this is not
 * hypothetical. Backslash is ILIKE's default escape character.
 */
function escapeLikeValue(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    const pagination = jobsPaginationSchema.parse({
      page: searchParams.get("page") ?? undefined,
      pageSize: searchParams.get("pageSize") ?? undefined,
    });

    const filters = jobsFilterSchema.parse({
      siteId: searchParams.get("siteId") ?? undefined,
      scrapeRunId: searchParams.get("scrapeRunId") ?? undefined,
      validationStatus: searchParams.get("validationStatus") ?? undefined,
      siteUrlSearch: searchParams.get("siteUrlSearch") ?? undefined,
      companyNameSearch: searchParams.get("companyNameSearch") ?? undefined,
      externalJobIdSearch: searchParams.get("externalJobIdSearch") ?? undefined,
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

    // Job ID filter. Unlike the two searches above this one lives on Job
    // itself rather than the related Site, so it sits at the top level of
    // `where` and AND-composes with them.
    //
    // `equals` (not `contains`) so "123" never matches "12345", with
    // insensitive mode because roughly half the ids are slugs rather than
    // digits and their stored casing is whatever the source page used. The
    // value is escaped because insensitive mode goes through ILIKE.
    if (filters.externalJobIdSearch) {
      where.externalJobId = {
        equals: escapeLikeValue(filters.externalJobIdSearch),
        mode: "insensitive",
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
