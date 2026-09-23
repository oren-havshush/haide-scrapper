import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api-utils";
import { formatErrorResponse } from "@/lib/errors";
import { listLocationOverrides } from "@/services/jobService";

// A site's manual location overrides, each paired with the job it applies to.
//
// GET only, and deliberately so. Overrides are WRITTEN through
// PATCH /api/jobs/:id, which is the one place that resolves a typed value
// against city.csv before storing it; a second write path here would be a
// second chance to store a value the vocabulary does not contain, and the
// override outranks everything the scraper decides (LRN-LOC-4).
//
// What this is for is the rows that no longer pair with a job. See
// src/lib/locationOverrides.ts.

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return successResponse(await listLocationOverrides(id));
  } catch (error) {
    return formatErrorResponse(error);
  }
}
