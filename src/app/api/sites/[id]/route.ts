import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api-utils";
import { formatErrorResponse, ValidationError } from "@/lib/errors";
import { updateSiteStatusSchema } from "@/lib/validators";
import { updateSiteStatus, deleteSite } from "@/services/siteService";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
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
