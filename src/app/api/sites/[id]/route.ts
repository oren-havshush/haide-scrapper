import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api-utils";
import { formatErrorResponse, NotFoundError, ValidationError } from "@/lib/errors";
import { pickSitePatchAction } from "@/lib/sitePatch";
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
import { applyAutoFix, companySnapshotOf, recordSiteCall } from "@/services/autoFixService";

/**
 * GET /api/sites/[id] (step 5, landmine c): one site by id. Before this a
 * caller had to page the list, or pass ?id= — which the list ignored, so
 * skipSite could act on the wrong site.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await recordSiteCall(request, id, "GET /api/sites/[id]");
    const site = await prisma.site.findUnique({ where: { id } });
    if (!site) throw new NotFoundError("Site", id);
    return successResponse(site);
  } catch (error) {
    return formatErrorResponse(error);
  }
}

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

    // Accept { status }, { adminNote }, or { companyName }: exactly one per call.
    // A body naming more than one is a 400 naming them (step 5, landmine a).
    const action = pickSitePatchAction(body);
    if (action === "companyName") {
      const parsed = updateSiteCompanyNameSchema.safeParse(body);
      if (!parsed.success) {
        throw new ValidationError(
          parsed.error.issues.map((i: { message: string }) => i.message).join(", ")
        );
      }
      const companyBefore = await companySnapshotOf(id);
      const site = await updateSiteCompanyName(id, parsed.data.companyName);
      await applyAutoFix({
        request,
        siteId: id,
        statusBefore,
        route,
        write: { kind: "company", before: companyBefore, after: await companySnapshotOf(id) },
      });
      return successResponse(site);
    }

    if (action === "adminNote") {
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
