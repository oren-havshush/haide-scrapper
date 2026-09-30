import { NextRequest, NextResponse } from "next/server";
import { formatErrorResponse } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { clearSiteJobs } from "@/services/siteService";
import { applyAutoFix } from "@/services/autoFixService";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    // A manual job delete on an ACTIVE site is a COVERAGE fix (step 1c).
    const statusBefore =
      (await prisma.site.findUnique({ where: { id }, select: { status: true } }))?.status ?? "";
    await clearSiteJobs(id);
    await applyAutoFix({
      request,
      siteId: id,
      statusBefore,
      route: "DELETE /api/sites/[id]/jobs",
      write: { kind: "jobs_delete" },
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return formatErrorResponse(error);
  }
}
