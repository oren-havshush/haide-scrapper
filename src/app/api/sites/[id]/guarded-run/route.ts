import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api-utils";
import { formatErrorResponse } from "@/lib/errors";
import { getGuardedRuns, requestGuardedRun } from "@/services/guardedRunService";
import { noteSiteWrite, recordSiteCall, tokenHashOf } from "@/services/autoFixService";

// A guarded single-site run, asked for through the API (addsite2 phase two,
// step 3, option B) by an operator without ssh. POST writes a request row and
// nothing else; the claim timer on the box runs it with the existing
// single-site driver (worker/sweep/nightly.ts --claim-request), email off.
//
// The boundary (src/lib/scrapeRequestBoundary.test.ts): this route never queues
// a scrape and never forwards a scheduled flag. It reads one field off the
// body, by name — who is asking — and the gate below decides the rest.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await recordSiteCall(request, id, "GET /api/sites/[id]/guarded-run");
    return successResponse(await getGuardedRuns(id));
  } catch (error) {
    return formatErrorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await noteSiteWrite(request, id, "POST /api/sites/[id]/guarded-run");
    let operator: string | null = null;
    try {
      const body = await request.json();
      if (typeof body?.operator === "string" && body.operator.trim()) operator = body.operator.trim().slice(0, 100);
    } catch {
      // No body: an anonymous request.
    }
    // The gate is planGuardedRunRequest (src/lib/guardedRun.ts), applied inside
    // the service's transaction: REVIEW only, one request per site at a time,
    // no sweep running, not between 01:30 and 07:05 Asia/Jerusalem.
    const row = await requestGuardedRun({ siteId: id, operator, tokenHash: tokenHashOf(request), now: new Date() });
    return successResponse(row, 201);
  } catch (error) {
    return formatErrorResponse(error);
  }
}
