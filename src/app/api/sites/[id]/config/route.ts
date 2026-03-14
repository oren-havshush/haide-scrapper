import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api-utils";
import { formatErrorResponse, NotFoundError, ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { updateSiteConfigSchema } from "@/lib/validators";
import { saveSiteConfig } from "@/services/siteService";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    const updatedSite = await saveSiteConfig(id, parsed.data);

    return successResponse({
      status: updatedSite.status,
    });
  } catch (error) {
    return formatErrorResponse(error);
  }
}
