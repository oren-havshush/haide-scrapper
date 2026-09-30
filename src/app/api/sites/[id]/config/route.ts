import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api-utils";
import { formatErrorResponse, NotFoundError, ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { updateSiteConfigSchema } from "@/lib/validators";
import { saveSiteConfig } from "@/services/siteService";
import { applyAutoFix, recordSiteCall } from "@/services/autoFixService";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await recordSiteCall(request, id, "GET /api/sites/[id]/config");
    const site = await prisma.site.findUnique({
      where: { id },
      select: { fieldMappings: true, pageFlow: true },
    });

    if (!site) {
      throw new NotFoundError("Site", id);
    }

    return successResponse({
      fieldMappings: site.fieldMappings,
      pageFlow: site.pageFlow,
    });
  } catch (error) {
    return formatErrorResponse(error);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const parsed = updateSiteConfigSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((e) => e.message).join(", ")
      );
    }

    // What the save replaces, and the status it arrived to: a save demotes an
    // ACTIVE site, and that save is still a fix on an ACTIVE site (step 1c).
    const stored = await prisma.site.findUnique({
      where: { id },
      select: { status: true, fieldMappings: true, pageFlow: true },
    });
    const statusBefore = stored?.status ?? "";

    const updatedSite = await saveSiteConfig(id, parsed.data);

    await applyAutoFix({
      request,
      siteId: id,
      statusBefore,
      route: "PUT /api/sites/[id]/config",
      write: {
        kind: "config",
        before: { fieldMappings: stored?.fieldMappings ?? null, pageFlow: stored?.pageFlow ?? null },
        after: { fieldMappings: updatedSite.fieldMappings, pageFlow: updatedSite.pageFlow },
      },
    });

    return successResponse({
      status: updatedSite.status,
    });
  } catch (error) {
    return formatErrorResponse(error);
  }
}
