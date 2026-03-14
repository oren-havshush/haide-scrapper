import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api-utils";
import { formatErrorResponse } from "@/lib/errors";
import { createScrapeRun, getLatestScrapeRun } from "@/services/siteService";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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
