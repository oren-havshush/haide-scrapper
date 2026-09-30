import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api-utils";
import { formatErrorResponse, ValidationError } from "@/lib/errors";
import {
  updateSiteStatusSchema,
  updateSiteAdminNoteSchema,
  updateSiteCompanyNameSchema,
} from "@/lib/validators";
import {
  updateSiteStatus,
  updateSiteAdminNote,
  updateSiteCompanyName,
  deleteSite,
} from "@/services/siteService";
import { prisma } from "@/lib/prisma";
import { applyAutoFix } from "@/services/autoFixService";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const route = "PATCH /api/sites/[id]";
    // The status this write arrives to (step 1c: only a write to an ACTIVE site
    // opens a fix item).
    const statusBefore =
      (await prisma.site.findUnique({ where: { id }, select: { status: true } }))?.status ?? "";

    // Accept { status }, { adminNote }, or { companyName }. Inferred from which
    // key is present so existing PATCH callers don't need to change.
    if (Object.prototype.hasOwnProperty.call(body, "companyName")) {
      const parsed = updateSiteCompanyNameSchema.safeParse(body);
      if (!parsed.success) {
        throw new ValidationError(
          parsed.error.issues.map((i: { message: string }) => i.message).join(", ")
        );
      }
      const site = await updateSiteCompanyName(id, parsed.data.companyName);
      await applyAutoFix({ request, siteId: id, statusBefore, route, write: { kind: "other" } });
      return successResponse(site);
    }

    if (Object.prototype.hasOwnProperty.call(body, "adminNote")) {
      const parsed = updateSiteAdminNoteSchema.safeParse(body);
      if (!parsed.success) {
        throw new ValidationError(
          parsed.error.issues.map((i: { message: string }) => i.message).join(", ")
        );
      }
      const site = await updateSiteAdminNote(id, parsed.data.adminNote);
      await applyAutoFix({ request, siteId: id, statusBefore, route, write: { kind: "other" } });
      return successResponse(site);
    }

    const parsed = updateSiteStatusSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((i: { message: string }) => i.message).join(", ")
      );
    }

    const site = await updateSiteStatus(id, parsed.data.status);
    await applyAutoFix({
      request,
      siteId: id,
      statusBefore,
      route,
      write: { kind: "status", to: parsed.data.status },
    });
    return successResponse(site);
  } catch (error) {
    return formatErrorResponse(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await deleteSite(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return formatErrorResponse(error);
  }
}
