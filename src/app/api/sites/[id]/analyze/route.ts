import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api-utils";
import { formatErrorResponse } from "@/lib/errors";
import { createAnalysisJob } from "@/services/siteService";
import { noteSiteWrite } from "@/services/autoFixService";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await noteSiteWrite(request, id, "POST /api/sites/[id]/analyze");
    // Re-analysing an ACTIVE site that has jobs is refused unless the caller
    // opts in — it overwrites the saved config and can delete those jobs.
    // See createAnalysisJob for why.
    let force = false;
    try {
      const body = await request.json();
      force = body?.force === true;
    } catch {
      // No body, or not JSON — treat as "not forced".
    }
    const workerJob = await createAnalysisJob(id, { force });
    return successResponse(workerJob, 201);
  } catch (error) {
    return formatErrorResponse(error);
  }
}
