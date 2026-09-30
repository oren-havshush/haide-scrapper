import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api-utils";
import { formatErrorResponse, ValidationError } from "@/lib/errors";
import { updateJobLocationSchema } from "@/lib/validators";
import { updateJobLocation } from "@/services/jobService";
import { prisma } from "@/lib/prisma";
import { applyAutoFix } from "@/services/autoFixService";

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

    // A location override on an ACTIVE site is a LOCATION fix (step 1c). The
    // override does not change the site's status, but it is read first anyway.
    const owner = await prisma.job.findUnique({
      where: { id },
      select: { siteId: true, site: { select: { status: true } } },
    });
    const statusBefore = owner?.site.status ?? "";

    const job = await updateJobLocation(id, parsed.data.location);

    if (owner) {
      await applyAutoFix({
        request,
        siteId: owner.siteId,
        statusBefore,
        route: "PATCH /api/jobs/[id]",
        write: { kind: "location_override" },
      });
    }
    return successResponse(job);
  } catch (error) {
    return formatErrorResponse(error);
  }
}

// Satisfy Next.js dynamic route requirement
export const dynamic = "force-dynamic";
