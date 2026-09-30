import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api-utils";
import { formatErrorResponse } from "@/lib/errors";
import { createScrapeRun, getLatestScrapeRun } from "@/services/siteService";
import { noteSiteWrite, recordSiteCall } from "@/services/autoFixService";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await recordSiteCall(request, id, "GET /api/sites/[id]/scrape");
    const scrapeRun = await getLatestScrapeRun(id);

    return successResponse(scrapeRun);
  } catch (error) {
    return formatErrorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await noteSiteWrite(request, id, "POST /api/sites/[id]/scrape");
    let maxJobs: number | undefined;
    try {
      const body = await request.json();
      if (typeof body?.maxJobs === "number" && body.maxJobs > 0) {
        maxJobs = body.maxJobs;
      }
    } catch {
      // No body or invalid JSON -- treat as unlimited
    }
    const scrapeRun = await createScrapeRun(id, { maxJobs });

    return successResponse(scrapeRun, 201);
  } catch (error) {
    return formatErrorResponse(error);
  }
}
