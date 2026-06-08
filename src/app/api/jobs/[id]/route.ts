import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api-utils";
import { formatErrorResponse, ValidationError } from "@/lib/errors";
import { updateJobLocationSchema } from "@/lib/validators";
import { updateJobLocation } from "@/services/jobService";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const parsed = updateJobLocationSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((i: { message: string }) => i.message).join(", "),
      );
    }

    const job = await updateJobLocation(id, parsed.data.location);
    return successResponse(job);
  } catch (error) {
    return formatErrorResponse(error);
  }
}

// Satisfy Next.js dynamic route requirement
export const dynamic = "force-dynamic";
