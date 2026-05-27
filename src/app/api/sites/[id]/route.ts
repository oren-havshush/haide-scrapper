import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api-utils";
import { formatErrorResponse, ValidationError } from "@/lib/errors";
import {
  updateSiteStatusSchema,
  updateSiteAdminNoteSchema,
} from "@/lib/validators";
import {
  updateSiteStatus,
  updateSiteAdminNote,
  deleteSite,
} from "@/services/siteService";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    // Accept either { status } or { adminNote }. Inferred from which key is
    // present so the existing status PATCH callers don't need to change.
    if (Object.prototype.hasOwnProperty.call(body, "adminNote")) {
      const parsed = updateSiteAdminNoteSchema.safeParse(body);
      if (!parsed.success) {
        throw new ValidationError(
          parsed.error.issues.map((i: { message: string }) => i.message).join(", ")
        );
      }
      const site = await updateSiteAdminNote(id, parsed.data.adminNote);
      return successResponse(site);
    }

    const parsed = updateSiteStatusSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((i: { message: string }) => i.message).join(", ")
      );
    }

    const site = await updateSiteStatus(id, parsed.data.status);
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
