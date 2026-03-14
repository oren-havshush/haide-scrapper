import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api-utils";
import { formatErrorResponse } from "@/lib/errors";
import { createAnalysisJob } from "@/services/siteService";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const workerJob = await createAnalysisJob(id);
    return successResponse(workerJob, 201);
  } catch (error) {
    return formatErrorResponse(error);
  }
}
